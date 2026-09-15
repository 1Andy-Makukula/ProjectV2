-- =============================================================================
-- fulfill_voucher_atomic: dual-write to the double-entry ledger
--
-- WHY THIS FILE LOOKS LIKE A COPY
-- -------------------------------
-- It is one, deliberately. `fulfill_voucher_atomic` has been redefined seven
-- times in this history and PostgreSQL has no "alter the middle of a function"
-- -- a change means CREATE OR REPLACE with the whole body. Retyping 215 lines
-- of live money-moving code from memory is how the checkout_init_atomic
-- incident happened (see ADR 0001 and 20260901000000), so this body was not
-- retyped.
--
-- It was extracted verbatim from its live definition in
-- 20260727050000_notification_coverage.sql (lines 113-327), patched by exact
-- string replacement at a single unique anchor, and diffed. The complete diff
-- against the live body is eleven added lines and nothing else:
--
--     198a199,209
--     >   -- DUAL-WRITE (20260915040000). ...
--     >   PERFORM public.escrow_shadow_redemption(...);
--
-- No existing line is modified, moved or removed.
--
-- WHY CREATE OR REPLACE AND NOT DROP + CREATE
-- -------------------------------------------
-- A DROP loses the ACL. That is precisely how this project once re-granted a
-- money function to `authenticated` without noticing. The signature is
-- unchanged, so REPLACE keeps the existing grants intact.
--
-- WHAT IT DOES
-- ------------
-- Nothing observable. The legacy float advance, wallet refund and dispute
-- window all behave exactly as before. The single added statement records the
-- same movement in `ledger_entries` so §11's dual-write period can prove the
-- two models agree before anything is cut over. When escrow_mode is `legacy`
-- the added call returns immediately.
-- =============================================================================

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

  -- DUAL-WRITE (20260915040000). The legacy balances above are unchanged;
  -- this records the same movement in the double-entry ledger so the two
  -- models can be compared before the cutover. Inside this transaction, so a
  -- fulfilment that cannot be recorded does not happen.
  PERFORM public.escrow_shadow_redemption(
    v_order.shop_order_id,
    upper(trim(p_claim_code)),
    v_present_total,
    v_missing_total
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

