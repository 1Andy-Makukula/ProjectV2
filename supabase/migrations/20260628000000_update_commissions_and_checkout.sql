-- Migration: Update checkout and settlement payouts for credit application and new take rates

-- Drop function first to prevent signature mismatch
DROP FUNCTION IF EXISTS public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER);

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
  
  v_wallet_id UUID;
  v_wallet_balance INTEGER;
  v_cash_payable INTEGER;
  v_tx_status TEXT := 'GATEWAY_PROCESSING';
  v_order_claim_status TEXT := 'PENDING_PAYMENT';
BEGIN
  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- 1. Validate wallet balance if credits are being applied
  IF p_credits_to_apply > 0 THEN
    SELECT id, balance INTO v_wallet_id, v_wallet_balance
    FROM public.kithly_wallets
    WHERE user_id = p_buyer_id
    FOR UPDATE;

    IF v_wallet_id IS NULL OR v_wallet_balance < p_credits_to_apply THEN
      RAISE EXCEPTION 'Insufficient wallet balance for applying credits';
    END IF;
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

  -- Capping credits applied to the grand total
  IF p_credits_to_apply > v_grand_total THEN
    RAISE EXCEPTION 'Credits to apply cannot exceed grand total';
  END IF;

  v_cash_payable := v_grand_total - p_credits_to_apply;

  -- If fully paid by credits, skip GATEWAY_PROCESSING state
  IF v_cash_payable = 0 THEN
    v_tx_status := 'SUCCESSFUL';
    v_order_claim_status := 'PENDING';
  END IF;

  -- Insert transaction, persisting p_sender_phone and net cash payable
  INSERT INTO public.transactions (buyer_id, total_amount, origin_type, status, gateway_tx_ref, sender_phone)
  VALUES (p_buyer_id, v_cash_payable, p_origin_type, v_tx_status, p_gateway_tx_ref, p_sender_phone)
  RETURNING transaction_id INTO v_transaction_id;

  -- Apply wallet debit ledger if credits are used
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
    'shop_orders', v_shop_orders
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;


-- Update settle_payout_atomic to use local (92% merchant / 8% fee) and international (90% merchant / 10% fee) splits
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
  v_origin_type TEXT;
BEGIN
  SELECT shop_order_id, shop_id, subtotal, claim_status, settled, transaction_id
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

  -- Get transaction origin type to apply correct split
  SELECT origin_type INTO v_origin_type
  FROM public.transactions
  WHERE transaction_id = v_order.transaction_id;

  IF v_origin_type = 'INTERNATIONAL' THEN
    -- Flutterwave 6% + KithLy 4% = 10% total fee (Merchant gets 90%)
    v_merchant_share := floor(v_order.subtotal * 0.90);
  ELSE
    -- Default / LOCAL: Flutterwave 6% + KithLy 2% = 8% total fee (Merchant gets 92%)
    v_merchant_share := floor(v_order.subtotal * 0.92);
  END IF;

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

GRANT EXECUTE ON FUNCTION public.settle_payout_atomic(UUID, UUID) TO service_role;

