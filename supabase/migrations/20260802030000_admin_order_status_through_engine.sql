-- =============================================================================
-- Admin order status changes must go through the financial engine
--
-- The admin order screens changed order state with raw client UPDATEs:
--
--   "Mark Fulfilled"  UPDATE shop_orders SET claim_status = 'REDEEMED'
--   "Mark Expired"    UPDATE transactions SET status = 'CANCELLED'
--                     UPDATE shop_orders  SET claim_status = 'CANCELLED'
--
-- Both wrote a status and nothing else, so every money-moving consequence the
-- real paths perform was skipped:
--
--   fulfilled -> no settlement, no payout_ledger row, no merchant float, no
--                transaction_events, no notification. The merchant is never
--                credited for an order the platform now considers collected.
--   expired   -> no 80/20 split. The buyer's refund and the merchant's partial
--                credit simply never happen, and the money is stranded.
--
-- These two RPCs give admins the same overrides routed through the existing
-- engine: fulfilment reuses fulfill_voucher_atomic (the merchant terminal's
-- own path), expiry reuses the per-item split from process_expired_vouchers.
-- Both are admin-gated and both record themselves via log_admin_action.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. admin_force_fulfill_order
--
-- Treats every line as collected and hands off to fulfill_voucher_atomic, so
-- settlement, float, ledger and notifications all happen exactly as they do
-- when a merchant redeems at the counter. fulfill_voucher_atomic verifies its
-- p_merchant_user_id against merchant_shops, so the shop's own assigned
-- merchant is resolved and passed — the fulfilment is attributed to the shop,
-- while admin_action_log records which admin forced it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_force_fulfill_order(
  p_shop_order_id uuid,
  p_reason        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_order RECORD;
  v_merchant_user_id UUID;
  v_present UUID[];
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may force-fulfil an order';
  END IF;

  SELECT shop_order_id, shop_id, claim_code, claim_status
  INTO v_order
  FROM public.shop_orders
  WHERE shop_order_id = p_shop_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop order not found';
  END IF;

  -- fulfill_voucher_atomic only accepts a PENDING order; surface that here
  -- rather than letting it fail with the merchant-facing wording.
  IF v_order.claim_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Order is not awaiting fulfilment (currently %)', v_order.claim_status;
  END IF;

  v_merchant_user_id := public.resolve_shop_merchant_user_id(v_order.shop_id);
  IF v_merchant_user_id IS NULL THEN
    RAISE EXCEPTION 'Shop has no assigned merchant to attribute this fulfilment to';
  END IF;

  SELECT array_agg(order_item_id)
  INTO v_present
  FROM public.order_items
  WHERE shop_order_id = p_shop_order_id;

  IF v_present IS NULL OR array_length(v_present, 1) IS NULL THEN
    RAISE EXCEPTION 'Order has no items to fulfil';
  END IF;

  v_result := public.fulfill_voucher_atomic(
    v_order.claim_code,
    v_present,
    ARRAY[]::uuid[],
    v_merchant_user_id
  );

  PERFORM public.log_admin_action(
    'order.force_fulfilled',
    'shop_order',
    p_shop_order_id,
    jsonb_build_object(
      'claim_code', v_order.claim_code,
      'shop_id', v_order.shop_id,
      'item_count', array_length(v_present, 1),
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object('success', true, 'shop_order_id', p_shop_order_id, 'result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_fulfill_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_force_fulfill_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_fulfill_order(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. admin_expire_order
--
-- The same per-item treatment process_expired_vouchers applies when a voucher
-- ages out, applied on demand to one order: the sender is refunded the
-- configured percentage and the merchant keeps the remainder as a credit
-- against the work already done. Settled or disputed orders are refused —
-- their money has either moved already or is deliberately on hold.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_expire_order(
  p_shop_order_id uuid,
  p_reason        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_order RECORD;
  v_buyer_id UUID;
  v_owner_id UUID;
  v_refund_percent INTEGER;
  v_item RECORD;
  v_sender_refund INTEGER;
  v_merchant_credit INTEGER;
  v_total_refund INTEGER := 0;
  v_total_credit INTEGER := 0;
  v_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may expire an order';
  END IF;

  SELECT shop_order_id, shop_id, transaction_id, claim_code, claim_status, settled, disputed_at
  INTO v_order
  FROM public.shop_orders
  WHERE shop_order_id = p_shop_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop order not found';
  END IF;

  IF v_order.claim_status IN ('REDEEMED', 'CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Order is already closed (currently %)', v_order.claim_status;
  END IF;

  IF v_order.settled IS TRUE THEN
    RAISE EXCEPTION 'Order has already been settled';
  END IF;

  IF v_order.disputed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Order is under dispute and cannot be expired';
  END IF;

  SELECT buyer_id INTO v_buyer_id
  FROM public.transactions WHERE transaction_id = v_order.transaction_id;

  SELECT owner_id INTO v_owner_id
  FROM public.shops WHERE id = v_order.shop_id;

  SELECT COALESCE(expiry_sender_refund_percent, 80) INTO v_refund_percent
  FROM public.platform_settings WHERE id = 1;
  v_refund_percent := COALESCE(v_refund_percent, 80);

  FOR v_item IN
    SELECT order_item_id, allocated_price
    FROM public.order_items
    WHERE shop_order_id = p_shop_order_id
      AND fulfillment_status IN ('PENDING', 'FLOATING')
    FOR UPDATE
  LOOP
    v_sender_refund   := floor(v_item.allocated_price * v_refund_percent / 100.0)::integer;
    v_merchant_credit := v_item.allocated_price - v_sender_refund;

    UPDATE public.order_items
    SET fulfillment_status = 'EXPIRED', fulfilled_at = now()
    WHERE order_item_id = v_item.order_item_id;

    IF v_sender_refund > 0 AND v_buyer_id IS NOT NULL THEN
      PERFORM public.increment_wallet_balance(
        v_buyer_id, v_sender_refund,
        'REFUND_EXPIRY:' || v_item.order_item_id, p_shop_order_id);
      v_total_refund := v_total_refund + v_sender_refund;
    END IF;

    IF v_merchant_credit > 0 THEN
      PERFORM public.increment_merchant_balance(v_order.shop_id, v_merchant_credit);

      INSERT INTO public.payout_ledger
        (shop_order_id, shop_id, amount, commission, status, ledger_type, credit_amount)
      VALUES
        (p_shop_order_id, v_order.shop_id, v_merchant_credit, 0,
         'pending_withdrawal', 'EXPIRY_CREDIT', v_merchant_credit);
      v_total_credit := v_total_credit + v_merchant_credit;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Order has no outstanding items to expire';
  END IF;

  UPDATE public.shop_orders
  SET claim_status = 'EXPIRED'
  WHERE shop_order_id = p_shop_order_id;

  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (
    v_order.transaction_id, 'ADMIN_EXPIRED',
    jsonb_build_object(
      'shop_order_id', p_shop_order_id,
      'expired_by', v_uid,
      'item_count', v_count,
      'sender_refund', v_total_refund,
      'merchant_credit', v_total_credit,
      'refund_percent', v_refund_percent,
      'reason', p_reason
    ));

  IF v_buyer_id IS NOT NULL AND v_total_refund > 0 THEN
    PERFORM public.create_notification(
      v_buyer_id,
      'Gift ' || COALESCE(v_order.claim_code, '') || ' has been expired. '
        || v_refund_percent::text || '% of its value is back in your wallet.',
      'warning', p_shop_order_id::text);
  END IF;

  IF v_owner_id IS NOT NULL AND v_total_credit > 0 THEN
    PERFORM public.create_notification(
      v_owner_id,
      'Gift ' || COALESCE(v_order.claim_code, '') || ' was expired. '
        || 'A partial credit has been added to your balance.',
      'info', p_shop_order_id::text);
  END IF;

  PERFORM public.log_admin_action(
    'order.expired',
    'shop_order',
    p_shop_order_id,
    jsonb_build_object(
      'claim_code', v_order.claim_code,
      'shop_id', v_order.shop_id,
      'item_count', v_count,
      'sender_refund', v_total_refund,
      'merchant_credit', v_total_credit,
      'refund_percent', v_refund_percent,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'shop_order_id', p_shop_order_id,
    'item_count', v_count,
    'sender_refund', v_total_refund,
    'merchant_credit', v_total_credit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expire_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_expire_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_expire_order(uuid, text) TO service_role;
