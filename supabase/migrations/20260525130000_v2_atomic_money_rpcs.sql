-- =============================================================================
-- KithLy V2 — Atomic money RPCs (SECURITY DEFINER, single-transaction mutations)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Supporting tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_order_id UUID,
  shop_id UUID NOT NULL REFERENCES public.shops(id),
  credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  ledger_type TEXT NOT NULL DEFAULT 'FULFILLMENT_CREDIT',
  reference TEXT,
  amount INTEGER,
  commission INTEGER,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_webhook_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  transaction_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gen_claim_code(p_len INTEGER DEFAULT 8)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..p_len LOOP
    result := result || substr(alphabet, (floor(random() * 36)::INTEGER + 1), 1);
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_wallet_balance(
  p_user_id UUID,
  p_amount INTEGER,
  p_reference TEXT DEFAULT NULL,
  p_shop_order_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.kithly_wallets (user_id, balance, currency)
  VALUES (p_user_id, p_amount, 'ZMW')
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.kithly_wallets.balance + EXCLUDED.balance,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_merchant_balance(
  target_shop_id UUID,
  amount_to_add INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = target_shop_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;
  PERFORM public.increment_wallet_balance(v_owner_id, amount_to_add);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_withdrawal_atomic(
  target_shop_id UUID,
  withdrawal_amount INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_balance INTEGER;
  v_ledger_id UUID := gen_random_uuid();
BEGIN
  IF withdrawal_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = target_shop_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  SELECT balance INTO v_balance FROM public.kithly_wallets WHERE user_id = v_owner_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < withdrawal_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE public.kithly_wallets
  SET balance = balance - withdrawal_amount, updated_at = now()
  WHERE user_id = v_owner_id;

  INSERT INTO public.payout_ledger (id, shop_id, credit_amount, ledger_type, reference, status, amount)
  VALUES (v_ledger_id, target_shop_id, withdrawal_amount, 'WITHDRAWAL_REQUEST', 'withdrawal', 'pending', withdrawal_amount);

  RETURN v_ledger_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- checkout_init_atomic
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.checkout_init_atomic(
  p_buyer_id UUID,
  p_origin_type TEXT,
  p_gateway_tx_ref TEXT,
  p_vendors JSONB,
  p_recipient_name TEXT DEFAULT NULL,
  p_recipient_phone TEXT DEFAULT NULL,
  p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
BEGIN
  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- Pass 1: compute authoritative total
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

  INSERT INTO public.transactions (buyer_id, total_amount, origin_type, status, gateway_tx_ref)
  VALUES (p_buyer_id, v_grand_total, p_origin_type, 'GATEWAY_PROCESSING', p_gateway_tx_ref)
  RETURNING transaction_id INTO v_transaction_id;

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
      v_transaction_id, v_shop_id, v_claim_code, 'PENDING_PAYMENT', v_subtotal,
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
    'total_amount', v_grand_total,
    'shop_orders', v_shop_orders
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- confirm_payment_atomic (webhook / verify)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_transaction_id UUID,
  p_paid_amount NUMERIC,
  p_paid_currency TEXT,
  p_payload TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn RECORD;
  v_orders_updated INTEGER;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.payment_webhook_idempotency WHERE idempotency_key = p_idempotency_key) THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true);
    END IF;
  END IF;

  SELECT transaction_id, total_amount, status
  INTO v_txn
  FROM public.transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_txn.status = 'SUCCESSFUL' THEN
    IF p_idempotency_key IS NOT NULL THEN
      INSERT INTO public.payment_webhook_idempotency (idempotency_key, transaction_id)
      VALUES (p_idempotency_key, p_transaction_id)
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN jsonb_build_object('success', true, 'already_confirmed', true);
  END IF;

  IF v_txn.status <> 'GATEWAY_PROCESSING' THEN
    RAISE EXCEPTION 'Transaction is in status %', v_txn.status;
  END IF;

  IF p_paid_amount < v_txn.total_amount OR p_paid_currency <> 'ZMW' THEN
    RAISE EXCEPTION 'Payment amount or currency mismatch';
  END IF;

  UPDATE public.transactions
  SET status = 'SUCCESSFUL'
  WHERE transaction_id = p_transaction_id;

  UPDATE public.shop_orders
  SET claim_status = 'PENDING'
  WHERE transaction_id = p_transaction_id
    AND claim_status = 'PENDING_PAYMENT';

  GET DIAGNOSTICS v_orders_updated = ROW_COUNT;

  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (p_transaction_id, 'WEBHOOK_RECEIVED', COALESCE(p_payload, '{}'));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.payment_webhook_idempotency (idempotency_key, transaction_id)
    VALUES (p_idempotency_key, p_transaction_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'shop_orders_updated', v_orders_updated
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- fulfill_voucher_atomic (merchant terminal — partial fulfillment)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfill_voucher_atomic(
  p_claim_code TEXT,
  p_present_item_ids UUID[],
  p_missing_item_ids UUID[],
  p_merchant_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  v_claim_status := CASE WHEN COALESCE(array_length(p_missing_item_ids, 1), 0) > 0 THEN 'PARTIAL_FULFILLMENT' ELSE 'FULFILLED' END;
  v_settlement_time := now() + interval '48 hours';

  UPDATE public.shop_orders
  SET claim_status = v_claim_status,
      settlement_target_time = v_settlement_time,
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
      'missing_total', v_missing_total
    )::TEXT
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_status', v_claim_status,
    'merchant_credit_zmw', v_present_total,
    'sender_refund_zmw', v_missing_total
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
-- atomic_fulfill_voucher (USSD — all items collected)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atomic_fulfill_voucher(
  p_claim_code TEXT,
  p_shop_id UUID
)
RETURNS TABLE (
  voucher_id UUID,
  item_name TEXT,
  recipient_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_present_ids UUID[];
  v_result JSONB;
  v_item_name TEXT;
BEGIN
  SELECT so.shop_order_id, so.transaction_id, so.recipient_name
  INTO v_order
  FROM public.shop_orders so
  WHERE so.claim_code = upper(trim(p_claim_code))
    AND so.shop_id = p_shop_id
    AND so.claim_status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FRAUD_REJECTION:Invalid or already fulfilled code';
  END IF;

  SELECT array_agg(order_item_id) INTO v_present_ids
  FROM public.order_items
  WHERE shop_order_id = v_order.shop_order_id;

  SELECT i.name INTO v_item_name
  FROM public.order_items oi
  JOIN public.items i ON i.id = oi.item_id
  WHERE oi.shop_order_id = v_order.shop_order_id
  LIMIT 1;

  v_result := public.fulfill_voucher_atomic(
    p_claim_code,
    COALESCE(v_present_ids, ARRAY[]::UUID[]),
    ARRAY[]::UUID[],
    (SELECT ms.user_id FROM public.merchant_shops ms WHERE ms.shop_id = p_shop_id LIMIT 1)
  );

  IF v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FRAUD_REJECTION:Fulfillment failed';
  END IF;

  RETURN QUERY
  SELECT v_order.transaction_id, COALESCE(v_item_name, 'Gift'), COALESCE(v_order.recipient_name, 'Customer');
END;
$$;

-- ---------------------------------------------------------------------------
-- register_merchant_shop (client-callable with user JWT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_merchant_shop(
  p_shop_name TEXT,
  p_location TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_shop_id UUID;
  v_current_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_current_role FROM public.users WHERE id = v_uid;
  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
  IF v_current_role NOT IN ('sender', 'merchant') THEN
    RAISE EXCEPTION 'Only senders may register a shop';
  END IF;

  UPDATE public.users SET role = 'merchant' WHERE id = v_uid AND role = 'sender';

  INSERT INTO public.shops (name, location, owner_id, is_active)
  VALUES (trim(p_shop_name), trim(p_location), v_uid, false)
  RETURNING id INTO v_shop_id;

  INSERT INTO public.merchant_shops (user_id, shop_id)
  VALUES (v_uid, v_shop_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('shop_id', v_shop_id, 'success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- settle_payout_atomic
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_payout_atomic(
  p_shop_order_id UUID,
  p_merchant_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_merchant_share INTEGER;
  v_commission INTEGER;
BEGIN
  SELECT shop_order_id, shop_id, subtotal, claim_status, settled
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

  v_merchant_share := floor(v_order.subtotal * 0.95);
  v_commission := v_order.subtotal - v_merchant_share;

  PERFORM public.increment_merchant_balance(v_order.shop_id, v_merchant_share);

  INSERT INTO public.payout_ledger (shop_order_id, shop_id, amount, commission, status, ledger_type, credit_amount)
  VALUES (p_shop_order_id, v_order.shop_id, v_merchant_share, v_commission, 'pending_withdrawal', 'SETTLEMENT', v_merchant_share);

  UPDATE public.shop_orders SET settled = true WHERE shop_order_id = p_shop_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'merchantShare', v_merchant_share,
    'kithlyCommission', v_commission
  );
END;
$$;

-- Grants: money RPCs are service-role only; merchant registration uses auth.uid()
REVOKE ALL ON FUNCTION public.checkout_init_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfill_voucher_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atomic_fulfill_voucher FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_payout_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_wallet_balance FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_merchant_balance FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_withdrawal_atomic FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_merchant_shop TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_merchant_shop TO service_role;
