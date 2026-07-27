-- =============================================================================
-- Phase 4b — Notification coverage across the whole order lifecycle
--
-- Before this migration the notifications table had two writers: KYC review and
-- the expiry reminder. Nothing told a buyer their payment went through, that
-- their gift had been collected, or that a voucher had lapsed. Nothing told a
-- merchant they had been paid, that an advance had been released, or that a
-- customer had raised a dispute. The only "payment succeeded" signal anywhere
-- was a toast in the header, fired by comparing the length of a polled array
-- against its previous length, with the baseline held in component state — so
-- it reset on every reload and told nobody anything after the fact.
--
-- Every money and fulfilment event now writes a durable, per-user row through
-- create_notification. WhatsApp stays as an additional channel for the
-- recipient's claim code; it is no longer the only record that anything
-- happened.
--
-- The function bodies below are the Phase 3 definitions with notification calls
-- added. Nothing else about them changes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Payment confirmed -> buyer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_transaction_id UUID,
  p_paid_amount NUMERIC,
  p_paid_currency TEXT,
  p_payload TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_txn RECORD;
  v_orders_updated INTEGER;
  v_recipient TEXT;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.payment_webhook_idempotency WHERE idempotency_key = p_idempotency_key) THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true);
    END IF;
  END IF;

  SELECT transaction_id, total_amount, status, buyer_id
  INTO v_txn
  FROM public.transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_txn.status = 'SUCCESS' THEN
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
  SET status = 'SUCCESS'
  WHERE transaction_id = p_transaction_id;

  UPDATE public.shop_orders
  SET claim_status = 'PENDING'
  WHERE transaction_id = p_transaction_id
    AND claim_status = 'PENDING_PAYMENT';

  GET DIAGNOSTICS v_orders_updated = ROW_COUNT;

  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (p_transaction_id, 'WEBHOOK_RECEIVED', COALESCE(p_payload, '{}')::JSONB);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.payment_webhook_idempotency (idempotency_key, transaction_id)
    VALUES (p_idempotency_key, p_transaction_id);
  END IF;

  SELECT recipient_name INTO v_recipient
  FROM public.shop_orders WHERE transaction_id = p_transaction_id LIMIT 1;

  PERFORM public.create_notification(
    v_txn.buyer_id,
    'Payment confirmed. '
      || COALESCE('Your gift for ' || v_recipient || ' is', 'Your gift is')
      || ' held safely in escrow and ready to collect.',
    'success',
    p_transaction_id::text);

  RETURN jsonb_build_object(
    'success', true,
    'shop_orders_updated', v_orders_updated
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Collection -> buyer, and any advance -> merchant
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
  v_buyer_id UUID;
  v_shop_name TEXT;
  v_owner_id UUID;
BEGIN
  SELECT so.shop_order_id, so.shop_id, so.transaction_id, so.subtotal, so.claim_status,
         so.recipient_name
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

  SELECT buyer_id INTO v_buyer_id FROM public.transactions WHERE transaction_id = v_order.transaction_id;

  IF v_missing_total > 0 THEN
    PERFORM public.increment_wallet_balance(
      v_buyer_id,
      v_missing_total,
      'PARTIAL_REFUND:' || upper(trim(p_claim_code)),
      v_order.shop_order_id
    );
  END IF;

  SELECT upfront_payout_percentage, float_exposure_limit, active_exposure
  INTO v_shop
  FROM public.shops
  WHERE id = v_order.shop_id
  FOR UPDATE;

  IF v_present_total > 0 AND v_shop.upfront_payout_percentage > 0 THEN
    v_share := public.merchant_share_for(v_present_total);
    v_upfront := floor(v_share * v_shop.upfront_payout_percentage / 100.0)::integer;

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

  SELECT name, owner_id INTO v_shop_name, v_owner_id
  FROM public.shops WHERE id = v_order.shop_id;

  -- The buyer paid for this and has heard nothing since. Tell them it landed.
  PERFORM public.create_notification(
    v_buyer_id,
    CASE
      WHEN v_missing_total > 0 THEN
        COALESCE(v_order.recipient_name, 'Your recipient')
          || ' collected part of their gift from ' || COALESCE(v_shop_name, 'the shop')
          || '. The value of anything unavailable has been refunded to your wallet.'
      ELSE
        COALESCE(v_order.recipient_name, 'Your recipient')
          || ' collected their gift from ' || COALESCE(v_shop_name, 'the shop') || '.'
    END,
    CASE WHEN v_missing_total > 0 THEN 'warning' ELSE 'success' END,
    v_order.shop_order_id::text);

  IF v_upfront > 0 AND v_owner_id IS NOT NULL THEN
    PERFORM public.create_notification(
      v_owner_id,
      'Early payout released for order ' || upper(trim(p_claim_code))
        || '. The balance follows once the review window closes.',
      'success',
      v_order.shop_order_id::text);
  END IF;

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
-- 3. Settlement -> merchant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_redemption(p_shop_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_result jsonb;
  v_owner_id uuid;
BEGIN
  SELECT shop_order_id, transaction_id, claim_status, settled,
         settlement_target_time, disputed_at, shop_id, claim_code
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

  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_order.shop_id;

  PERFORM public.create_notification(
    v_owner_id,
    'Order ' || COALESCE(v_order.claim_code, '') || ' has cleared. '
      || 'Your balance is available to withdraw.',
    'success',
    p_shop_order_id::text);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Dispute -> merchant and every admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_order_dispute(p_shop_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_owner_id uuid;
  v_admin RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to raise a dispute';
  END IF;

  SELECT so.shop_order_id, so.transaction_id, so.claim_status, so.settled,
         so.shop_id, so.claim_code, t.buyer_id
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

  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_order.shop_id;

  PERFORM public.create_notification(
    v_owner_id,
    'A customer raised an issue with order ' || COALESCE(v_order.claim_code, '')
      || '. Settlement is on hold until it is resolved. Reason: ' || v_reason,
    'rejection',
    p_shop_order_id::text);

  -- Disputes are the one thing every admin should see without being told.
  FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' LOOP
    PERFORM public.create_notification(
      v_admin.id,
      'Dispute raised on order ' || COALESCE(v_order.claim_code, '') || ': ' || v_reason,
      'rejection',
      p_shop_order_id::text);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'shop_order_id', p_shop_order_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Expiry -> both sides
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
  v_owner_id uuid;
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
           so.claim_code,
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

    PERFORM public.create_notification(
      v_item.buyer_id,
      'Gift ' || COALESCE(v_item.claim_code, '') || ' went uncollected and has expired. '
        || v_refund_percent::text || '% of its value is back in your wallet.',
      'warning',
      v_item.shop_order_id::text);

    SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_item.shop_id;
    IF v_merchant_credit > 0 AND v_owner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_owner_id,
        'Gift ' || COALESCE(v_item.claim_code, '') || ' expired uncollected. '
          || 'A partial credit has been added to your balance.',
        'info',
        v_item.shop_order_id::text);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. checkout_init_atomic — carries the agreed date onto the order
--
-- Closes the gap left in Phase 3: `target_execution_date` existed and drove the
-- expiry clock, but nothing ever wrote it. An accepted quotation now supplies
-- it at checkout.
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
  p_target_execution_date TIMESTAMPTZ DEFAULT NULL
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
      recipient_name, recipient_phone, message, target_execution_date
    )
    VALUES (
      v_transaction_id, v_shop_id, v_claim_code, v_order_claim_status, v_subtotal,
      p_recipient_name, p_recipient_phone, p_message, p_target_execution_date
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

GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ) TO authenticated, service_role;

-- The nine-argument version is dropped so a nine-named-argument call is not
-- ambiguous between it and the new default-carrying signature.
DROP FUNCTION IF EXISTS public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER);
