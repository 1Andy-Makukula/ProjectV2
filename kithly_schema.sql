


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" "text", "p_shop_id" "uuid") RETURNS TABLE("voucher_id" "uuid", "item_name" "text", "recipient_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" "text", "p_shop_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" character varying, "p_shop_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_voucher record;
  v_item_name text;
BEGIN
  -- 1. Lock the row exclusively for this exact transaction attempt
  SELECT cv.*, i.name as item_name INTO v_voucher
  FROM public.claim_vouchers cv
  JOIN public.items i ON cv.item_id = i.id
  WHERE cv.claim_code = p_claim_code AND cv.shop_id = p_shop_id
  FOR UPDATE; -- Atomic lock to prevent concurrent double-spends

  -- 2. Evaluate state
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found or does not belong to this shop.';
  END IF;

  IF v_voucher.claim_status = 'FULFILLED' THEN
    RAISE EXCEPTION 'FRAUD_REJECTION: This voucher has already been claimed.';
  END IF;

  IF v_voucher.claim_status = 'EXPIRED' THEN
    RAISE EXCEPTION 'Voucher is expired.';
  END IF;

  -- 3. Execute the Handshake & Set the 48-Hour Settlement Target
  UPDATE public.claim_vouchers
  SET 
    claim_status = 'FULFILLED',
    payout_status = 'PENDING_BATCH',
    settlement_target_time = NOW() + interval '48 hours'
  WHERE id = v_voucher.id;

  -- 4. Return ONLY the product details (The Liability Shield)
  RETURN json_build_object(
    'voucher_id', v_voucher.id,
    'item_name', v_voucher.item_name,
    'recipient_name', v_voucher.recipient_name
  );
END;
$$;


ALTER FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" character varying, "p_shop_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."checkout_init_atomic"("p_buyer_id" "uuid", "p_origin_type" "text", "p_gateway_tx_ref" "text", "p_vendors" "jsonb", "p_recipient_name" "text" DEFAULT NULL::"text", "p_recipient_phone" "text" DEFAULT NULL::"text", "p_message" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."checkout_init_atomic"("p_buyer_id" "uuid", "p_origin_type" "text", "p_gateway_tx_ref" "text", "p_vendors" "jsonb", "p_recipient_name" "text", "p_recipient_phone" "text", "p_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_payment_atomic"("p_transaction_id" "uuid", "p_paid_amount" numeric, "p_paid_currency" "text", "p_payload" "text" DEFAULT NULL::"text", "p_idempotency_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
  SELECT transaction_id, total_amount, status INTO v_txn
  FROM public.transactions WHERE transaction_id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_txn.status = 'SUCCESSFUL' THEN
    IF p_idempotency_key IS NOT NULL THEN
      INSERT INTO public.payment_webhook_idempotency (idempotency_key, transaction_id)
      VALUES (p_idempotency_key, p_transaction_id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN jsonb_build_object('success', true, 'already_confirmed', true);
  END IF;
  IF v_txn.status <> 'GATEWAY_PROCESSING' THEN
    RAISE EXCEPTION 'Transaction is in status %', v_txn.status;
  END IF;
  DECLARE
    v_paid_ngwee INTEGER;
  BEGIN
    IF p_paid_amount < (v_txn.total_amount::numeric / 10.0) THEN
      v_paid_ngwee := round(p_paid_amount * 100)::integer;
    ELSE
      v_paid_ngwee := round(p_paid_amount)::integer;
    END IF;
    IF v_paid_ngwee < v_txn.total_amount OR p_paid_currency <> 'ZMW' THEN
      RAISE EXCEPTION 'Payment amount or currency mismatch';
    END IF;
  END;




  UPDATE public.transactions SET status = 'SUCCESSFUL' WHERE transaction_id = p_transaction_id;
  UPDATE public.shop_orders SET claim_status = 'PENDING'
  WHERE transaction_id = p_transaction_id AND claim_status = 'PENDING_PAYMENT';
  GET DIAGNOSTICS v_orders_updated = ROW_COUNT;
  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (p_transaction_id, 'WEBHOOK_RECEIVED', COALESCE(p_payload, '{}')::JSONB);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.payment_webhook_idempotency (idempotency_key, transaction_id)
    VALUES (p_idempotency_key, p_transaction_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'shop_orders_updated', v_orders_updated);
END;
$$;


ALTER FUNCTION "public"."confirm_payment_atomic"("p_transaction_id" "uuid", "p_paid_amount" numeric, "p_paid_currency" "text", "p_payload" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'role'),
    (SELECT role FROM public.users WHERE id = auth.uid())
  );
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_immutable_ledger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'DCIMe Protocol Violation: Event ledger records cannot be modified or deleted.';
END;
$$;


ALTER FUNCTION "public"."enforce_immutable_ledger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fulfill_voucher_atomic"("p_claim_code" "text", "p_present_item_ids" "uuid"[], "p_missing_item_ids" "uuid"[], "p_merchant_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    )
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


ALTER FUNCTION "public"."fulfill_voucher_atomic"("p_claim_code" "text", "p_present_item_ids" "uuid"[], "p_missing_item_ids" "uuid"[], "p_merchant_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_claim_code"("p_len" integer DEFAULT 8) RETURNS "text"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."gen_claim_code"("p_len" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.users (id, name, email, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    'sender'
  )
  ON CONFLICT (id) DO UPDATE SET
    name  = COALESCE(EXCLUDED.name,  public.users.name),
    email = COALESCE(EXCLUDED.email, public.users.email),
    phone = COALESCE(EXCLUDED.phone, public.users.phone);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_merchant_balance"("target_shop_id" "uuid", "amount_to_add" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."increment_merchant_balance"("target_shop_id" "uuid", "amount_to_add" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" integer, "p_reference" "text" DEFAULT NULL::"text", "p_shop_order_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" integer, "p_reference" "text", "p_shop_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_merchant_shop"("p_shop_name" "text", "p_location" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."register_merchant_shop"("p_shop_name" "text", "p_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_withdrawal_atomic"("target_shop_id" "uuid", "withdrawal_amount" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."request_withdrawal_atomic"("target_shop_id" "uuid", "withdrawal_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_payout_atomic"("p_shop_order_id" "uuid", "p_merchant_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."settle_payout_atomic"("p_shop_order_id" "uuid", "p_merchant_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sweep_hanging_payments"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net', 'vault'
    AS $$
DECLARE
  -- Shared
  v_flw_secret            TEXT;
  v_now                   TIMESTAMPTZ := now();

  -- Phase 1 loop variables
  v_initiated_rec         RECORD;
  v_response_status_code  INTEGER;
  v_response_body         TEXT;
  v_response_timed_out    BOOLEAN;
  v_response_error        TEXT;
  v_flw_json              JSONB;
  v_flw_top_status        TEXT;
  v_flw_data_status       TEXT;
  v_flw_txn_id            TEXT;
  v_flw_ref               TEXT;

  -- Phase 2 loop variables
  v_hanging_rec           RECORD;
  v_request_id            BIGINT;
  v_phase2_count          INTEGER := 0;
  v_phase1_processed      INTEGER := 0;

BEGIN
  RAISE LOG '[sweep_hanging_payments] ===== SWEEP CYCLE START @ % =====', v_now;

  -- -------------------------------------------------------------------------
  -- Read the Flutterwave secret from Supabase Vault.
  -- This is the ONLY place the secret is accessed — it never appears in
  -- application logs, pg_stat_activity, or query plans.
  -- -------------------------------------------------------------------------
  SELECT decrypted_secret
    INTO v_flw_secret
    FROM vault.decrypted_secrets
   WHERE name = 'FLUTTERWAVE_SECRET_KEY'
   LIMIT 1;

  IF v_flw_secret IS NULL OR v_flw_secret = '' THEN
    RAISE WARNING '[sweep_hanging_payments] CRITICAL: Vault secret FLUTTERWAVE_SECRET_KEY is missing or empty. '
                  'Aborting sweep — no requests will be fired and no responses will be processed.';
    RETURN;
  END IF;

  -- =========================================================================
  -- PHASE 1 — Response Harvesting
  --
  -- Find all POLLING_SYNC_INITIATED events that do NOT yet have a
  -- corresponding terminal event (SUCCESS or FAILED). For each one, check
  -- net._http_response to see if the async HTTP call has completed.
  -- =========================================================================
  RAISE LOG '[sweep_hanging_payments] --- Phase 1: Harvesting async responses ---';

  FOR v_initiated_rec IN
    SELECT
      te.id              AS event_id,
      te.voucher_id,
      te.created_at      AS initiated_at,
      -- The request_id stored in the payload was written as a JSONB object:
      -- {"request_id": 12345}. We cast it back to BIGINT for the lookup.
      (te.payload::jsonb ->> 'request_id')::bigint AS pg_net_request_id
    FROM
      public.transaction_events te
    WHERE
      te.event_type = 'POLLING_SYNC_INITIATED'
      -- Only look at initiations from the last 2 hours to avoid scanning
      -- stale rows that will never have a response (request expired).
      AND te.created_at > v_now - INTERVAL '2 hours'
      -- Exclude vouchers that already have a terminal event from a previous
      -- successful harvest — prevents double-processing on slow responses.
      AND NOT EXISTS (
        SELECT 1
          FROM public.transaction_events te2
         WHERE te2.voucher_id  = te.voucher_id
           AND te2.event_type  IN ('POLLING_SYNC_SUCCESS', 'POLLING_SYNC_FAILED')
           AND te2.created_at  > te.created_at
      )
    ORDER BY
      te.created_at ASC
  LOOP
    -- Check net._http_response for a completed response for this request_id.
    -- If the row doesn't exist yet, the HTTP call is still in flight — skip it.
    SELECT
      status_code,
      body,
      timed_out,
      error_msg
    INTO
      v_response_status_code,
      v_response_body,
      v_response_timed_out,
      v_response_error
    FROM
      net._http_response
    WHERE
      id = v_initiated_rec.pg_net_request_id;

    -- No row yet → request still pending; will be picked up by the next tick.
    IF NOT FOUND THEN
      RAISE LOG '[sweep_hanging_payments] Phase 1: Request % for voucher % not yet complete — skipping.',
        v_initiated_rec.pg_net_request_id,
        v_initiated_rec.voucher_id;
      CONTINUE;
    END IF;

    v_phase1_processed := v_phase1_processed + 1;

    -- ----- Timed-out or transport error -----
    IF v_response_timed_out OR v_response_error IS NOT NULL THEN
      RAISE WARNING '[sweep_hanging_payments] Phase 1: Request % for voucher % failed — timed_out=%, error=%',
        v_initiated_rec.pg_net_request_id,
        v_initiated_rec.voucher_id,
        v_response_timed_out,
        v_response_error;

      -- Write a non-terminal POLLING_SYNC_FAILED event so Phase 2 of the
      -- NEXT sweep can re-fire a new request for this voucher.
      INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.voucher_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',     COALESCE(v_response_error, 'request_timeout'),
          'timed_out',  v_response_timed_out,
          'request_id', v_initiated_rec.pg_net_request_id
        )::text,
        v_now
      );
      CONTINUE;
    END IF;

    -- ----- Parse the Flutterwave response body -----
    BEGIN
      v_flw_json := v_response_body::jsonb;
    EXCEPTION WHEN others THEN
      RAISE WARNING '[sweep_hanging_payments] Phase 1: Response body for request % is not valid JSON: %',
        v_initiated_rec.pg_net_request_id,
        left(v_response_body, 200);

      INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.voucher_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',      'invalid_json_response',
          'http_status', v_response_status_code,
          'body_prefix', left(v_response_body, 500),
          'request_id',  v_initiated_rec.pg_net_request_id
        )::text,
        v_now
      );
      CONTINUE;
    END;

    -- Extract the two status fields we care about:
    --   .status       → "success" (Flutterwave API envelope status)
    --   .data.status  → "successful" (the actual transaction outcome)
    v_flw_top_status  := v_flw_json ->> 'status';
    v_flw_data_status := v_flw_json -> 'data' ->> 'status';
    v_flw_txn_id      := (v_flw_json -> 'data' ->> 'id');
    v_flw_ref         := v_flw_json -> 'data' ->> 'flw_ref';

    RAISE LOG '[sweep_hanging_payments] Phase 1: voucher=% | http_status=% | flw_status=% | data_status=%',
      v_initiated_rec.voucher_id,
      v_response_status_code,
      v_flw_top_status,
      v_flw_data_status;

    -- ----- SUCCESS: Flutterwave confirmed payment -----
    IF v_response_status_code = 200
       AND v_flw_top_status  = 'success'
       AND v_flw_data_status = 'successful'
    THEN
      -- Immutable ledger: record the sweep confirmation event.
      -- Storing the full raw response body preserves the complete audit trail.
      INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.voucher_id,
        'POLLING_SYNC_SUCCESS',
        v_response_body,   -- Full Flutterwave JSON string
        v_now
      );

      -- Promote payout_status from UNFUNDED → PENDING_BATCH.
      --
      -- The WHERE payout_status = 'UNFUNDED' filter makes this idempotent:
      -- if the webhook (Layer A) already promoted this row, this UPDATE
      -- matches zero rows and is a safe no-op — no regression possible.
      --
      -- claim_status is deliberately NOT touched here.
      -- That column belongs to the merchant redemption flow.
      UPDATE public.claim_vouchers
         SET
           payout_status             = 'PENDING_BATCH',
           flutterwave_transaction_id = v_flw_txn_id,
           flw_ref                   = v_flw_ref,
           funded_at                 = v_now
       WHERE
           voucher_id   = v_initiated_rec.voucher_id
           AND payout_status = 'UNFUNDED';   -- Idempotency guard

      RAISE LOG '[sweep_hanging_payments] Phase 1: voucher % CONFIRMED and promoted to PENDING_BATCH.',
        v_initiated_rec.voucher_id;

    -- ----- NOT PAID: Flutterwave says the transaction is not successful -----
    ELSE
      INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.voucher_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',      'payment_not_confirmed',
          'http_status', v_response_status_code,
          'flw_status',  v_flw_top_status,
          'data_status', v_flw_data_status,
          'request_id',  v_initiated_rec.pg_net_request_id
        )::text,
        v_now
      );

      RAISE LOG '[sweep_hanging_payments] Phase 1: voucher % not paid per Flutterwave (flw_status=%, data_status=%).',
        v_initiated_rec.voucher_id,
        v_flw_top_status,
        v_flw_data_status;
    END IF;

  END LOOP;

  RAISE LOG '[sweep_hanging_payments] Phase 1 complete: % response(s) processed.', v_phase1_processed;


  -- =========================================================================
  -- PHASE 2 — Request Initiation
  --
  -- Find all claim_vouchers that are:
  --   1. Still UNFUNDED (not yet confirmed by webhook or a previous sweep)
  --   2. Older than 10 minutes (give the webhook enough time to arrive first)
  --   3. Not already under an active sweep request from the last 15 minutes
  --      (prevents firing duplicate requests for the same voucher per cycle)
  --
  -- For each match, fire an async pg_net.http_get to the Flutterwave
  -- transaction verification API and store the returned request_id in the
  -- transaction_events ledger so Phase 1 of the next tick can harvest it.
  -- =========================================================================
  RAISE LOG '[sweep_hanging_payments] --- Phase 2: Firing verification requests ---';

  FOR v_hanging_rec IN
    SELECT
      cv.voucher_id
    FROM
      public.claim_vouchers cv
    WHERE
      cv.payout_status = 'UNFUNDED'
      -- Must be older than 10 minutes to give Layer A (webhook) and Layer B
      -- (frontend polling) a fair window to succeed before we intervene.
      AND cv.created_at < v_now - INTERVAL '10 minutes'
      -- Don't re-fire if we already sent a sweep request within the last
      -- 15 minutes. This prevents multiple in-flight requests for the same
      -- voucher in a single cycle (one request per sweep cycle is enough).
      AND NOT EXISTS (
        SELECT 1
          FROM public.transaction_events te
         WHERE te.voucher_id = cv.voucher_id
           AND te.event_type = 'POLLING_SYNC_INITIATED'
           AND te.created_at > v_now - INTERVAL '15 minutes'
      )
    ORDER BY
      cv.created_at ASC   -- Process oldest-hanging vouchers first
  LOOP
    -- Fire the async HTTP GET to Flutterwave's verify-by-reference endpoint.
    -- The tx_ref we originally passed to Flutterwave was the voucher_id itself
    -- (set in checkout-init), so we use it directly here.
    --
    -- pg_net.http_get() returns a BIGINT request_id immediately.
    -- The actual HTTP call happens in a background worker.
    -- The response is written to net._http_response when it completes.
    SELECT net.http_get(
      url     => format(
                   'https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=%s',
                   v_hanging_rec.voucher_id
                 ),
      headers => jsonb_build_object(
                   'Authorization', 'Bearer ' || v_flw_secret,
                   'Content-Type',  'application/json'
                 )
    ) INTO v_request_id;

    -- Persist the request_id in the ledger so Phase 1 of the next cycle
    -- can look it up in net._http_response.
    INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
    VALUES (
      v_hanging_rec.voucher_id,
      'POLLING_SYNC_INITIATED',
      jsonb_build_object(
        'request_id',  v_request_id,
        'initiated_at', v_now
      )::text,
      v_now
    );

    v_phase2_count := v_phase2_count + 1;

    RAISE LOG '[sweep_hanging_payments] Phase 2: Fired request_id=% for voucher=%.',
      v_request_id,
      v_hanging_rec.voucher_id;

  END LOOP;

  RAISE LOG '[sweep_hanging_payments] Phase 2 complete: % request(s) fired.', v_phase2_count;
  RAISE LOG '[sweep_hanging_payments] ===== SWEEP CYCLE END @ % =====', clock_timestamp();

END;
$$;


ALTER FUNCTION "public"."sweep_hanging_payments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_daily_payout_sweeper"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  edge_function_url text := 'https://mbjbrdhpjgfhhycijodz.supabase.co/functions/v1/batch-payout-sweeper';
  service_role_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iamJyZGhwamdmaGh5Y2lqb2R6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM0Nzk1NSwiZXhwIjoyMDk0OTIzOTU1fQ.SjgLTTbUOFzPQuAjZNW6IQhCbzsqUMVEyKvBAFBlieM'; -- Used to bypass RLS for background workers
  request_id bigint;
BEGIN
  -- Shoot the internal network payload to start the payout Edge Function
  SELECT net.http_post(
      url := edge_function_url,
      headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_role_key
      ),
      body := '{}'::jsonb
  ) INTO request_id;
END;
$$;


ALTER FUNCTION "public"."trigger_daily_payout_sweeper"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_payment_sweeper"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  edge_function_url text := 'https://<YOUR_PROJECT_ID>.supabase.co/functions/v1/sweep-hanging-payments';
  service_role_key text := '<YOUR_SUPABASE_SERVICE_ROLE_KEY>'; -- Used to bypass RLS for internal admin tasks
  request_id bigint;
BEGIN
  -- Perform an asynchronous HTTP POST to the Edge Function
  SELECT net.http_post(
      url := edge_function_url,
      headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_role_key
      ),
      body := '{}'::jsonb
  ) INTO request_id;
END;
$$;


ALTER FUNCTION "public"."trigger_payment_sweeper"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "image_url" "text",
    "is_featured" boolean DEFAULT false,
    "ui_order_index" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "price_zmw" integer NOT NULL,
    "currency" "text" DEFAULT 'ZMW'::"text",
    "image_url" "text",
    "is_available" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_weekly_pick" boolean DEFAULT false,
    "promo_badge_text" "text",
    "category_id" "uuid",
    CONSTRAINT "items_base_price_check" CHECK (("price_zmw" > 0))
);


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kithly_wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "balance" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'ZMW'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "kithly_wallets_balance_check" CHECK (("balance" >= 0))
);


ALTER TABLE "public"."kithly_wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketing_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "image_url" "text" NOT NULL,
    "target_route" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."marketing_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."merchant_shops" (
    "user_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."merchant_shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "order_item_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_order_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "allocated_price" integer NOT NULL,
    "fulfillment_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "fulfilled_at" timestamp with time zone,
    CONSTRAINT "order_items_allocated_price_check" CHECK (("allocated_price" >= 0)),
    CONSTRAINT "order_items_fulfillment_status_check" CHECK (("fulfillment_status" = ANY (ARRAY['PENDING'::"text", 'COLLECTED'::"text", 'MISSING'::"text"])))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_webhook_idempotency" (
    "idempotency_key" "text" NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payment_webhook_idempotency" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_order_id" "uuid",
    "shop_id" "uuid" NOT NULL,
    "credit_amount" integer DEFAULT 0 NOT NULL,
    "ledger_type" "text" DEFAULT 'FULFILLMENT_CREDIT'::"text" NOT NULL,
    "reference" "text",
    "amount" integer,
    "commission" integer,
    "status" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payout_ledger_credit_amount_check" CHECK (("credit_amount" >= 0))
);


ALTER TABLE "public"."payout_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_orders" (
    "shop_order_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "claim_code" character varying NOT NULL,
    "recipient_name" "text" NOT NULL,
    "recipient_phone" "text" NOT NULL,
    "claim_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "payout_status" "text" DEFAULT 'UNFUNDED'::"text" NOT NULL,
    "settlement_target_time" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "message" "text",
    "fulfilled_at" timestamp with time zone,
    "subtotal" integer DEFAULT 0 NOT NULL,
    "settled" boolean DEFAULT false,
    CONSTRAINT "shop_orders_claim_status_check" CHECK (("claim_status" = ANY (ARRAY['PENDING_PAYMENT'::"text", 'PENDING'::"text", 'PROCESSING_FULFILLMENT'::"text", 'PARTIAL_FULFILLMENT'::"text", 'FULFILLED'::"text", 'REDEEMED'::"text", 'CANCELLED'::"text", 'EXPIRED'::"text"]))),
    CONSTRAINT "shop_orders_payout_status_check" CHECK (("payout_status" = ANY (ARRAY['UNFUNDED'::"text", 'PENDING_BATCH'::"text", 'SETTLED'::"text"])))
);


ALTER TABLE "public"."shop_orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shop_orders"."message" IS 'Optional personal message from the sender (max 200 chars). Displayed on the GiftPage for the recipient.';



CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "location" "text",
    "address" "text",
    "payout_method" "text",
    "payout_details" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "logo_url" "text",
    "description" "text",
    "image_url" "text",
    "cover_image_url" "text",
    CONSTRAINT "shops_payout_method_check" CHECK (("payout_method" = ANY (ARRAY['airtel'::"text", 'mtn'::"text", 'bank'::"text"])))
);


ALTER TABLE "public"."shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transaction_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_order_id" "uuid",
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "transaction_id" "uuid"
);


ALTER TABLE "public"."transaction_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "transaction_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "buyer_id" "uuid" NOT NULL,
    "gateway_tx_ref" "text",
    "total_amount" integer NOT NULL,
    "currency" "text" DEFAULT 'ZMW'::"text" NOT NULL,
    "status" "text" DEFAULT 'GATEWAY_PROCESSING'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "origin_type" "text" DEFAULT 'LOCAL'::"text",
    CONSTRAINT "transactions_total_amount_check" CHECK (("total_amount" >= 0))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "role" "text" DEFAULT 'sender'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['sender'::"text", 'merchant'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kithly_wallets"
    ADD CONSTRAINT "kithly_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kithly_wallets"
    ADD CONSTRAINT "kithly_wallets_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."merchant_shops"
    ADD CONSTRAINT "merchant_shops_pkey" PRIMARY KEY ("user_id", "shop_id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("order_item_id");



ALTER TABLE ONLY "public"."payment_webhook_idempotency"
    ADD CONSTRAINT "payment_webhook_idempotency_pkey" PRIMARY KEY ("idempotency_key");



ALTER TABLE ONLY "public"."payout_ledger"
    ADD CONSTRAINT "payout_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_orders"
    ADD CONSTRAINT "shop_orders_claim_code_key" UNIQUE ("claim_code");



ALTER TABLE ONLY "public"."shop_orders"
    ADD CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("shop_order_id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transaction_events"
    ADD CONSTRAINT "transaction_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_flutterwave_ref_key" UNIQUE ("gateway_tx_ref");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("transaction_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_shop_orders_claim_code" ON "public"."shop_orders" USING "btree" ("claim_code");



CREATE INDEX "idx_shop_orders_transaction_id" ON "public"."shop_orders" USING "btree" ("transaction_id");



CREATE INDEX "idx_transaction_events_txn_event_type" ON "public"."transaction_events" USING "btree" ("transaction_id", "event_type");



CREATE INDEX "idx_transactions_buyer_id" ON "public"."transactions" USING "btree" ("buyer_id");



CREATE INDEX "idx_transactions_flutterwave_ref" ON "public"."transactions" USING "btree" ("gateway_tx_ref");



CREATE UNIQUE INDEX "idx_transactions_gateway_tx_ref" ON "public"."transactions" USING "btree" ("gateway_tx_ref") WHERE ("gateway_tx_ref" IS NOT NULL);



CREATE INDEX "idx_transactions_sender_id" ON "public"."transactions" USING "btree" ("buyer_id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."kithly_wallets"
    ADD CONSTRAINT "kithly_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."merchant_shops"
    ADD CONSTRAINT "merchant_shops_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."merchant_shops"
    ADD CONSTRAINT "merchant_shops_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_shop_order_id_fkey" FOREIGN KEY ("shop_order_id") REFERENCES "public"."shop_orders"("shop_order_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payout_ledger"
    ADD CONSTRAINT "payout_ledger_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."shop_orders"
    ADD CONSTRAINT "shop_orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_orders"
    ADD CONSTRAINT "shop_orders_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("transaction_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."transaction_events"
    ADD CONSTRAINT "transaction_events_shop_order_id_fkey" FOREIGN KEY ("shop_order_id") REFERENCES "public"."shop_orders"("shop_order_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_sender_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Active shops are publicly readable" ON "public"."shops" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



CREATE POLICY "Active shops are readable by authenticated users" ON "public"."shops" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "Admins can manage merchant_shops" ON "public"."merchant_shops" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Campaigns are viewable by everyone" ON "public"."marketing_campaigns" FOR SELECT USING (true);



CREATE POLICY "Categories are viewable by everyone" ON "public"."categories" FOR SELECT USING (true);



CREATE POLICY "Categories are viewable by everyone." ON "public"."categories" FOR SELECT USING (true);



CREATE POLICY "Marketing campaigns are publicly readable" ON "public"."marketing_campaigns" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



CREATE POLICY "Merchants can read their own shop assignment" ON "public"."merchant_shops" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Owners can manage items" ON "public"."items" USING ((EXISTS ( SELECT 1
   FROM "public"."shops"
  WHERE (("shops"."id" = "items"."shop_id") AND ("shops"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Owners can update own shop" ON "public"."shops" FOR UPDATE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Public can view active shops" ON "public"."shops" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Public can view available items" ON "public"."items" FOR SELECT USING (("is_available" = true));



CREATE POLICY "Shop owners can view order items for their shops" ON "public"."order_items" FOR SELECT USING (("shop_order_id" IN ( SELECT "shop_orders"."shop_order_id" AS "id"
   FROM "public"."shop_orders"
  WHERE ("shop_orders"."shop_id" IN ( SELECT "shops"."id"
           FROM "public"."shops"
          WHERE ("shops"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "Shop owners can view their shop orders" ON "public"."shop_orders" FOR SELECT USING (("shop_id" IN ( SELECT "shops"."id"
   FROM "public"."shops"
  WHERE ("shops"."owner_id" = "auth"."uid"()))));



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view events for their shop orders" ON "public"."transaction_events" FOR SELECT USING (("shop_order_id" IN ( SELECT "shop_orders"."shop_order_id" AS "id"
   FROM "public"."shop_orders"
  WHERE ("shop_orders"."transaction_id" IN ( SELECT "transactions"."transaction_id" AS "id"
           FROM "public"."transactions"
          WHERE ("transactions"."buyer_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view order items for their shop orders" ON "public"."order_items" FOR SELECT USING (("shop_order_id" IN ( SELECT "shop_orders"."shop_order_id" AS "id"
   FROM "public"."shop_orders"
  WHERE ("shop_orders"."transaction_id" IN ( SELECT "transactions"."transaction_id" AS "id"
           FROM "public"."transactions"
          WHERE ("transactions"."buyer_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view own profile" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view shop orders linked to their transactions" ON "public"."shop_orders" FOR SELECT USING (("transaction_id" IN ( SELECT "transactions"."transaction_id" AS "id"
   FROM "public"."transactions"
  WHERE ("transactions"."buyer_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own transactions" ON "public"."transactions" FOR SELECT USING (("auth"."uid"() = "buyer_id"));



CREATE POLICY "Users can view their own wallet" ON "public"."kithly_wallets" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "items_admin_write" ON "public"."items" TO "authenticated" USING (("public"."current_user_role"() = 'admin'::"text")) WITH CHECK (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "items_merchant_write" ON "public"."items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."merchant_shops" "ms"
  WHERE (("ms"."shop_id" = "items"."shop_id") AND ("ms"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."merchant_shops" "ms"
  WHERE (("ms"."shop_id" = "items"."shop_id") AND ("ms"."user_id" = "auth"."uid"())))));



CREATE POLICY "items_public_read" ON "public"."items" FOR SELECT TO "authenticated", "anon" USING (("is_available" IS NOT FALSE));



ALTER TABLE "public"."kithly_wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketing_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."merchant_shops" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "merchant_shops_admin_write" ON "public"."merchant_shops" TO "authenticated" USING (("public"."current_user_role"() = 'admin'::"text")) WITH CHECK (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "merchant_shops_select_own" ON "public"."merchant_shops" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("public"."current_user_role"() = 'admin'::"text")));



ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_items_select" ON "public"."order_items" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."shop_orders" "so"
  WHERE ("so"."shop_order_id" = "order_items"."shop_order_id"))));



ALTER TABLE "public"."payment_webhook_idempotency" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payout_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payout_ledger_merchant_select" ON "public"."payout_ledger" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."merchant_shops" "ms"
  WHERE (("ms"."shop_id" = "payout_ledger"."shop_id") AND ("ms"."user_id" = "auth"."uid"())))) OR ("public"."current_user_role"() = 'admin'::"text")));



ALTER TABLE "public"."shop_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shop_orders_select" ON "public"."shop_orders" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."transactions" "t"
  WHERE (("t"."transaction_id" = "shop_orders"."transaction_id") AND ("t"."buyer_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."merchant_shops" "ms"
  WHERE (("ms"."shop_id" = "shop_orders"."shop_id") AND ("ms"."user_id" = "auth"."uid"())))) OR ("public"."current_user_role"() = 'admin'::"text")));



CREATE POLICY "shop_orders_select_by_claim_code" ON "public"."shop_orders" FOR SELECT TO "authenticated", "anon" USING (("claim_code" IS NOT NULL));



ALTER TABLE "public"."shops" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shops_admin_write" ON "public"."shops" TO "authenticated" USING (("public"."current_user_role"() = 'admin'::"text")) WITH CHECK (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "shops_public_read" ON "public"."shops" FOR SELECT TO "authenticated", "anon" USING ((("is_active" IS TRUE) OR ("owner_id" = "auth"."uid"()) OR ("public"."current_user_role"() = 'admin'::"text")));



ALTER TABLE "public"."transaction_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transaction_events_select" ON "public"."transaction_events" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."transactions" "t"
  WHERE (("t"."transaction_id" = "transaction_events"."transaction_id") AND ("t"."buyer_id" = "auth"."uid"())))) OR ("public"."current_user_role"() = 'admin'::"text")));



ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transactions_select_buyer" ON "public"."transactions" FOR SELECT TO "authenticated" USING ((("buyer_id" = "auth"."uid"()) OR ("public"."current_user_role"() = 'admin'::"text")));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_admin_all" ON "public"."users" TO "authenticated" USING (("public"."current_user_role"() = 'admin'::"text")) WITH CHECK (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "users_insert_own" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "users_select_own" ON "public"."users" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR ("public"."current_user_role"() = 'admin'::"text")));



CREATE POLICY "users_update_own_no_role" ON "public"."users" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK ((("id" = "auth"."uid"()) AND ("role" = ( SELECT "u"."role"
   FROM "public"."users" "u"
  WHERE ("u"."id" = "auth"."uid"())))));



CREATE POLICY "wallets_select_own" ON "public"."kithly_wallets" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("public"."current_user_role"() = 'admin'::"text")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































REVOKE ALL ON FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" "text", "p_shop_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" "text", "p_shop_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" "text", "p_shop_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" "text", "p_shop_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" character varying, "p_shop_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" character varying, "p_shop_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atomic_fulfill_voucher"("p_claim_code" character varying, "p_shop_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."checkout_init_atomic"("p_buyer_id" "uuid", "p_origin_type" "text", "p_gateway_tx_ref" "text", "p_vendors" "jsonb", "p_recipient_name" "text", "p_recipient_phone" "text", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."checkout_init_atomic"("p_buyer_id" "uuid", "p_origin_type" "text", "p_gateway_tx_ref" "text", "p_vendors" "jsonb", "p_recipient_name" "text", "p_recipient_phone" "text", "p_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."checkout_init_atomic"("p_buyer_id" "uuid", "p_origin_type" "text", "p_gateway_tx_ref" "text", "p_vendors" "jsonb", "p_recipient_name" "text", "p_recipient_phone" "text", "p_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkout_init_atomic"("p_buyer_id" "uuid", "p_origin_type" "text", "p_gateway_tx_ref" "text", "p_vendors" "jsonb", "p_recipient_name" "text", "p_recipient_phone" "text", "p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_payment_atomic"("p_transaction_id" "uuid", "p_paid_amount" numeric, "p_paid_currency" "text", "p_payload" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_payment_atomic"("p_transaction_id" "uuid", "p_paid_amount" numeric, "p_paid_currency" "text", "p_payload" "text", "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_payment_atomic"("p_transaction_id" "uuid", "p_paid_amount" numeric, "p_paid_currency" "text", "p_payload" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_payment_atomic"("p_transaction_id" "uuid", "p_paid_amount" numeric, "p_paid_currency" "text", "p_payload" "text", "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_immutable_ledger"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_immutable_ledger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_immutable_ledger"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fulfill_voucher_atomic"("p_claim_code" "text", "p_present_item_ids" "uuid"[], "p_missing_item_ids" "uuid"[], "p_merchant_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fulfill_voucher_atomic"("p_claim_code" "text", "p_present_item_ids" "uuid"[], "p_missing_item_ids" "uuid"[], "p_merchant_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fulfill_voucher_atomic"("p_claim_code" "text", "p_present_item_ids" "uuid"[], "p_missing_item_ids" "uuid"[], "p_merchant_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fulfill_voucher_atomic"("p_claim_code" "text", "p_present_item_ids" "uuid"[], "p_missing_item_ids" "uuid"[], "p_merchant_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."gen_claim_code"("p_len" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."gen_claim_code"("p_len" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."gen_claim_code"("p_len" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_merchant_balance"("target_shop_id" "uuid", "amount_to_add" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_merchant_balance"("target_shop_id" "uuid", "amount_to_add" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_merchant_balance"("target_shop_id" "uuid", "amount_to_add" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_merchant_balance"("target_shop_id" "uuid", "amount_to_add" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" integer, "p_reference" "text", "p_shop_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" integer, "p_reference" "text", "p_shop_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" integer, "p_reference" "text", "p_shop_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" integer, "p_reference" "text", "p_shop_order_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_merchant_shop"("p_shop_name" "text", "p_location" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."register_merchant_shop"("p_shop_name" "text", "p_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_merchant_shop"("p_shop_name" "text", "p_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_withdrawal_atomic"("target_shop_id" "uuid", "withdrawal_amount" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_withdrawal_atomic"("target_shop_id" "uuid", "withdrawal_amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."request_withdrawal_atomic"("target_shop_id" "uuid", "withdrawal_amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_withdrawal_atomic"("target_shop_id" "uuid", "withdrawal_amount" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."settle_payout_atomic"("p_shop_order_id" "uuid", "p_merchant_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_payout_atomic"("p_shop_order_id" "uuid", "p_merchant_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."settle_payout_atomic"("p_shop_order_id" "uuid", "p_merchant_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."settle_payout_atomic"("p_shop_order_id" "uuid", "p_merchant_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sweep_hanging_payments"() TO "anon";
GRANT ALL ON FUNCTION "public"."sweep_hanging_payments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sweep_hanging_payments"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_daily_payout_sweeper"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_daily_payout_sweeper"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_daily_payout_sweeper"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_payment_sweeper"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_payment_sweeper"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_payment_sweeper"() TO "service_role";
























GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."items" TO "anon";
GRANT ALL ON TABLE "public"."items" TO "authenticated";
GRANT ALL ON TABLE "public"."items" TO "service_role";



GRANT ALL ON TABLE "public"."kithly_wallets" TO "anon";
GRANT ALL ON TABLE "public"."kithly_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."kithly_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."marketing_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."merchant_shops" TO "anon";
GRANT ALL ON TABLE "public"."merchant_shops" TO "authenticated";
GRANT ALL ON TABLE "public"."merchant_shops" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON TABLE "public"."payment_webhook_idempotency" TO "anon";
GRANT ALL ON TABLE "public"."payment_webhook_idempotency" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_webhook_idempotency" TO "service_role";



GRANT ALL ON TABLE "public"."payout_ledger" TO "anon";
GRANT ALL ON TABLE "public"."payout_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."shop_orders" TO "anon";
GRANT ALL ON TABLE "public"."shop_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_orders" TO "service_role";



GRANT ALL ON TABLE "public"."shops" TO "anon";
GRANT ALL ON TABLE "public"."shops" TO "authenticated";
GRANT ALL ON TABLE "public"."shops" TO "service_role";



GRANT ALL ON TABLE "public"."transaction_events" TO "anon";
GRANT ALL ON TABLE "public"."transaction_events" TO "authenticated";
GRANT ALL ON TABLE "public"."transaction_events" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































