-- =============================================================================
-- Checkout spends an FX quote
--
-- The FX machine now exists end to end -- rates pull hourly, quotes issue with
-- the spread in the right direction, charges record their currency, the payment
-- gate accepts them -- but nothing connected checkout to any of it. A quote
-- could be issued and then ignored.
--
-- THE SEAM DOING ITS JOB
-- ----------------------
-- This is the first vertical added since checkout_init_atomic was collapsed to
-- five parameters (ADR 0001), and it is worth noting what did NOT happen: the
-- signature is untouched. `fx_quote_id` is a new key in p_context. Under the
-- old shape this would have been the thirteenth positional parameter and a
-- tenth full reproduction of the function body.
--
-- The closed-set check means adding the key is a deliberate act in two places
-- -- the membership test and the error that names offenders -- because a
-- validation list that drifts from its error message tells people the wrong
-- thing when it fires.
--
-- WHY CONSUMPTION HAPPENS HERE
-- ----------------------------
-- Inside the same transaction as the order it pays for. A checkout that rolls
-- back must not leave a quote burned, and a quote that cannot be spent --
-- expired, already used, issued for a different basket -- must take the order
-- down with it rather than silently falling back to charging kwacha to someone
-- who was shown a price in sterling.
--
-- The basket comparison uses v_gross_payable, the server's own figure. Nothing
-- the client sent takes part in deciding whether the quote matches the order.
--
-- Body carried over from the live definition via pg_get_functiondef; four
-- targeted edits with their anchors asserted, and nothing else moved.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.checkout_init_atomic(p_buyer_id uuid, p_origin_type text, p_gateway_tx_ref text, p_vendors jsonb, p_context jsonb DEFAULT '{}'::jsonb)
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
  v_fx_quote_id UUID;
  v_fx JSONB;

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
      WHERE k NOT IN ('recipient_name', 'recipient_phone', 'message', 'sender_phone', 'credits_to_apply', 'target_execution_date', 'experience_id', 'expires_at', 'fx_quote_id')
    ) THEN
      RAISE EXCEPTION 'Unknown key(s) in p_context: %', (
        SELECT string_agg(k, ', ' ORDER BY k)
        FROM jsonb_object_keys(p_context) AS k
        WHERE k NOT IN ('recipient_name', 'recipient_phone', 'message', 'sender_phone', 'credits_to_apply', 'target_execution_date', 'experience_id', 'expires_at', 'fx_quote_id')
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
  v_fx_quote_id := (p_context->>'fx_quote_id')::UUID;

  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- Wallet credits and an FX quote are not combinable, and this refuses rather
  -- than picking a behaviour.
  --
  -- The quote is issued against basket + fee in kwacha. Applying credits after
  -- the fact changes what is owed but not what was quoted, so the buyer would
  -- be charged a sterling figure that no longer corresponds to anything. The
  -- honest options are to re-quote after credits or to disallow the pair; until
  -- a diaspora buyer with wallet credits actually exists, guessing which is a
  -- decision made on no evidence.
  IF v_fx_quote_id IS NOT NULL AND v_credits_to_apply > 0 THEN
    RAISE EXCEPTION 'Wallet credits cannot be applied to a currency-quoted order';
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

  -- Spend the quote against this transaction, in the same transaction, so a
  -- checkout that rolls back does not leave a quote burned -- and a quote that
  -- cannot be spent takes the order down with it rather than silently falling
  -- back to charging kwacha.
  --
  -- v_gross_payable is the server's own basket + fee. consume_fx_quote compares
  -- it against what the quote was issued for, so a quote raised on a small
  -- basket cannot be redirected at a large one. Nothing the client sent is
  -- involved in that comparison.
  IF v_fx_quote_id IS NOT NULL THEN
    v_fx := public.consume_fx_quote(
      v_fx_quote_id, p_buyer_id, v_transaction_id, v_gross_payable
    );

    UPDATE public.transactions
    SET charge_currency     = v_fx->>'target_currency',
        charge_amount_minor = (v_fx->>'quoted_amount_minor')::INTEGER,
        fx_rate_applied     = (v_fx->>'applied_rate')::NUMERIC,
        fx_quote_id         = v_fx_quote_id
    WHERE transaction_id = v_transaction_id;
  END IF;

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
-- Grants restated. The signature is unchanged so the ACL carried over, but
-- stating it keeps the guarantee if this file is ever replayed alone.
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
  v_args TEXT;
  v_src  TEXT;
BEGIN
  SELECT pg_get_function_identity_arguments(oid), prosrc INTO v_args, v_src
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'checkout_init_atomic';

  -- The whole point of ADR 0001: a new vertical must not move the signature.
  IF v_args <> 'p_buyer_id uuid, p_origin_type text, p_gateway_tx_ref text, p_vendors jsonb, p_context jsonb' THEN
    RAISE EXCEPTION 'checkout_init_atomic signature changed: %', v_args;
  END IF;

  IF v_src NOT LIKE '%consume_fx_quote%' THEN
    RAISE EXCEPTION 'checkout_init_atomic does not consume a quote';
  END IF;

  -- Both copies of the allowed-key list must have moved, or the error message
  -- names a set the code does not enforce.
  IF (length(v_src) - length(replace(v_src, '''fx_quote_id''', ''))) / 13 < 3 THEN
    RAISE EXCEPTION 'fx_quote_id was not added to both allowed-key lists and the unpack';
  END IF;

  IF has_function_privilege('anon', 'public.checkout_init_atomic(uuid,text,text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'checkout_init_atomic is reachable by anon';
  END IF;

  RAISE NOTICE 'checkout consumes fx quotes; signature unchanged (ADR 0001 holds)';
END $verify$;
