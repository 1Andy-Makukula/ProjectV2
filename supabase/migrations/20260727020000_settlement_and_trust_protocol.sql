-- =============================================================================
-- Phase 3a — Settlement & Trust Protocol
--
-- Closes the gap between a gift being handed over and the merchant being paid.
--
-- The lifecycle this implements:
--
--   1. Purchase        funds locked in escrow (existing behaviour)
--   2. Scan            QR scan flips the order to FULFILLED, and a share of the
--                      merchant's earnings is advanced immediately if their
--                      trust tier allows it
--   3. Countdown       a no-dispute window runs from the moment of fulfilment.
--                      Its length is configuration, not a constant, so it can
--                      be five minutes in testing and a day in production
--   4. Settlement      when the window elapses with no dispute raised, the
--                      order flips FULFILLED -> REDEEMED and the remaining
--                      balance is released to the merchant
--
-- Why this migration exists at all: `settle_payout_atomic` required a status of
-- REDEEMED, but nothing in the codebase ever set that status, and the function
-- had no callers. `increment_merchant_balance` is reachable only from it. The
-- net effect was that merchant balances never grew, so no merchant could ever
-- withdraw anything they had earned.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Configurable protocol settings
--
-- These live in platform_settings rather than as literals so operations can
-- retune them without a deploy — most importantly the dispute window, which
-- needs to be minutes during testing and hours or days in production.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS dispute_window_minutes integer NOT NULL DEFAULT 1440;
COMMENT ON COLUMN public.platform_settings.dispute_window_minutes IS
  'Minutes between FULFILLED and automatic REDEEMED. 1440 = one day. Set to 5 for end-to-end testing.';

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS merchant_fee_percent numeric(5,2) NOT NULL DEFAULT 2.00;
COMMENT ON COLUMN public.platform_settings.merchant_fee_percent IS
  'Percentage deducted from the merchant''s share at settlement.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_dispute_window_check') THEN
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_dispute_window_check
      CHECK (dispute_window_minutes >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_merchant_fee_check') THEN
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_merchant_fee_check
      CHECK (merchant_fee_percent >= 0 AND merchant_fee_percent < 100);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Payout trust tiers
--
-- A merchant earns the right to be paid before the dispute window closes. The
-- thresholds are rows rather than branches in a function so they can be tuned
-- without a migration.
--
-- exposure_limit caps how much unearned money the platform will have advanced
-- to one shop at any moment. It is the ceiling on what is lost if a merchant
-- takes advances and stops delivering.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_trust_tiers (
  tier                      text PRIMARY KEY,
  min_successful_deliveries integer NOT NULL,
  upfront_percentage        integer NOT NULL,
  exposure_limit            integer NOT NULL,
  sort_order                integer NOT NULL,
  CONSTRAINT payout_trust_tiers_upfront_check
    CHECK (upfront_percentage BETWEEN 0 AND 100),
  CONSTRAINT payout_trust_tiers_limits_check
    CHECK (min_successful_deliveries >= 0 AND exposure_limit >= 0)
);

INSERT INTO public.payout_trust_tiers
  (tier, min_successful_deliveries, upfront_percentage, exposure_limit, sort_order)
VALUES
  -- A new shop is paid only after the dispute window closes.
  ('new',          0,  0,       0, 1),
  -- Amounts are ngwee: 500000 = ZMW 5,000; 2000000 = ZMW 20,000.
  ('established', 10, 30,  500000, 2),
  ('trusted',     50, 60, 2000000, 3)
ON CONFLICT (tier) DO NOTHING;

ALTER TABLE public.payout_trust_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_trust_tiers_read ON public.payout_trust_tiers;
CREATE POLICY payout_trust_tiers_read ON public.payout_trust_tiers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS payout_trust_tiers_admin_write ON public.payout_trust_tiers;
CREATE POLICY payout_trust_tiers_admin_write ON public.payout_trust_tiers
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 3. Shop-level trust and float state
--
-- Distinct from the existing `verification_tier`, which is about KYC identity.
-- This is about payment history: whether the shop has earned early access to
-- its own money.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS payout_trust_tier text NOT NULL DEFAULT 'new';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS successful_deliveries integer NOT NULL DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS upfront_payout_percentage integer NOT NULL DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS float_exposure_limit integer NOT NULL DEFAULT 0;

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS float_balance integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.shops.float_balance IS
  'Lifetime total advanced ahead of settlement. Reporting figure, never decremented.';

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS active_exposure integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.shops.active_exposure IS
  'Advanced but not yet cleared. Checked against float_exposure_limit before any new advance.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_payout_trust_tier_fkey') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_payout_trust_tier_fkey
      FOREIGN KEY (payout_trust_tier) REFERENCES public.payout_trust_tiers(tier);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_upfront_percentage_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_upfront_percentage_check
      CHECK (upfront_payout_percentage BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_exposure_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_exposure_check
      CHECK (active_exposure >= 0 AND float_balance >= 0 AND float_exposure_limit >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Order-level settlement state
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS upfront_paid integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.shop_orders.upfront_paid IS
  'Advanced to the merchant at fulfilment. Deducted from their share at settlement.';

ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS target_execution_date timestamptz;
COMMENT ON COLUMN public.shop_orders.target_execution_date IS
  'Agreed date for a scheduled service. Anchors the expiry clock for items whose requires_scheduling is true.';

ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
COMMENT ON COLUMN public.shop_orders.disputed_at IS
  'Set when the recipient flags a problem during the no-dispute window. Blocks automatic redemption.';

-- The sweep reads exactly this predicate every minute.
CREATE INDEX IF NOT EXISTS shop_orders_settlement_due_idx
  ON public.shop_orders (settlement_target_time)
  WHERE claim_status IN ('FULFILLED', 'PARTIAL_FULFILLMENT') AND settled IS NOT TRUE;

-- ---------------------------------------------------------------------------
-- 5. Merchant float ledger — immutable, same pattern as wallet_ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_float_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  shop_order_id uuid REFERENCES public.shop_orders(shop_order_id) ON DELETE SET NULL,
  amount        integer NOT NULL,
  entry_type    text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_float_ledger_entry_type_check
    CHECK (entry_type IN ('UPFRONT_ADVANCE', 'ADVANCE_CLEARED', 'ADVANCE_REVERSED'))
);

CREATE INDEX IF NOT EXISTS merchant_float_ledger_shop_idx
  ON public.merchant_float_ledger (shop_id, created_at DESC);

ALTER TABLE public.merchant_float_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchant_float_ledger_select ON public.merchant_float_ledger;
CREATE POLICY merchant_float_ledger_select ON public.merchant_float_ledger
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = merchant_float_ledger.shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

DROP TRIGGER IF EXISTS enforce_immutable_merchant_float_ledger ON public.merchant_float_ledger;
CREATE TRIGGER enforce_immutable_merchant_float_ledger
  BEFORE UPDATE OR DELETE ON public.merchant_float_ledger
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

-- ---------------------------------------------------------------------------
-- 6. Trust tier recalculation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_shop_trust_tier(p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deliveries integer;
  v_tier RECORD;
BEGIN
  SELECT successful_deliveries INTO v_deliveries FROM public.shops WHERE id = p_shop_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT tier, upfront_percentage, exposure_limit
  INTO v_tier
  FROM public.payout_trust_tiers
  WHERE min_successful_deliveries <= v_deliveries
  ORDER BY min_successful_deliveries DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.shops
  SET payout_trust_tier         = v_tier.tier,
      upfront_payout_percentage = v_tier.upfront_percentage,
      float_exposure_limit      = v_tier.exposure_limit
  WHERE id = p_shop_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. The merchant's share of an order
--
-- One definition, used by both the advance at fulfilment and the balance at
-- settlement, so the two can never drift apart.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merchant_share_for(p_gross integer)
RETURNS integer
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT floor(
    p_gross * (100 - COALESCE((SELECT merchant_fee_percent FROM public.platform_settings WHERE id = 1), 2.00)) / 100
  )::integer
$$;

-- ---------------------------------------------------------------------------
-- 8. Settlement — releases whatever the merchant is still owed
--
-- Internal: assumes the caller has already validated the order's state and
-- holds a lock on it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_merchant_settlement(p_shop_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_delivered integer;
  v_share integer;
  v_remainder integer;
BEGIN
  SELECT shop_order_id, shop_id, subtotal, upfront_paid
  INTO v_order
  FROM public.shop_orders
  WHERE shop_order_id = p_shop_order_id;

  -- Only items actually handed over earn the merchant anything; missing items
  -- were already refunded to the buyer at fulfilment.
  SELECT COALESCE(SUM(allocated_price), 0) INTO v_delivered
  FROM public.order_items
  WHERE shop_order_id = p_shop_order_id
    AND fulfillment_status = 'COLLECTED';

  v_share := public.merchant_share_for(v_delivered);
  v_remainder := GREATEST(v_share - v_order.upfront_paid, 0);

  IF v_remainder > 0 THEN
    PERFORM public.increment_merchant_balance(v_order.shop_id, v_remainder);
  END IF;

  -- Clear the advance from active exposure — the money is earned now.
  IF v_order.upfront_paid > 0 THEN
    INSERT INTO public.merchant_float_ledger (shop_id, shop_order_id, amount, entry_type, description)
    VALUES (v_order.shop_id, p_shop_order_id, -v_order.upfront_paid, 'ADVANCE_CLEARED',
            'Advance cleared on redemption');

    UPDATE public.shops
    SET active_exposure = GREATEST(active_exposure - v_order.upfront_paid, 0)
    WHERE id = v_order.shop_id;
  END IF;

  INSERT INTO public.payout_ledger
    (shop_order_id, shop_id, amount, commission, status, ledger_type, credit_amount)
  VALUES
    (p_shop_order_id, v_order.shop_id, v_share, v_delivered - v_share,
     'pending_withdrawal', 'SETTLEMENT', v_remainder);

  UPDATE public.shop_orders SET settled = true WHERE shop_order_id = p_shop_order_id;

  UPDATE public.shops
  SET successful_deliveries = successful_deliveries + 1
  WHERE id = v_order.shop_id;

  PERFORM public.refresh_shop_trust_tier(v_order.shop_id);

  RETURN jsonb_build_object(
    'success', true,
    'merchantShare', v_share,
    'upfrontAlreadyPaid', v_order.upfront_paid,
    'releasedNow', v_remainder,
    'kithlyCommission', v_delivered - v_share
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. complete_redemption — the FULFILLED -> REDEEMED transition
--
-- Deliberately not reachable from the QR scanner. The scan proves collection;
-- redemption is the separate, later event that releases the money, and the
-- window between them exists so a problem can be raised while the funds are
-- still held.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_redemption(p_shop_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_result jsonb;
BEGIN
  SELECT shop_order_id, transaction_id, claim_status, settled,
         settlement_target_time, disputed_at
  INTO v_order
  FROM public.shop_orders
  WHERE shop_order_id = p_shop_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop order not found';
  END IF;

  IF v_order.claim_status NOT IN ('FULFILLED', 'PARTIAL_FULFILLMENT') THEN
    RAISE EXCEPTION 'Order is not awaiting redemption (currently %)', v_order.claim_status;
  END IF;

  IF v_order.settled IS TRUE THEN
    RAISE EXCEPTION 'Order has already been settled';
  END IF;

  IF v_order.disputed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Order is under dispute and cannot be redeemed automatically';
  END IF;

  IF v_order.settlement_target_time IS NULL OR v_order.settlement_target_time > now() THEN
    RAISE EXCEPTION 'The no-dispute window has not closed yet';
  END IF;

  v_result := public.apply_merchant_settlement(p_shop_order_id);

  UPDATE public.shop_orders
  SET claim_status = 'REDEEMED'
  WHERE shop_order_id = p_shop_order_id;

  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (v_order.transaction_id, 'REDEMPTION_COMPLETED',
          v_result || jsonb_build_object('shop_order_id', p_shop_order_id));

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. The sweep
--
-- Each order is settled in its own transaction: one failure must not hold up
-- every other merchant waiting to be paid.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_due_redemptions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT shop_order_id
    FROM public.shop_orders
    WHERE claim_status IN ('FULFILLED', 'PARTIAL_FULFILLMENT')
      AND settled IS NOT TRUE
      AND disputed_at IS NULL
      AND settlement_target_time IS NOT NULL
      AND settlement_target_time <= now()
    ORDER BY settlement_target_time
    LIMIT 500
  LOOP
    BEGIN
      PERFORM public.complete_redemption(v_row.shop_order_id);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'complete_redemption failed for %: %', v_row.shop_order_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Dispute — stops the clock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_order_dispute(p_shop_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to raise a dispute';
  END IF;

  SELECT so.shop_order_id, so.transaction_id, so.claim_status, so.settled, t.buyer_id
  INTO v_order
  FROM public.shop_orders so
  JOIN public.transactions t ON t.transaction_id = so.transaction_id
  WHERE so.shop_order_id = p_shop_order_id
  FOR UPDATE OF so;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop order not found';
  END IF;

  IF v_order.buyer_id <> v_uid AND public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only the buyer or an admin may raise a dispute';
  END IF;

  IF v_order.settled IS TRUE OR v_order.claim_status = 'REDEEMED' THEN
    RAISE EXCEPTION 'This order has already been settled';
  END IF;

  UPDATE public.shop_orders SET disputed_at = now() WHERE shop_order_id = p_shop_order_id;

  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (v_order.transaction_id, 'DISPUTE_RAISED',
          jsonb_build_object('shop_order_id', p_shop_order_id,
                             'raised_by', v_uid,
                             'reason', v_reason));

  RETURN jsonb_build_object('success', true, 'shop_order_id', p_shop_order_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. settle_payout_atomic — kept as the manual path, now sharing one
--     implementation with the automatic one so the two cannot diverge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_payout_atomic(
  p_shop_order_id UUID,
  p_merchant_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT shop_order_id, shop_id, claim_status, settled
  INTO v_order
  FROM public.shop_orders
  WHERE shop_order_id = p_shop_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.claim_status <> 'REDEEMED' OR v_order.settled IS TRUE THEN
    RAISE EXCEPTION 'Order not ready for settlement';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_shops
    WHERE user_id = p_merchant_user_id AND shop_id = v_order.shop_id
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN public.apply_merchant_settlement(p_shop_order_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. fulfill_voucher_atomic — advances the trusted share at the scan
--
-- Unchanged in every respect except the two additions at the end: the upfront
-- release, and the dispute window now coming from configuration rather than a
-- hardcoded 48 hours.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfill_voucher_atomic(
  p_claim_code TEXT,
  p_present_item_ids UUID[],
  p_missing_item_ids UUID[],
  p_merchant_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_total_items INTEGER;
  v_covered INTEGER;
  v_present_total INTEGER := 0;
  v_missing_total INTEGER := 0;
  v_claim_status TEXT;
  v_settlement_time TIMESTAMPTZ;
  v_row RECORD;
  v_shop RECORD;
  v_window_minutes INTEGER;
  v_share INTEGER;
  v_upfront INTEGER := 0;
  v_headroom INTEGER;
BEGIN
  SELECT so.shop_order_id, so.shop_id, so.transaction_id, so.subtotal, so.claim_status
  INTO v_order
  FROM public.shop_orders so
  WHERE so.claim_code = upper(trim(p_claim_code))
    AND so.claim_status = 'PENDING'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid claim code or order not ready for fulfillment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_shops
    WHERE user_id = p_merchant_user_id AND shop_id = v_order.shop_id
  ) THEN
    RAISE EXCEPTION 'Forbidden: merchant not assigned to this shop';
  END IF;

  UPDATE public.shop_orders
  SET claim_status = 'PROCESSING_FULFILLMENT'
  WHERE shop_order_id = v_order.shop_order_id
    AND claim_status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order lock failed';
  END IF;

  SELECT COUNT(*) INTO v_total_items FROM public.order_items WHERE shop_order_id = v_order.shop_order_id;
  SELECT COUNT(*) INTO v_covered
  FROM public.order_items
  WHERE shop_order_id = v_order.shop_order_id
    AND order_item_id = ANY (p_present_item_ids || p_missing_item_ids);

  IF v_covered <> v_total_items THEN
    UPDATE public.shop_orders SET claim_status = 'PENDING' WHERE shop_order_id = v_order.shop_order_id;
    RAISE EXCEPTION 'All order items must be marked present or missing';
  END IF;

  IF COALESCE(array_length(p_present_item_ids, 1), 0) = 0 AND COALESCE(array_length(p_missing_item_ids, 1), 0) = 0 THEN
    UPDATE public.shop_orders SET claim_status = 'PENDING' WHERE shop_order_id = v_order.shop_order_id;
    RAISE EXCEPTION 'At least one item must be present or missing';
  END IF;

  IF COALESCE(array_length(p_present_item_ids, 1), 0) > 0 THEN
    UPDATE public.order_items
    SET fulfillment_status = 'COLLECTED', fulfilled_at = now()
    WHERE shop_order_id = v_order.shop_order_id
      AND order_item_id = ANY (p_present_item_ids);
  END IF;

  IF COALESCE(array_length(p_missing_item_ids, 1), 0) > 0 THEN
    UPDATE public.order_items
    SET fulfillment_status = 'MISSING'
    WHERE shop_order_id = v_order.shop_order_id
      AND order_item_id = ANY (p_missing_item_ids);
  END IF;

  FOR v_row IN
    SELECT order_item_id, allocated_price
    FROM public.order_items
    WHERE shop_order_id = v_order.shop_order_id
      AND order_item_id = ANY (p_present_item_ids || p_missing_item_ids)
  LOOP
    IF v_row.order_item_id = ANY (p_present_item_ids) THEN
      v_present_total := v_present_total + v_row.allocated_price;
    ELSE
      v_missing_total := v_missing_total + v_row.allocated_price;
    END IF;
  END LOOP;

  IF v_present_total > 0 THEN
    INSERT INTO public.payout_ledger (shop_order_id, shop_id, credit_amount, ledger_type, reference)
    VALUES (v_order.shop_order_id, v_order.shop_id, v_present_total, 'FULFILLMENT_CREDIT', upper(trim(p_claim_code)));
  END IF;

  IF v_missing_total > 0 THEN
    PERFORM public.increment_wallet_balance(
      (SELECT buyer_id FROM public.transactions WHERE transaction_id = v_order.transaction_id),
      v_missing_total,
      'PARTIAL_REFUND:' || upper(trim(p_claim_code)),
      v_order.shop_order_id
    );
  END IF;

  -- ── Upfront advance, if the shop's trust tier has earned one ──────────────
  SELECT upfront_payout_percentage, float_exposure_limit, active_exposure
  INTO v_shop
  FROM public.shops
  WHERE id = v_order.shop_id
  FOR UPDATE;

  IF v_present_total > 0 AND v_shop.upfront_payout_percentage > 0 THEN
    v_share := public.merchant_share_for(v_present_total);
    v_upfront := floor(v_share * v_shop.upfront_payout_percentage / 100.0)::integer;

    -- Never advance past the shop's exposure ceiling. Advancing part of the
    -- amount is better than refusing the fulfilment outright.
    v_headroom := GREATEST(v_shop.float_exposure_limit - v_shop.active_exposure, 0);
    v_upfront := LEAST(v_upfront, v_headroom);

    IF v_upfront > 0 THEN
      PERFORM public.increment_merchant_balance(v_order.shop_id, v_upfront);

      INSERT INTO public.merchant_float_ledger (shop_id, shop_order_id, amount, entry_type, description)
      VALUES (v_order.shop_id, v_order.shop_order_id, v_upfront, 'UPFRONT_ADVANCE',
              'Upfront release at fulfilment');

      UPDATE public.shops
      SET active_exposure = active_exposure + v_upfront,
          float_balance   = float_balance + v_upfront
      WHERE id = v_order.shop_id;
    END IF;
  END IF;

  v_claim_status := CASE WHEN COALESCE(array_length(p_missing_item_ids, 1), 0) > 0 THEN 'PARTIAL_FULFILLMENT' ELSE 'FULFILLED' END;

  SELECT COALESCE(dispute_window_minutes, 1440) INTO v_window_minutes
  FROM public.platform_settings WHERE id = 1;

  v_settlement_time := now() + make_interval(mins => COALESCE(v_window_minutes, 1440));

  UPDATE public.shop_orders
  SET claim_status = v_claim_status,
      settlement_target_time = v_settlement_time,
      upfront_paid = v_upfront,
      fulfilled_at = now()
  WHERE shop_order_id = v_order.shop_order_id
    AND claim_status = 'PROCESSING_FULFILLMENT';

  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (
    v_order.transaction_id,
    'CLAIM_VERIFIED',
    jsonb_build_object(
      'shop_order_id', v_order.shop_order_id,
      'merchant_user_id', p_merchant_user_id,
      'claim_code', upper(trim(p_claim_code)),
      'present_total', v_present_total,
      'missing_total', v_missing_total,
      'upfront_released', v_upfront,
      'settlement_target_time', v_settlement_time
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_status', v_claim_status,
    'merchant_credit_zmw', v_present_total,
    'sender_refund_zmw', v_missing_total,
    'upfront_released_zmw', v_upfront,
    'settlement_target_time', v_settlement_time
  );
EXCEPTION
  WHEN OTHERS THEN
    UPDATE public.shop_orders
    SET claim_status = 'PENDING'
    WHERE shop_order_id = v_order.shop_order_id
      AND claim_status = 'PROCESSING_FULFILLMENT';
    RAISE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 14. Grants — money movement stays on the service role. `raise_order_dispute`
--     is the one exception: the buyer calls it directly.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apply_merchant_settlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_redemption(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_due_redemptions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_shop_trust_tier(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_share_for(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raise_order_dispute(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.complete_redemption(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_due_redemptions() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_shop_trust_tier(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.raise_order_dispute(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 15. Schedule the sweep
--
-- Every minute, so a five-minute testing window behaves as written. The query
-- is index-backed and does nothing when no order is due.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('process-due-redemptions-job')
  FROM cron.job WHERE jobname = 'process-due-redemptions-job';

SELECT cron.schedule(
  'process-due-redemptions-job',
  '* * * * *',
  $$ SELECT public.process_due_redemptions(); $$
);
