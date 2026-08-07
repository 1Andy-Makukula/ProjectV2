-- =============================================================================
-- Phase 4 — Stock tracking
--
-- The only money-path change in this batch of work. Read the two safety
-- properties below before changing anything here.
--
-- ---------------------------------------------------------------------------
-- 1. NULL means "not tracked", and that is what keeps this safe
-- ---------------------------------------------------------------------------
-- stock_quantity is nullable and defaults to NULL. Every item in the catalogue
-- today therefore starts untracked, and untracked items are never checked and
-- never decremented — checkout behaves exactly as it does now until a merchant
-- deliberately types a number in. A NOT NULL DEFAULT 0 would have made the
-- entire catalogue unpurchasable the moment this migration ran.
--
-- Services are the same: most are not stock-limited, so they simply stay NULL.
--
-- ---------------------------------------------------------------------------
-- 2. stock_quantity is independent of is_available
-- ---------------------------------------------------------------------------
-- useStorefrontData, useSearch, useItemDetail and useWeeklyPicks all filter on
-- `.eq('is_available', true)` at the query level. If running out of stock
-- flipped that flag the product would vanish from the storefront rather than
-- grey out, which is the opposite of the intended behaviour. So:
--
--     is_available = false   merchant delisted it     -> hidden entirely
--     stock_quantity = 0     temporarily sold out     -> still listed, greyed
--
-- ---------------------------------------------------------------------------
-- 3. Where quantity comes from
-- ---------------------------------------------------------------------------
-- checkout-init expresses quantity by repeating an item id in `item_ids`
-- ("Add multiple times based on quantity"), and one order_items row is written
-- per occurrence. The decrement below therefore aggregates occurrences per item
-- rather than assuming one unit per line.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS stock_quantity integer;
COMMENT ON COLUMN public.items.stock_quantity IS
  'Units on hand. NULL = not tracked (unlimited); 0 = temporarily out of stock but still listed.';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS stock_baseline integer;
COMMENT ON COLUMN public.items.stock_baseline IS
  'High-water mark since the last restock. The low-stock threshold is a percentage of this, not of the current count.';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS stock_alert_level text;
COMMENT ON COLUMN public.items.stock_alert_level IS
  'Which stock warning has already been sent, so the nightly sweep notifies once per restock cycle instead of every night.';

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS low_stock_percent integer NOT NULL DEFAULT 30;
COMMENT ON COLUMN public.platform_settings.low_stock_percent IS
  'Share of stock_baseline at or below which the merchant is warned to restock.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_stock_quantity_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_stock_quantity_check
      CHECK (stock_quantity IS NULL OR stock_quantity >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_stock_baseline_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_stock_baseline_check
      CHECK (stock_baseline IS NULL OR stock_baseline >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_stock_alert_level_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_stock_alert_level_check
      CHECK (stock_alert_level IS NULL OR stock_alert_level IN ('low', 'out'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_low_stock_percent_check') THEN
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_low_stock_percent_check
      CHECK (low_stock_percent > 0 AND low_stock_percent <= 100);
  END IF;
END $$;

-- Only tracked items are ever swept.
CREATE INDEX IF NOT EXISTS items_stock_quantity_idx
  ON public.items (stock_quantity)
  WHERE stock_quantity IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The low-stock threshold
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.low_stock_threshold(p_baseline integer)
RETURNS integer
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT GREATEST(
    1,
    ceil(
      COALESCE(p_baseline, 0)
      * COALESCE((SELECT low_stock_percent FROM public.platform_settings WHERE id = 1), 30)
      / 100.0
    )::integer
  )
$$;

REVOKE ALL ON FUNCTION public.low_stock_threshold(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.low_stock_threshold(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Baseline tracking
--
-- The baseline only ever rises. That matters because expiry restores push the
-- quantity back up by a unit at a time: if the baseline followed the current
-- count downwards, the 30% threshold would drift down with it and the warning
-- would never fire again.
--
-- Scoped to `UPDATE OF stock_quantity` so the sweep writing stock_alert_level
-- does not re-enter this and clear the very flag it just set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_stock_baseline()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.stock_quantity IS NULL THEN
    -- Switched back to untracked: nothing left to warn about.
    NEW.stock_baseline := NULL;
    NEW.stock_alert_level := NULL;
    RETURN NEW;
  END IF;

  NEW.stock_baseline := GREATEST(
    COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.stock_baseline END, 0),
    NEW.stock_quantity
  );

  -- Comfortably restocked, so the next dip warns again.
  IF NEW.stock_quantity > public.low_stock_threshold(NEW.stock_baseline) THEN
    NEW.stock_alert_level := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_track_stock_baseline ON public.items;
CREATE TRIGGER items_track_stock_baseline
  BEFORE INSERT OR UPDATE OF stock_quantity ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.track_stock_baseline();

-- ---------------------------------------------------------------------------
-- 4. Returning stock when a voucher lapses
--
-- Both process_expired_vouchers and admin_expire_order write
-- fulfillment_status = 'EXPIRED' through their own loops, and a third path
-- could be added later. Restoring from a trigger on the transition means the
-- rule lives in one place and neither money function has to be reopened.
--
-- EXPIRED only. Deliberately NOT restored on:
--   MISSING  — the merchant has just told us the item was not there, so adding
--              a unit back would re-enable selling something they do not have.
--   disputed — raise_order_dispute is a hold, not an outcome; the order may yet
--              be collected, and restoring now would double-count it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_stock_on_expiry()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  UPDATE public.items
  SET stock_quantity = stock_quantity + 1
  WHERE id = NEW.item_id
    AND stock_quantity IS NOT NULL;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS order_items_restore_stock ON public.order_items;
CREATE TRIGGER order_items_restore_stock
  AFTER UPDATE OF fulfillment_status ON public.order_items
  FOR EACH ROW
  WHEN (NEW.fulfillment_status = 'EXPIRED' AND OLD.fulfillment_status IS DISTINCT FROM 'EXPIRED')
  EXECUTE FUNCTION public.restore_stock_on_expiry();

-- ---------------------------------------------------------------------------
-- 5. checkout_init_atomic — reserve stock inside the existing transaction
--
-- Unchanged from 20260730020000 apart from the single new block marked below.
-- The signature is identical, so this is a plain CREATE OR REPLACE.
--
-- The new pass runs after prices are verified and before any money is written,
-- and it locks each item row FOR UPDATE in a deterministic id order so two
-- concurrent checkouts for the same basket cannot deadlock or oversell.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.checkout_init_atomic(
  p_buyer_id UUID,
  p_origin_type TEXT,
  p_gateway_tx_ref TEXT,
  p_vendors JSONB,
  p_recipient_name TEXT DEFAULT NULL,
  p_recipient_phone TEXT DEFAULT NULL,
  p_message TEXT DEFAULT NULL,
  p_sender_phone TEXT DEFAULT NULL,
  p_credits_to_apply INTEGER DEFAULT 0,
  p_target_execution_date TIMESTAMPTZ DEFAULT NULL,
  p_experience_id UUID DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_vendor JSONB;
  v_item_id TEXT;
  v_shop_id UUID;
  v_transaction_id UUID;
  v_grand_total INTEGER := 0;
  v_subtotal INTEGER;
  v_price INTEGER;
  v_claim_code TEXT;
  v_shop_order_id UUID;
  v_shop_orders JSONB := '[]'::JSONB;
  v_item_ids JSONB;
  i INTEGER;

  v_wallet_id UUID;
  v_wallet_balance INTEGER;
  v_platform_fee INTEGER := 0;
  v_gross_payable INTEGER;
  v_cash_payable INTEGER;
  v_tx_status TEXT := 'GATEWAY_PROCESSING';
  v_order_claim_status TEXT := 'PENDING_PAYMENT';
  v_expires_at TIMESTAMPTZ := p_expires_at;

  v_stock RECORD;
  v_on_hand INTEGER;
  v_item_name TEXT;
BEGIN
  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF p_credits_to_apply < 0 THEN
    RAISE EXCEPTION 'Credits to apply cannot be negative';
  END IF;

  -- Trust the experience's own deadline over anything the client sent.
  IF p_experience_id IS NOT NULL THEN
    SELECT expires_at INTO v_expires_at FROM public.experiences WHERE id = p_experience_id;
  END IF;

  IF p_credits_to_apply > 0 THEN
    SELECT id, balance INTO v_wallet_id, v_wallet_balance
    FROM public.kithly_wallets
    WHERE user_id = p_buyer_id
    FOR UPDATE;

    IF v_wallet_id IS NULL OR v_wallet_balance < p_credits_to_apply THEN
      RAISE EXCEPTION 'Insufficient wallet balance for applying credits';
    END IF;
  END IF;

  FOR v_vendor IN SELECT * FROM jsonb_array_elements(p_vendors) LOOP
    v_shop_id := (v_vendor->>'shop_id')::UUID;
    v_subtotal := 0;
    v_item_ids := v_vendor->'item_ids';
    IF v_item_ids IS NULL OR jsonb_array_length(v_item_ids) = 0 THEN
      RAISE EXCEPTION 'Vendor group has no items';
    END IF;
    FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
      v_item_id := v_item_ids->>i;
      SELECT price_zmw INTO v_price FROM public.items WHERE id = v_item_id::UUID AND is_available IS NOT FALSE;
      IF v_price IS NULL THEN
        RAISE EXCEPTION 'Item % is invalid or unavailable', v_item_id;
      END IF;
      v_subtotal := v_subtotal + v_price;
    END LOOP;
    v_grand_total := v_grand_total + v_subtotal;
  END LOOP;

  -- ===== NEW: reserve stock ================================================
  -- Aggregated per item because quantity arrives as repeated ids. Untracked
  -- items (stock_quantity IS NULL) are skipped entirely.
  FOR v_stock IN
    SELECT e.value::UUID AS item_id, count(*)::INTEGER AS qty
    FROM jsonb_array_elements(p_vendors) AS v,
         jsonb_array_elements_text(v->'item_ids') AS e(value)
    GROUP BY e.value
    ORDER BY 1
  LOOP
    SELECT stock_quantity, name INTO v_on_hand, v_item_name
    FROM public.items
    WHERE id = v_stock.item_id
    FOR UPDATE;

    IF v_on_hand IS NOT NULL THEN
      IF v_on_hand < v_stock.qty THEN
        RAISE EXCEPTION 'Only % left of "%" — please reduce the quantity',
          v_on_hand, COALESCE(v_item_name, v_stock.item_id::text);
      END IF;

      UPDATE public.items
      SET stock_quantity = stock_quantity - v_stock.qty
      WHERE id = v_stock.item_id;
    END IF;
  END LOOP;
  -- ===== end new block =====================================================

  v_platform_fee := round(v_grand_total * public.buyer_fee_percent_for(p_origin_type) / 100.0)::integer;
  v_gross_payable := v_grand_total + v_platform_fee;

  IF p_credits_to_apply > v_gross_payable THEN
    RAISE EXCEPTION 'Credits to apply cannot exceed the amount payable';
  END IF;

  v_cash_payable := v_gross_payable - p_credits_to_apply;

  IF v_cash_payable = 0 THEN
    v_tx_status := 'SUCCESSFUL';
    v_order_claim_status := 'PENDING';
  END IF;

  INSERT INTO public.transactions (
    buyer_id, total_amount, origin_type, status, gateway_tx_ref, sender_phone,
    platform_fee, items_subtotal
  )
  VALUES (
    p_buyer_id, v_cash_payable, p_origin_type, v_tx_status, p_gateway_tx_ref, p_sender_phone,
    v_platform_fee, v_grand_total
  )
  RETURNING transaction_id INTO v_transaction_id;

  IF p_credits_to_apply > 0 THEN
    INSERT INTO public.wallet_ledger (wallet_id, amount, transaction_id, description)
    VALUES (v_wallet_id, -p_credits_to_apply, v_transaction_id, 'Wallet credits applied to your order');
  END IF;

  FOR v_vendor IN SELECT * FROM jsonb_array_elements(p_vendors) LOOP
    v_shop_id := (v_vendor->>'shop_id')::UUID;
    v_subtotal := 0;
    v_item_ids := v_vendor->'item_ids';
    v_claim_code := public.gen_claim_code(8);

    FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
      v_item_id := v_item_ids->>i;
      SELECT price_zmw INTO v_price FROM public.items WHERE id = v_item_id::UUID;
      v_subtotal := v_subtotal + v_price;
    END LOOP;

    INSERT INTO public.shop_orders (
      transaction_id, shop_id, claim_code, claim_status, subtotal,
      recipient_name, recipient_phone, message, target_execution_date,
      experience_id, expires_at
    )
    VALUES (
      v_transaction_id, v_shop_id, v_claim_code, v_order_claim_status, v_subtotal,
      p_recipient_name, p_recipient_phone, p_message, p_target_execution_date,
      p_experience_id, v_expires_at
    )
    RETURNING shop_order_id INTO v_shop_order_id;

    FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
      v_item_id := v_item_ids->>i;
      SELECT price_zmw INTO v_price FROM public.items WHERE id = v_item_id::UUID;
      INSERT INTO public.order_items (shop_order_id, item_id, allocated_price)
      VALUES (v_shop_order_id, v_item_id::UUID, v_price);
    END LOOP;

    v_shop_orders := v_shop_orders || jsonb_build_object(
      'shop_order_id', v_shop_order_id,
      'claim_code', v_claim_code,
      'shop_id', v_shop_id,
      'subtotal', v_subtotal
    );
  END LOOP;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'total_amount', v_cash_payable,
    'items_subtotal', v_grand_total,
    'platform_fee', v_platform_fee,
    'shop_orders', v_shop_orders
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The restock nudge
--
-- Warns the merchant at the low threshold and, at zero, tells the admins too.
-- stock_alert_level is what stops this nagging nightly: it records which
-- warning has already gone out and is cleared by track_stock_baseline once the
-- item is comfortably restocked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_level TEXT;
  v_owner_id UUID;
  v_admin RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT i.id, i.name, i.stock_quantity, i.stock_baseline, i.stock_alert_level,
           i.shop_id, s.name AS shop_name
    FROM public.items i
    JOIN public.shops s ON s.id = i.shop_id
    WHERE i.stock_quantity IS NOT NULL
      AND i.is_available IS NOT FALSE
      AND i.is_quote_only = false
      AND (
        (i.stock_quantity = 0 AND i.stock_alert_level IS DISTINCT FROM 'out')
        OR (i.stock_quantity > 0
            AND i.stock_quantity <= public.low_stock_threshold(i.stock_baseline)
            AND i.stock_alert_level IS DISTINCT FROM 'low')
      )
    LIMIT 500
  LOOP
    v_level := CASE WHEN v_row.stock_quantity = 0 THEN 'out' ELSE 'low' END;

    SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_row.shop_id;

    PERFORM public.create_notification(
      v_owner_id,
      CASE
        WHEN v_level = 'out' THEN
          '"' || v_row.name || '" is out of stock and is now shown as unavailable to buyers. Restock it to start selling again.'
        ELSE
          '"' || v_row.name || '" is running low — ' || v_row.stock_quantity ||
          ' left of ' || COALESCE(v_row.stock_baseline, v_row.stock_quantity) || '. Time to restock.'
      END,
      CASE WHEN v_level = 'out' THEN 'rejection' ELSE 'reminder' END,
      v_row.id::text);

    -- A sold-out listing is a lost sale on a live storefront, so admins hear
    -- about it too; the low warning is the merchant's own business.
    IF v_level = 'out' THEN
      FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' LOOP
        PERFORM public.create_notification(
          v_admin.id,
          '"' || v_row.name || '" at ' || v_row.shop_name || ' has sold out.',
          'reminder',
          v_row.id::text);
      END LOOP;
    END IF;

    UPDATE public.items SET stock_alert_level = v_level WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_low_stock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_low_stock() TO service_role;

SELECT cron.unschedule('notify-low-stock-job')
  FROM cron.job WHERE jobname = 'notify-low-stock-job';

SELECT cron.schedule(
  'notify-low-stock-job',
  '30 9 * * *',
  $$ SELECT public.notify_low_stock(); $$
);
