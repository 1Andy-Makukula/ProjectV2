-- =============================================================================
-- Expiry: refund to source, and compensation only where it was disclosed
--
-- WHAT IS WRONG WITH THE CURRENT BEHAVIOUR
-- ----------------------------------------
-- Today an expired gift splits 80/20: the sender gets 80% back as wallet
-- credit and the shop is credited 20%. Two things are wrong with that, and
-- they are wrong in different ways.
--
-- The refund is wrong because a wallet credit is not a refund. The sender paid
-- with a card or with mobile money; giving them KithLy credit converts their
-- money into a token they can only spend with us. That is stored value, it is
-- a licensed activity, and from the sender's point of view it is a service
-- they did not receive being paid for in scrip.
--
-- The split is wrong because it is blanket. If the shop never reserved
-- anything for this order, they have lost nothing by it going uncollected, and
-- taking a fifth of the sender's money to compensate a loss that did not occur
-- is difficult to defend to the sender, and impossible to defend to a
-- regulator. Worse, it happens silently: the sender is never told at checkout
-- that this is the deal.
--
-- WHAT REPLACES IT
-- ----------------
-- Refunds go to the original payment method, always (§4.5). Compensation is
-- conditional and disclosed (§7): a merchant marks an item `compensation
-- eligible` at listing time, with a percentage, where they genuinely hold or
-- prepare stock -- perishables, made-to-order, reserved inventory. The sender
-- sees those terms at checkout, before paying. Anything not marked eligible
-- refunds in full.
--
-- WHY THE PERCENTAGE IS SNAPSHOTTED ONTO THE ORDER
-- ------------------------------------------------
-- The disclosed terms are the contract. If compensation were read from `items`
-- at expiry, a merchant could raise the percentage after the sale and take a
-- larger share of a gift that was bought under different terms. The snapshot
-- is taken by trigger at the moment the order line is written, so no call site
-- -- including checkout_init_atomic, which ADR 0001 freezes -- has to remember
-- to do it.
--
-- PREVENTION BEATS ALL OF IT
-- --------------------------
-- A collected gift is worth more to everyone than any split of an uncollected
-- one. Expiry reminders already dispatch; `extend_voucher_window` gives the
-- reminder a one-tap answer.
--
-- BLAST RADIUS: adds columns to `items` and `order_items`, a new table, and a
-- new sweep. The legacy `process_expired_vouchers` is left in place and keeps
-- running until escrow_mode reaches escrow_v2 -- 20260915070000 is what stops
-- it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Compensation terms on the item (§7)
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS compensation_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS compensation_percent integer NOT NULL DEFAULT 0;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS compensation_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_compensation_percent_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_compensation_percent_check
      CHECK (compensation_percent BETWEEN 0 AND 100);
  END IF;

  -- The two fields cannot disagree. An "eligible" item with a zero percentage
  -- discloses a term that does nothing; a percentage on an ineligible item is
  -- a number waiting for someone to start reading it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_compensation_coherent_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_compensation_coherent_check
      CHECK (
        (compensation_eligible AND compensation_percent > 0)
        OR (NOT compensation_eligible AND compensation_percent = 0)
      );
  END IF;

  -- A merchant claiming compensation must say what they are holding. It is
  -- shown to the sender at checkout, so it cannot be blank.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_compensation_reason_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_compensation_reason_check
      CHECK (NOT compensation_eligible OR COALESCE(btrim(compensation_reason), '') <> '');
  END IF;
END $$;

COMMENT ON COLUMN public.items.compensation_eligible IS
  'The merchant genuinely holds or prepares stock for this item, so an '
  'uncollected order costs them something. Disclosed to the sender at checkout.';

-- ---------------------------------------------------------------------------
-- 2. The snapshot on the order line
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS compensation_percent_at_purchase integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_compensation_percent_check') THEN
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_compensation_percent_check
      CHECK (compensation_percent_at_purchase BETWEEN 0 AND 100);
  END IF;
END $$;

COMMENT ON COLUMN public.order_items.compensation_percent_at_purchase IS
  'The compensation term disclosed to the sender when they paid. The contract, '
  'not the current listing. Set by trigger; never written by a call site.';

-- A trigger rather than an edit to every checkout path. `checkout_init_atomic`
-- is signature-frozen by ADR 0001 and has been redefined fourteen times; this
-- is the change that does not touch it.
CREATE OR REPLACE FUNCTION public.snapshot_compensation_terms()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only ever fills in a zero. If a caller supplied a value deliberately --
  -- a correction, a backfill -- it is left alone.
  IF COALESCE(NEW.compensation_percent_at_purchase, 0) = 0 THEN
    SELECT CASE WHEN i.compensation_eligible THEN i.compensation_percent ELSE 0 END
    INTO NEW.compensation_percent_at_purchase
    FROM public.items i
    WHERE i.id = NEW.item_id;
  END IF;

  NEW.compensation_percent_at_purchase := COALESCE(NEW.compensation_percent_at_purchase, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_compensation_terms ON public.order_items;
CREATE TRIGGER trg_snapshot_compensation_terms
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_compensation_terms();

COMMENT ON COLUMN public.platform_settings.expiry_sender_refund_percent IS
  'DEPRECATED as of 20260915050000. The blanket 80/20 expiry split is replaced '
  'by per-item, disclosed compensation (§7). Read only by the legacy '
  'process_expired_vouchers, which stops running at escrow_v2.';

-- ---------------------------------------------------------------------------
-- 3. Refunds (§4.5, §6.3)
--
-- A refund is an outbound instruction to Flutterwave, so it has the same shape
-- as a payout: a queue, attempts, and a ledger pair written only on success.
--
-- REFUND_PENDING is the state §6.3 calls a holding state, and the distinction
-- from a wallet matters: the sender cannot spend it, cannot direct it, and
-- cannot see it as a balance. It is money KithLy still owes them and has not
-- yet managed to return. It is also the one place in this model where value
-- rests with no active counterparty, which is why it needs a written unclaimed
-- funds policy before launch (§10) rather than a default someone invents here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid REFERENCES public.transactions(transaction_id) ON DELETE SET NULL,
  shop_order_id   uuid REFERENCES public.shop_orders(shop_order_id) ON DELETE SET NULL,
  order_item_id   uuid,
  buyer_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,

  amount_ngwee    bigint NOT NULL,
  reason          text NOT NULL,

  status          text NOT NULL DEFAULT 'SCHEDULED',
  release_at      timestamptz NOT NULL DEFAULT now(),

  attempt_count   integer NOT NULL DEFAULT 0,
  last_error      text,

  -- Flutterwave's refund id.
  external_ref    text,
  -- The gateway reference of the original charge -- what a refund is issued
  -- against. Captured at creation because the transaction row may be archived.
  original_ref    text,

  idempotency_key text NOT NULL UNIQUE,
  ledger_pair_id  uuid,

  claimed_at      timestamptz,
  sent_at         timestamptz,
  completed_at    timestamptz,
  failed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT refund_requests_amount_check CHECK (amount_ngwee > 0),
  CONSTRAINT refund_requests_reason_check
    CHECK (reason IN ('EXPIRY', 'ITEM_UNAVAILABLE', 'CANCELLATION', 'DISPUTE', 'ADMIN')),
  CONSTRAINT refund_requests_status_check CHECK (
    status IN (
      'SCHEDULED',
      'CLAIMED',
      'SENT',
      'COMPLETED',
      'FAILED',          -- will retry
      'REFUND_PENDING',  -- retries exhausted; awaiting alternative details (§6.3)
      'UNCLAIMED'        -- per the unclaimed funds policy, once one exists
    )
  ),
  CONSTRAINT refund_requests_completed_check
    CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND ledger_pair_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS refund_requests_due_idx
  ON public.refund_requests (release_at)
  WHERE status IN ('SCHEDULED', 'FAILED');

CREATE INDEX IF NOT EXISTS refund_requests_buyer_idx
  ON public.refund_requests (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS refund_requests_attention_idx
  ON public.refund_requests (status)
  WHERE status IN ('REFUND_PENDING', 'UNCLAIMED');

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_requests_select ON public.refund_requests;
CREATE POLICY refund_requests_select ON public.refund_requests
  FOR SELECT TO authenticated
  USING (buyer_id = auth.uid() OR public.current_user_role() = 'admin');

COMMENT ON TABLE public.refund_requests IS
  'Refunds to the original payment method. REFUND_PENDING is a holding state, '
  'not a balance: the sender cannot spend or direct it.';

-- ---------------------------------------------------------------------------
-- 4. The expiry sweep (§4.5)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_process_expiries(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item        RECORD;
  v_value       bigint;
  v_comp        bigint;
  v_refund      bigint;
  v_count       integer := 0;
  v_comp_total  bigint := 0;
  v_refund_total bigint := 0;
  v_hold        integer;
  v_owner_id    uuid;
BEGIN
  FOR v_item IN
    SELECT oi.order_item_id,
           oi.allocated_price,
           oi.shop_order_id,
           oi.compensation_percent_at_purchase,
           oi.fulfillment_status,
           so.transaction_id,
           so.shop_id,
           so.claim_code,
           t.buyer_id,
           t.gateway_tx_ref
    FROM public.order_items oi
    JOIN public.shop_orders so ON oi.shop_order_id = so.shop_order_id
    JOIN public.transactions t ON so.transaction_id = t.transaction_id
    JOIN public.items it ON it.id = oi.item_id
    WHERE oi.fulfillment_status IN ('PENDING', 'FLOATING', 'MISSING')
      AND so.claim_status NOT IN ('CANCELLED', 'EXPIRED', 'REFUNDED')
      AND so.disputed_at IS NULL
      AND t.buyer_id IS NOT NULL
      AND (
        -- A merchant who says the item is unavailable has ended the sender's
        -- chance of collecting it at that shop. Holding their money until the
        -- window runs out would be punishing them for the shop's stockout, so
        -- MISSING refunds immediately rather than waiting.
        oi.fulfillment_status = 'MISSING'
        OR (
          COALESCE(it.has_expiry, true)
          AND COALESCE(
                so.expires_at,
                public.voucher_expiry_at(
                  oi.created_at, so.target_execution_date,
                  it.requires_scheduling, it.valid_for_days
                )
              ) <= now()
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.refund_requests r WHERE r.order_item_id = oi.order_item_id
      )
    ORDER BY oi.created_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE OF oi
  LOOP
    v_value := public.zmw_to_ngwee(v_item.allocated_price);
    CONTINUE WHEN v_value <= 0;

    -- §7: compensation only where it was disclosed, and only on a genuine
    -- expiry. An item the shop could not supply earns them nothing.
    IF v_item.fulfillment_status = 'MISSING' THEN
      v_comp := 0;
    ELSE
      v_comp := floor(v_value * COALESCE(v_item.compensation_percent_at_purchase, 0) / 100.0)::bigint;
    END IF;
    v_comp := LEAST(GREATEST(v_comp, 0), v_value);
    v_refund := v_value - v_comp;

    UPDATE public.order_items
    SET fulfillment_status = 'EXPIRED', fulfilled_at = now()
    WHERE order_item_id = v_item.order_item_id;

    IF v_comp > 0 THEN
      PERFORM public.post_ledger_pair(
        'SENDER_LIABILITY', v_item.buyer_id,
        'MERCHANT_PAYABLE', v_item.shop_id,
        v_comp,
        'EXPIRY_COMPENSATION',
        v_item.transaction_id, v_item.shop_order_id, v_item.order_item_id,
        v_item.claim_code,
        'expiry-comp:' || v_item.order_item_id::text
      );

      -- Compensation is money owed, so it is paid out like any other payable
      -- -- through the tier, through the queue, to a verified destination.
      IF public.shop_can_accept_redemptions(v_item.shop_id) THEN
        v_hold := public.shop_settlement_hold_seconds(v_item.shop_id);
        PERFORM public.enqueue_payout(
          v_item.shop_id, v_comp,
          'expiry-comp-payout:' || v_item.order_item_id::text,
          v_item.shop_order_id, v_item.order_item_id,
          now() + make_interval(secs => COALESCE(v_hold, 0))
        );
      END IF;

      v_comp_total := v_comp_total + v_comp;
    END IF;

    IF v_refund > 0 THEN
      INSERT INTO public.refund_requests (
        transaction_id, shop_order_id, order_item_id, buyer_id,
        amount_ngwee, reason, original_ref, idempotency_key
      )
      VALUES (
        v_item.transaction_id, v_item.shop_order_id, v_item.order_item_id, v_item.buyer_id,
        v_refund,
        CASE WHEN v_item.fulfillment_status = 'MISSING' THEN 'ITEM_UNAVAILABLE' ELSE 'EXPIRY' END,
        v_item.gateway_tx_ref,
        'refund:' || v_item.order_item_id::text
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

      v_refund_total := v_refund_total + v_refund;
    END IF;

    v_count := v_count + 1;

    INSERT INTO public.transaction_events (transaction_id, shop_order_id, event_type, payload)
    VALUES (v_item.transaction_id, v_item.shop_order_id, 'ESCROW_EXPIRED', jsonb_build_object(
      'order_item_id', v_item.order_item_id,
      'value_ngwee', v_value,
      'compensation_ngwee', v_comp,
      'refund_ngwee', v_refund,
      'compensation_percent', COALESCE(v_item.compensation_percent_at_purchase, 0),
      'was_missing', v_item.fulfillment_status = 'MISSING'
    ));

    PERFORM public.create_notification(
      v_item.buyer_id,
      CASE
        WHEN v_item.fulfillment_status = 'MISSING' THEN
          'An item on gift ' || COALESCE(v_item.claim_code, '') || ' was unavailable. '
            || 'We are refunding it to the card or account you paid with.'
        WHEN v_comp > 0 THEN
          'Gift ' || COALESCE(v_item.claim_code, '') || ' went uncollected. '
            || 'As shown at checkout, the shop keeps '
            || COALESCE(v_item.compensation_percent_at_purchase, 0)::text
            || '% for the stock they held; the rest is on its way back to the way you paid.'
        ELSE
          'Gift ' || COALESCE(v_item.claim_code, '') || ' went uncollected. '
            || 'We are refunding it in full to the card or account you paid with.'
      END,
      'warning', v_item.shop_order_id::text
    );

    IF v_comp > 0 THEN
      SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_item.shop_id;
      IF v_owner_id IS NOT NULL THEN
        PERFORM public.create_notification(
          v_owner_id,
          'Gift ' || COALESCE(v_item.claim_code, '') || ' expired uncollected. '
            || 'Your agreed share is on its way to you.',
          'info', v_item.shop_id::text
        );
      END IF;
    END IF;
  END LOOP;

  -- Orders with nothing left open are closed out.
  UPDATE public.shop_orders so
  SET claim_status = 'EXPIRED'
  WHERE so.claim_status NOT IN ('CANCELLED', 'EXPIRED', 'REFUNDED', 'REDEEMED')
    AND EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.shop_order_id = so.shop_order_id AND oi.fulfillment_status = 'EXPIRED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.shop_order_id = so.shop_order_id
        AND oi.fulfillment_status IN ('PENDING', 'FLOATING', 'MISSING')
    );

  RETURN jsonb_build_object(
    'items_expired', v_count,
    'compensation_ngwee', v_comp_total,
    'refunds_created_ngwee', v_refund_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Refund dispatch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_refunds(p_limit integer DEFAULT 25)
RETURNS TABLE (
  id              uuid,
  buyer_id        uuid,
  transaction_id  uuid,
  amount_ngwee    bigint,
  original_ref    text,
  idempotency_key text,
  attempt_count   integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT r.id
    FROM public.refund_requests r
    WHERE r.status IN ('SCHEDULED', 'FAILED')
      AND r.release_at <= now()
      AND public.rail_is_available('flutterwave')
    ORDER BY r.release_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE public.refund_requests r
  SET status = 'CLAIMED', claimed_at = now(), attempt_count = r.attempt_count + 1
  FROM due
  WHERE r.id = due.id
  RETURNING r.id, r.buyer_id, r.transaction_id, r.amount_ngwee,
            r.original_ref, r.idempotency_key, r.attempt_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_refund(
  p_refund_id    uuid,
  p_external_ref text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row  RECORD;
  v_pair uuid;
BEGIN
  SELECT * INTO v_row FROM public.refund_requests
  WHERE id = p_refund_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_refund: no refund %', p_refund_id;
  END IF;

  IF v_row.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'COMPLETED',
                              'ledger_pair_id', v_row.ledger_pair_id, 'already_completed', true);
  END IF;

  v_pair := public.post_ledger_pair(
    'SENDER_LIABILITY', v_row.buyer_id,
    'CLIENT_FUNDS',     NULL,
    v_row.amount_ngwee,
    'EXPIRY_REFUND',
    v_row.transaction_id, v_row.shop_order_id, v_row.order_item_id,
    p_external_ref,
    'refund-paid:' || v_row.idempotency_key
  );

  UPDATE public.refund_requests
  SET status = 'COMPLETED', completed_at = now(),
      external_ref = COALESCE(p_external_ref, external_ref),
      ledger_pair_id = v_pair, last_error = NULL
  WHERE id = p_refund_id;

  PERFORM public.record_rail_outcome('flutterwave', true, NULL);

  PERFORM public.create_notification(
    v_row.buyer_id,
    'Your refund of ' || to_char(v_row.amount_ngwee / 100.0, 'FM999G999D00')
      || ' ZMW is on its way back to the way you paid.',
    'success', COALESCE(v_row.shop_order_id::text, p_refund_id::text)
  );

  RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'COMPLETED',
                            'ledger_pair_id', v_pair, 'already_completed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_refund(
  p_refund_id uuid,
  p_error     text,
  p_retryable boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row     RECORD;
  v_max     integer;
  v_status  text;
  v_backoff interval;
BEGIN
  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fail_refund: no refund %', p_refund_id;
  END IF;

  IF v_row.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'fail_refund: refund % already completed', p_refund_id;
  END IF;

  SELECT COALESCE(payout_max_attempts, 6) INTO v_max FROM public.platform_settings WHERE id = 1;
  v_max := COALESCE(v_max, 6);

  IF NOT p_retryable OR v_row.attempt_count >= v_max THEN
    -- §6.3. Not a failure to be forgotten: a state someone owns.
    v_status := 'REFUND_PENDING';
    v_backoff := interval '0';
  ELSE
    v_status := 'FAILED';
    v_backoff := LEAST(
      make_interval(hours => (2 ^ LEAST(v_row.attempt_count, 6))::integer),
      interval '24 hours'
    );
  END IF;

  UPDATE public.refund_requests
  SET status = v_status, failed_at = now(), last_error = p_error,
      release_at = now() + v_backoff
  WHERE id = p_refund_id;

  PERFORM public.record_rail_outcome('flutterwave', false, p_error);

  INSERT INTO public.transaction_events (transaction_id, shop_order_id, event_type, payload)
  VALUES (v_row.transaction_id, v_row.shop_order_id, 'REFUND_FAILED', jsonb_build_object(
    'refund_id', p_refund_id, 'amount_ngwee', v_row.amount_ngwee,
    'attempt', v_row.attempt_count, 'status', v_status, 'error', p_error
  ));

  IF v_status = 'REFUND_PENDING' THEN
    PERFORM public.create_notification(
      v_row.buyer_id,
      'We could not return ' || to_char(v_row.amount_ngwee / 100.0, 'FM999G999D00')
        || ' ZMW to your original payment method. Your money is safe and we will '
        || 'contact you to arrange another way to send it.',
      'warning', COALESCE(v_row.shop_order_id::text, p_refund_id::text)
    );
  END IF;

  RETURN jsonb_build_object('refund_id', p_refund_id, 'status', v_status,
                            'attempt', v_row.attempt_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. One-tap extension (§7, "prefer prevention")
--
-- The reminder that already goes out every fifteen minutes becomes actionable.
-- Capped, because an unlimited extension is just a voucher with no expiry, and
-- the redemption window is what bounds KithLy's float and its custody period.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS expiry_extensions integer NOT NULL DEFAULT 0;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS max_expiry_extensions integer NOT NULL DEFAULT 2;
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS expiry_extension_days integer NOT NULL DEFAULT 7;

CREATE OR REPLACE FUNCTION public.extend_voucher_window(
  p_shop_order_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order   RECORD;
  v_max     integer;
  v_days    integer;
  v_current timestamptz;
  v_new     timestamptz;
BEGIN
  SELECT so.shop_order_id, so.transaction_id, so.claim_status, so.expires_at,
         so.expiry_extensions, so.claim_code, t.buyer_id
  INTO v_order
  FROM public.shop_orders so
  JOIN public.transactions t ON t.transaction_id = so.transaction_id
  WHERE so.shop_order_id = p_shop_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such gift';
  END IF;

  -- The sender paid for it, so the sender may extend it. Admins can too.
  IF v_order.buyer_id <> p_actor_user_id
     AND COALESCE(public.current_user_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Forbidden: only the sender can extend this gift';
  END IF;

  IF v_order.claim_status IN ('REDEEMED', 'CANCELLED', 'EXPIRED', 'REFUNDED') THEN
    RAISE EXCEPTION 'This gift is already % and cannot be extended', lower(v_order.claim_status);
  END IF;

  SELECT COALESCE(max_expiry_extensions, 2), COALESCE(expiry_extension_days, 7)
  INTO v_max, v_days FROM public.platform_settings WHERE id = 1;
  v_max := COALESCE(v_max, 2); v_days := COALESCE(v_days, 7);

  IF COALESCE(v_order.expiry_extensions, 0) >= v_max THEN
    RAISE EXCEPTION 'This gift has already been extended the maximum of % times', v_max;
  END IF;

  -- Extend from whichever is later: an extension granted a week early should
  -- not shorten the window it was meant to lengthen.
  v_current := GREATEST(COALESCE(v_order.expires_at, now()), now());
  v_new := v_current + make_interval(days => v_days);

  UPDATE public.shop_orders
  SET expires_at = v_new, expiry_extensions = COALESCE(expiry_extensions, 0) + 1
  WHERE shop_order_id = p_shop_order_id;

  INSERT INTO public.transaction_events (transaction_id, shop_order_id, event_type, payload)
  VALUES (v_order.transaction_id, p_shop_order_id, 'VOUCHER_WINDOW_EXTENDED', jsonb_build_object(
    'actor', p_actor_user_id, 'from', v_order.expires_at, 'to', v_new,
    'extension_number', COALESCE(v_order.expiry_extensions, 0) + 1
  ));

  RETURN jsonb_build_object(
    'shop_order_id', p_shop_order_id,
    'expires_at', v_new,
    'extensions_used', COALESCE(v_order.expiry_extensions, 0) + 1,
    'extensions_remaining', v_max - (COALESCE(v_order.expiry_extensions, 0) + 1)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.snapshot_compensation_terms() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escrow_process_expiries(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_refunds(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_refund(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_refund(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extend_voucher_window(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.escrow_process_expiries(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_refunds(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_refund(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_refund(uuid, text, boolean) TO service_role;

-- The extension is a one-tap action from a reminder. It moves no money -- it
-- moves a date -- and it is authorised against the sender inside the function,
-- so the sender may call it directly.
GRANT EXECUTE ON FUNCTION public.extend_voucher_window(uuid, uuid) TO service_role, authenticated;

GRANT SELECT ON public.refund_requests TO authenticated;
