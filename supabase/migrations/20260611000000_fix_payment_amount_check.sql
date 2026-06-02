-- Migration to fix payment amount validation logic for confirm_payment_atomic
-- Automatically detects and normalizes ZMW decimal amounts to ngwee base integers

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
  v_paid_ngwee INTEGER;
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

  -- Detect if amount is in decimal Kwacha (ZMW) or integer ngwee base
  -- If p_paid_amount is less than (v_txn.total_amount::numeric / 10.0), it is represented in ZMW, convert to ngwee
  IF p_paid_amount < (v_txn.total_amount::numeric / 10.0) THEN
    v_paid_ngwee := round(p_paid_amount * 100)::integer;
  ELSE
    v_paid_ngwee := round(p_paid_amount)::integer;
  END IF;

  IF v_paid_ngwee < v_txn.total_amount OR p_paid_currency <> 'ZMW' THEN
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
  VALUES (p_transaction_id, 'WEBHOOK_RECEIVED', COALESCE(p_payload, '{}')::JSONB);

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

REVOKE ALL ON FUNCTION public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
