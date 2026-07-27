-- =============================================================================
-- Phase 3b — Buyer-side pricing & the expiry grace protocol
--
-- Two changes that both concern who bears a cost.
--
-- ---------------------------------------------------------------------------
-- Pricing
-- ---------------------------------------------------------------------------
-- The previous model charged the buyer exactly the item price and took the
-- whole platform fee out of the merchant's settlement (8% local, 10% on
-- international orders). That made the merchant carry the payment processing
-- cost of a decision the buyer made.
--
-- Now the buyer pays a visible fee on top of the item price, and the merchant
-- gives up a flat 2%. Against real gateway costs of 3% locally and 4.8% on
-- international card payments, a ZMW 100 local order works out as:
--
--     buyer pays          108.00
--     gateway takes        -3.24   (3% of 108)
--     merchant receives   -98.00   (100 less 2%)
--     platform keeps        6.76
--
-- and internationally: 110.00 in, 5.28 to the gateway, 98.00 to the merchant,
-- 6.72 kept.
--
-- ---------------------------------------------------------------------------
-- Expiry
-- ---------------------------------------------------------------------------
-- The previous sweep expired anything unclaimed after 30 days and refunded the
-- buyer in full, which meant a merchant who had reserved stock or bought
-- ingredients absorbed the entire loss of a recipient who never showed up.
--
-- The replacement gives a 60-day grace period by default and then splits the
-- value 80/20 in the buyer's favour, so neither side carries all of it. Items
-- can override the period, opt out of expiry entirely, or — for booked
-- services — measure it from the agreed date rather than the purchase.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS local_buyer_fee_percent numeric(5,2) NOT NULL DEFAULT 8.00;
COMMENT ON COLUMN public.platform_settings.local_buyer_fee_percent IS
  'Added to the basket total for LOCAL orders. Covers the ~3% local gateway cost plus margin.';

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS international_buyer_fee_percent numeric(5,2) NOT NULL DEFAULT 10.00;
COMMENT ON COLUMN public.platform_settings.international_buyer_fee_percent IS
  'Added to the basket total for INTERNATIONAL orders. Covers the ~4.8% card cost plus margin.';

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS voucher_grace_days integer NOT NULL DEFAULT 60;
COMMENT ON COLUMN public.platform_settings.voucher_grace_days IS
  'Default days before an unclaimed voucher lapses. Items may override via items.valid_for_days.';

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS expiry_sender_refund_percent integer NOT NULL DEFAULT 80;
COMMENT ON COLUMN public.platform_settings.expiry_sender_refund_percent IS
  'Share of a lapsed voucher returned to the buyer. The remainder is credited to the merchant.';

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS expiry_reminder_days integer NOT NULL DEFAULT 7;
COMMENT ON COLUMN public.platform_settings.expiry_reminder_days IS
  'How many days before expiry the buyer is reminded that a gift is still unclaimed.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_buyer_fee_check') THEN
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_buyer_fee_check
      CHECK (local_buyer_fee_percent >= 0 AND local_buyer_fee_percent < 100
             AND international_buyer_fee_percent >= 0 AND international_buyer_fee_percent < 100);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_expiry_check') THEN
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_expiry_check
      CHECK (voucher_grace_days > 0
             AND expiry_sender_refund_percent BETWEEN 0 AND 100
             AND expiry_reminder_days >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Record the fee on the transaction
--
-- Without this the buyer's receipt cannot separate what the shop charged from
-- what the platform added.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS platform_fee integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.transactions.platform_fee IS
  'Buyer-facing service fee in ngwee, included in total_amount.';

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS items_subtotal integer;
COMMENT ON COLUMN public.transactions.items_subtotal IS
  'Basket total before the service fee and before any wallet credits.';

-- ---------------------------------------------------------------------------
-- 3. The buyer-facing fee rate for an order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buyer_fee_percent_for(p_origin_type text)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN upper(COALESCE(p_origin_type, 'LOCAL')) = 'INTERNATIONAL'
      THEN COALESCE((SELECT international_buyer_fee_percent FROM public.platform_settings WHERE id = 1), 10.00)
    ELSE COALESCE((SELECT local_buyer_fee_percent FROM public.platform_settings WHERE id = 1), 8.00)
  END
$$;

-- ---------------------------------------------------------------------------
-- 4. When a voucher lapses
--
-- A booked service is anchored to the agreed date: a setup ninety days out
-- must not lapse because the clock started when it was paid for. Everything
-- else counts from the purchase.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voucher_expiry_at(
  p_purchased_at          timestamptz,
  p_target_execution_date timestamptz,
  p_requires_scheduling   boolean,
  p_valid_for_days        integer
)
RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT (
    CASE
      WHEN COALESCE(p_requires_scheduling, false) AND p_target_execution_date IS NOT NULL
        THEN p_target_execution_date
      ELSE p_purchased_at
    END
    + make_interval(days => COALESCE(
        p_valid_for_days,
        (SELECT voucher_grace_days FROM public.platform_settings WHERE id = 1),
        60))
  )
$$;

-- ---------------------------------------------------------------------------
-- 5. checkout_init_atomic — adds the buyer-facing fee
--
-- shop_orders.subtotal deliberately stays at the item total: it is what the
-- merchant is owed against, and settlement reads it. Only the transaction the
-- buyer pays carries the fee.
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
  p_credits_to_apply INTEGER DEFAULT 0
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
BEGIN
  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF p_credits_to_apply < 0 THEN
    RAISE EXCEPTION 'Credits to apply cannot be negative';
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

  -- Pass 1: authoritative basket total, priced from the database not the client
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

  -- The service fee rides on top of the basket, not inside it.
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
    VALUES (v_wallet_id, -p_credits_to_apply, v_transaction_id, 'CHECKOUT_CREDITS_APPLIED');
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
      recipient_name, recipient_phone, message
    )
    VALUES (
      v_transaction_id, v_shop_id, v_claim_code, v_order_claim_status, v_subtotal,
      p_recipient_name, p_recipient_phone, p_message
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

GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. process_expired_vouchers — 60-day grace, then an 80/20 split
--
-- Replaces the blanket 30-day full refund. Items that opted out of expiry are
-- skipped entirely, and orders already settled or under dispute are left alone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_expired_vouchers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_refund_percent integer;
  v_sender_refund integer;
  v_merchant_credit integer;
  v_count integer := 0;
BEGIN
  SELECT COALESCE(expiry_sender_refund_percent, 80) INTO v_refund_percent
  FROM public.platform_settings WHERE id = 1;
  v_refund_percent := COALESCE(v_refund_percent, 80);

  FOR v_item IN
    SELECT oi.order_item_id,
           oi.allocated_price,
           oi.shop_order_id,
           so.transaction_id,
           so.shop_id,
           t.buyer_id
    FROM public.order_items oi
    JOIN public.shop_orders so ON oi.shop_order_id = so.shop_order_id
    JOIN public.transactions t ON so.transaction_id = t.transaction_id
    JOIN public.items it ON it.id = oi.item_id
    WHERE oi.fulfillment_status IN ('PENDING', 'FLOATING')
      AND so.claim_status NOT IN ('REDEEMED', 'CANCELLED', 'EXPIRED')
      AND so.settled IS NOT TRUE
      AND so.disputed_at IS NULL
      AND COALESCE(it.has_expiry, true)
      AND public.voucher_expiry_at(
            oi.created_at, so.target_execution_date, it.requires_scheduling, it.valid_for_days
          ) <= now()
    ORDER BY oi.created_at
    LIMIT 1000
    FOR UPDATE OF oi
  LOOP
    -- Split in the buyer's favour, with the remainder to the merchant who held
    -- capacity for a gift that was never collected.
    v_sender_refund := floor(v_item.allocated_price * v_refund_percent / 100.0)::integer;
    v_merchant_credit := v_item.allocated_price - v_sender_refund;

    UPDATE public.order_items
    SET fulfillment_status = 'EXPIRED',
        fulfilled_at = now()
    WHERE order_item_id = v_item.order_item_id;

    IF v_sender_refund > 0 THEN
      PERFORM public.increment_wallet_balance(
        v_item.buyer_id,
        v_sender_refund,
        'REFUND_EXPIRY:' || v_item.order_item_id,
        v_item.shop_order_id
      );
    END IF;

    IF v_merchant_credit > 0 THEN
      PERFORM public.increment_merchant_balance(v_item.shop_id, v_merchant_credit);

      INSERT INTO public.payout_ledger
        (shop_order_id, shop_id, amount, commission, status, ledger_type, credit_amount)
      VALUES
        (v_item.shop_order_id, v_item.shop_id, v_merchant_credit, 0,
         'pending_withdrawal', 'EXPIRY_CREDIT', v_merchant_credit);
    END IF;

    INSERT INTO public.transaction_events (transaction_id, event_type, payload)
    VALUES (
      v_item.transaction_id,
      'AUTO_EXPIRED',
      jsonb_build_object(
        'order_item_id', v_item.order_item_id,
        'allocated_price', v_item.allocated_price,
        'buyer_id', v_item.buyer_id,
        'sender_refund', v_sender_refund,
        'merchant_credit', v_merchant_credit,
        'refund_percent', v_refund_percent
      )
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Expiry reminders
--
-- Writes one reminder per order per expiry cycle, deduplicated through
-- transaction_events so a daily sweep does not nag.
--
-- NOTE: this records the reminder durably; it does not itself deliver over
-- WhatsApp. Delivery is the `send-notification` Edge Function's job and still
-- needs to be wired to this sweep.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_expiring_vouchers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_reminder_days integer;
  v_count integer := 0;
BEGIN
  SELECT COALESCE(expiry_reminder_days, 7) INTO v_reminder_days
  FROM public.platform_settings WHERE id = 1;
  v_reminder_days := COALESCE(v_reminder_days, 7);

  FOR v_row IN
    SELECT DISTINCT
           so.shop_order_id,
           so.transaction_id,
           so.claim_code,
           t.buyer_id,
           s.name AS shop_name,
           MIN(public.voucher_expiry_at(
                 oi.created_at, so.target_execution_date, it.requires_scheduling, it.valid_for_days
               )) AS expires_at
    FROM public.order_items oi
    JOIN public.shop_orders so ON oi.shop_order_id = so.shop_order_id
    JOIN public.transactions t ON so.transaction_id = t.transaction_id
    JOIN public.items it ON it.id = oi.item_id
    JOIN public.shops s ON s.id = so.shop_id
    WHERE oi.fulfillment_status IN ('PENDING', 'FLOATING')
      AND so.claim_status NOT IN ('REDEEMED', 'CANCELLED', 'EXPIRED')
      AND so.settled IS NOT TRUE
      AND COALESCE(it.has_expiry, true)
    GROUP BY so.shop_order_id, so.transaction_id, so.claim_code, t.buyer_id, s.name
    HAVING MIN(public.voucher_expiry_at(
                 oi.created_at, so.target_execution_date, it.requires_scheduling, it.valid_for_days
               )) BETWEEN now() AND now() + make_interval(days => v_reminder_days)
    LIMIT 500
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.transaction_events te
      WHERE te.transaction_id = v_row.transaction_id
        AND te.event_type = 'EXPIRY_REMINDER_SENT'
        AND te.payload->>'shop_order_id' = v_row.shop_order_id::text
    );

    INSERT INTO public.notifications (user_id, message, type, is_read, reference_id)
    VALUES (
      v_row.buyer_id,
      'The gift you sent from ' || v_row.shop_name || ' (code ' || v_row.claim_code ||
        ') has not been collected yet and expires on ' ||
        to_char(v_row.expires_at, 'DD Mon YYYY') || '.',
      'reminder',
      false,
      v_row.shop_order_id::text
    );

    INSERT INTO public.transaction_events (transaction_id, event_type, payload)
    VALUES (
      v_row.transaction_id,
      'EXPIRY_REMINDER_SENT',
      jsonb_build_object(
        'shop_order_id', v_row.shop_order_id,
        'expires_at', v_row.expires_at,
        'reminder_days', v_reminder_days
      )
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_vouchers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_expiring_vouchers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.voucher_expiry_at(timestamptz, timestamptz, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buyer_fee_percent_for(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.process_expired_vouchers() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_expiring_vouchers() TO service_role;
GRANT EXECUTE ON FUNCTION public.voucher_expiry_at(timestamptz, timestamptz, boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buyer_fee_percent_for(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Reschedule the sweeps
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('expire-stale-vouchers-job')
  FROM cron.job WHERE jobname = 'expire-stale-vouchers-job';

SELECT cron.schedule(
  'expire-stale-vouchers-job',
  '0 0 * * *',
  $$ SELECT public.process_expired_vouchers(); $$
);

SELECT cron.unschedule('notify-expiring-vouchers-job')
  FROM cron.job WHERE jobname = 'notify-expiring-vouchers-job';

SELECT cron.schedule(
  'notify-expiring-vouchers-job',
  '0 9 * * *',
  $$ SELECT public.notify_expiring_vouchers(); $$
);
