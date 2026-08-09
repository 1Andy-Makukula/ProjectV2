-- =============================================================================
-- Freeze the checkout seam: one typed context object instead of a parameter tail
--
-- WHY
-- ---
-- checkout_init_atomic has been rewritten nine times and grown from seven
-- positional parameters to twelve. Every new selling mode -- credits,
-- scheduled services, experiences, expiry windows -- was bolted on by appending
-- another argument, and each of those rewrites had to reproduce the entire
-- function body to do it. That is how a stale overload ended up live in
-- production (PGRST203 on a four-argument call), and it is why the FX work in
-- Phase C would otherwise have made a thirteenth parameter.
--
-- The four arguments that identify a checkout stay positional: who is buying,
-- where from, the gateway reference, and the basket. Everything else is
-- context, and context now travels in one JSONB object. A new vertical adds a
-- key; it does not touch the signature, and it does not require retyping the
-- body.
--
-- WHY A BAG IS SAFE HERE
-- ----------------------
-- The obvious objection to a JSONB bag is that it trades compile-time safety
-- for convenience: misspell a positional parameter and the call fails, misspell
-- a key and it silently becomes NULL -- an order quietly losing its recipient
-- or its expiry date, with nothing to notice.
--
-- So unknown keys are rejected outright. `p_context` is a closed set, and
-- anything unrecognised stops the checkout rather than being ignored. That is
-- the property that makes this shape acceptable rather than merely tidier.
--
-- HOW THIS WAS BUILT
-- ------------------
-- The body below was generated from the live definition via
-- pg_get_functiondef, with the eight context parameters renamed to locals by
-- word-boundary-anchored replacement and the occurrence counts asserted
-- (1,1,1,1,7,1,3,1). It was not retyped. Reproducing ~150 lines of money
-- handling by hand to change a signature is exactly the trade that nearly
-- destroyed sweep_hanging_payments earlier in this series.
--
-- THE GRANT TRAP
-- --------------
-- A changed signature is a NEW pg_proc entry, and new functions are created
-- with the PUBLIC default EXECUTE grant. The ACL from 20260809000000 does NOT
-- carry over. Both the revoke and the drop of the old signature are handled
-- explicitly below, and asserted afterwards.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.checkout_init_atomic(
  p_buyer_id UUID,
  p_origin_type TEXT,
  p_gateway_tx_ref TEXT,
  p_vendors JSONB,
  p_context JSONB DEFAULT '{}'::JSONB
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recipient_name TEXT;
  v_recipient_phone TEXT;
  v_message TEXT;
  v_sender_phone TEXT;
  v_credits_to_apply INTEGER;
  v_target_execution_date TIMESTAMPTZ;
  v_experience_id UUID;
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
  v_expires_at TIMESTAMPTZ;   -- assigned from p_context below

  v_stock RECORD;
  v_on_hand INTEGER;
  v_item_name TEXT;
  v_available BOOLEAN;
  -- item_id -> unit price actually charged, after any quantity break.
  v_unit_prices JSONB := '{}'::JSONB;
BEGIN
  -- Reject unknown keys.
  --
  -- This is what makes a JSONB bag safe to accept. With positional parameters a
  -- misspelled name is a call-time error; with a bag it silently becomes NULL,
  -- and an order quietly loses its recipient or its expiry. Anything not
  -- recognised here stops the checkout instead.
  IF p_context IS NOT NULL AND p_context <> '{}'::JSONB THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_context) AS k
      WHERE k NOT IN ('recipient_name', 'recipient_phone', 'message', 'sender_phone', 'credits_to_apply', 'target_execution_date', 'experience_id', 'expires_at')
    ) THEN
      RAISE EXCEPTION 'Unknown key(s) in p_context: %', (
        SELECT string_agg(k, ', ' ORDER BY k)
        FROM jsonb_object_keys(p_context) AS k
        WHERE k NOT IN ('recipient_name', 'recipient_phone', 'message', 'sender_phone', 'credits_to_apply', 'target_execution_date', 'experience_id', 'expires_at')
      );
    END IF;
  END IF;

  v_recipient_name := (p_context->>'recipient_name')::TEXT;
  v_recipient_phone := (p_context->>'recipient_phone')::TEXT;
  v_message := (p_context->>'message')::TEXT;
  v_sender_phone := (p_context->>'sender_phone')::TEXT;
  v_credits_to_apply := COALESCE((p_context->>'credits_to_apply')::INTEGER, 0);
  v_target_execution_date := (p_context->>'target_execution_date')::TIMESTAMPTZ;
  v_experience_id := (p_context->>'experience_id')::UUID;
  v_expires_at := (p_context->>'expires_at')::TIMESTAMPTZ;

  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF v_credits_to_apply < 0 THEN
    RAISE EXCEPTION 'Credits to apply cannot be negative';
  END IF;

  -- Trust the experience's own deadline over anything the client sent.
  IF v_experience_id IS NOT NULL THEN
    SELECT expires_at INTO v_expires_at FROM public.experiences WHERE id = v_experience_id;
  END IF;

  IF v_credits_to_apply > 0 THEN
    SELECT id, balance INTO v_wallet_id, v_wallet_balance
    FROM public.kithly_wallets
    WHERE user_id = p_buyer_id
    FOR UPDATE;

    IF v_wallet_id IS NULL OR v_wallet_balance < v_credits_to_apply THEN
      RAISE EXCEPTION 'Insufficient wallet balance for applying credits';
    END IF;
  END IF;

  -- Vendor shape only; item-level checks happen once per item below.
  FOR v_vendor IN SELECT * FROM jsonb_array_elements(p_vendors) LOOP
    v_item_ids := v_vendor->'item_ids';
    IF v_item_ids IS NULL OR jsonb_array_length(v_item_ids) = 0 THEN
      RAISE EXCEPTION 'Vendor group has no items';
    END IF;
  END LOOP;

  -- Validate, price and reserve, once per distinct item. Rows are locked in a
  -- deterministic id order so concurrent checkouts cannot deadlock.
  FOR v_stock IN
    SELECT e.value::UUID AS item_id, count(*)::INTEGER AS qty
    FROM jsonb_array_elements(p_vendors) AS v,
         jsonb_array_elements_text(v->'item_ids') AS e(value)
    GROUP BY e.value
    ORDER BY 1
  LOOP
    SELECT price_zmw, stock_quantity, name, is_available
      INTO v_price, v_on_hand, v_item_name, v_available
    FROM public.items
    WHERE id = v_stock.item_id
    FOR UPDATE;

    IF v_price IS NULL OR v_available IS FALSE THEN
      RAISE EXCEPTION 'Item % is invalid or unavailable', v_stock.item_id;
    END IF;

    -- Quantity break, decided from the total of this item across the order.
    v_price := public.unit_price_for(v_stock.item_id, v_stock.qty);
    v_unit_prices := v_unit_prices || jsonb_build_object(v_stock.item_id::text, v_price);
    v_grand_total := v_grand_total + (v_price * v_stock.qty);

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

  v_platform_fee := round(v_grand_total * public.buyer_fee_percent_for(p_origin_type) / 100.0)::integer;
  v_gross_payable := v_grand_total + v_platform_fee;

  IF v_credits_to_apply > v_gross_payable THEN
    RAISE EXCEPTION 'Credits to apply cannot exceed the amount payable';
  END IF;

  v_cash_payable := v_gross_payable - v_credits_to_apply;

  IF v_cash_payable = 0 THEN
    v_tx_status := 'SUCCESS';
    v_order_claim_status := 'PENDING';
  END IF;

  INSERT INTO public.transactions (
    buyer_id, total_amount, origin_type, status, gateway_tx_ref, sender_phone,
    platform_fee, items_subtotal
  )
  VALUES (
    p_buyer_id, v_cash_payable, p_origin_type, v_tx_status, p_gateway_tx_ref, v_sender_phone,
    v_platform_fee, v_grand_total
  )
  RETURNING transaction_id INTO v_transaction_id;

  IF v_credits_to_apply > 0 THEN
    INSERT INTO public.wallet_ledger (wallet_id, amount, transaction_id, description)
    VALUES (v_wallet_id, -v_credits_to_apply, v_transaction_id, 'Wallet credits applied to your order');
  END IF;

  FOR v_vendor IN SELECT * FROM jsonb_array_elements(p_vendors) LOOP
    v_shop_id := (v_vendor->>'shop_id')::UUID;
    v_subtotal := 0;
    v_item_ids := v_vendor->'item_ids';
    v_claim_code := public.gen_claim_code(8);

    -- Prices come from the map so a line can never be billed at a different
    -- rate than the one the basket total was built from.
    FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
      v_item_id := v_item_ids->>i;
      v_subtotal := v_subtotal + (v_unit_prices->>v_item_id)::INTEGER;
    END LOOP;

    INSERT INTO public.shop_orders (
      transaction_id, shop_id, claim_code, claim_status, subtotal,
      recipient_name, recipient_phone, message, target_execution_date,
      experience_id, expires_at
    )
    VALUES (
      v_transaction_id, v_shop_id, v_claim_code, v_order_claim_status, v_subtotal,
      v_recipient_name, v_recipient_phone, v_message, v_target_execution_date,
      v_experience_id, v_expires_at
    )
    RETURNING shop_order_id INTO v_shop_order_id;

    FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
      v_item_id := v_item_ids->>i;
      INSERT INTO public.order_items (shop_order_id, item_id, allocated_price)
      VALUES (v_shop_order_id, v_item_id::UUID, (v_unit_prices->>v_item_id)::INTEGER);
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
$function$;

-- ---------------------------------------------------------------------------
-- Retire the twelve-argument signature.
--
-- Dropped after the new one exists, so there is no window where a caller finds
-- neither. checkout-init passes named arguments, so it resolves by name and is
-- updated in the same change.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.checkout_init_atomic(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Grants for the new signature, which inherited none.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, JSONB)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_count INT;
  v_args  TEXT;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'checkout_init_atomic';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one checkout_init_atomic, found %', v_count;
  END IF;

  SELECT pg_get_function_identity_arguments(oid) INTO v_args
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'checkout_init_atomic';

  IF v_args <> 'p_buyer_id uuid, p_origin_type text, p_gateway_tx_ref text, p_vendors jsonb, p_context jsonb' THEN
    RAISE EXCEPTION 'Unexpected signature after the collapse: %', v_args;
  END IF;

  IF has_function_privilege('anon', 'public.checkout_init_atomic(uuid,text,text,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.checkout_init_atomic(uuid,text,text,jsonb,jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'the new checkout_init_atomic is reachable by anon or authenticated';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.checkout_init_atomic(uuid,text,text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute checkout_init_atomic';
  END IF;

  RAISE NOTICE 'checkout_init_atomic: 5 params, context is a closed set, service_role only';
END $verify$;
