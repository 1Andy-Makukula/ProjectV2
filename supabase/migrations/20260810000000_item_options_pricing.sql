-- =============================================================================
-- Item options: wire the dormant schema into pricing
--
-- 20260808030000 created item_option_groups and item_options and stopped there.
-- Nothing read them: no picker, no cart, no checkout. Defining "6 plates, +K30"
-- changed nothing about what anyone paid.
--
-- ---------------------------------------------------------------------------
-- The selection travels per unit, and is priced by the server
-- ---------------------------------------------------------------------------
-- checkout-init already expresses quantity by repeating an item id, and
-- checkout_init_atomic loops those occurrences by index. Selections therefore
-- ride alongside as `line_options`, an array aligned index-for-index with
-- item_ids, so two of the same dish with different sides stay distinct without
-- changing the shape of anything that already works.
--
-- The client never sends a price. It sends which options were chosen, and the
-- server resolves what they cost — the same rule the basket total has always
-- followed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. What was ordered, kept with the order
--
-- A snapshot rather than a join: the merchant must still be able to see that a
-- sold order was "6 plates, extra juice" after the option has been renamed or
-- deleted, and the price that was actually charged for it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS selected_options jsonb;

COMMENT ON COLUMN public.order_items.selected_options IS
  'Snapshot of the options chosen for this unit: labels and the delta charged. Kept verbatim so fulfilment stays readable after the option definitions change.';

-- ---------------------------------------------------------------------------
-- 2. Resolve a selection into a price and a readable record
--
-- Returns {"delta": <ngwee>, "detail": [...]}. Raises rather than ignoring
-- anything it does not recognise: a selection naming a group from another item,
-- an option from another group, or a quantity outside the group's own range is
-- a tampered or stale basket, and quietly charging zero for it is how a buyer
-- ends up with something nobody agreed to sell.
--
-- Selection shape, keyed by group id:
--   choice   -> ["<option_id>", ...]
--   quantity -> <integer>
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_item_selection(
  p_item_id   uuid,
  p_selection jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_group     RECORD;
  v_key       text;
  v_value     jsonb;
  v_delta     integer := 0;
  v_detail    jsonb := '[]'::jsonb;
  v_count     integer;
  v_labels    text;
  v_sub       integer;
  v_qty       integer;
BEGIN
  -- Every group the item defines is checked, so a required one that was simply
  -- left out of the payload is caught here rather than at fulfilment.
  FOR v_group IN
    SELECT id, label, kind, is_required, allow_multiple,
           min_value, max_value, unit_price_delta_zmw
    FROM public.item_option_groups
    WHERE item_id = p_item_id
    ORDER BY sort_order, created_at
  LOOP
    v_key := v_group.id::text;
    v_value := CASE WHEN p_selection ? v_key THEN p_selection -> v_key ELSE NULL END;

    IF v_value IS NULL OR v_value = 'null'::jsonb THEN
      IF v_group.is_required THEN
        RAISE EXCEPTION 'Choose an option for "%" before checking out', v_group.label;
      END IF;
      CONTINUE;
    END IF;

    IF v_group.kind = 'choice' THEN
      IF jsonb_typeof(v_value) <> 'array' THEN
        RAISE EXCEPTION 'Selection for "%" must be a list of options', v_group.label;
      END IF;

      SELECT count(*), COALESCE(sum(o.price_delta_zmw), 0), string_agg(o.label, ', ' ORDER BY o.sort_order)
        INTO v_count, v_sub, v_labels
      FROM public.item_options o
      WHERE o.group_id = v_group.id
        AND o.is_available
        AND o.id::text IN (SELECT jsonb_array_elements_text(v_value));

      -- A mismatch means an id that is not an available option of this group.
      IF v_count <> jsonb_array_length(v_value) THEN
        RAISE EXCEPTION 'An option chosen for "%" is no longer available', v_group.label;
      END IF;

      IF v_count = 0 THEN
        IF v_group.is_required THEN
          RAISE EXCEPTION 'Choose an option for "%" before checking out', v_group.label;
        END IF;
        CONTINUE;
      END IF;

      IF NOT v_group.allow_multiple AND v_count > 1 THEN
        RAISE EXCEPTION 'Only one option can be chosen for "%"', v_group.label;
      END IF;

      v_delta := v_delta + v_sub;
      v_detail := v_detail || jsonb_build_object(
        'group', v_group.label, 'value', v_labels, 'delta', v_sub);

    ELSE
      IF jsonb_typeof(v_value) <> 'number' THEN
        RAISE EXCEPTION 'Selection for "%" must be a number', v_group.label;
      END IF;

      v_qty := (v_value #>> '{}')::integer;

      IF v_qty < COALESCE(v_group.min_value, 0)
         OR (v_group.max_value IS NOT NULL AND v_qty > v_group.max_value) THEN
        RAISE EXCEPTION '"%" must be between % and %',
          v_group.label, COALESCE(v_group.min_value, 0), COALESCE(v_group.max_value, v_qty);
      END IF;

      v_sub := v_qty * v_group.unit_price_delta_zmw;
      v_delta := v_delta + v_sub;
      v_detail := v_detail || jsonb_build_object(
        'group', v_group.label, 'value', v_qty::text, 'delta', v_sub);
    END IF;
  END LOOP;

  -- Anything left over names a group this item does not have.
  IF p_selection IS NOT NULL AND jsonb_typeof(p_selection) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(p_selection) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.item_option_groups
        WHERE id::text = v_key AND item_id = p_item_id
      ) THEN
        RAISE EXCEPTION 'Unknown option group % for this item', v_key;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('delta', v_delta, 'detail', v_detail);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_item_selection(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_item_selection(uuid, jsonb) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. checkout_init_atomic — charge for what was chosen
--
-- Unchanged from 20260808000000 except for options. Both vendor loops now walk
-- by index rather than by set, so a line's selection can be keyed as
-- vendor:line and resolved exactly once: resolving twice would let a concurrent
-- edit to an option's price make the basket total disagree with the sum of its
-- own lines.
--
-- Stock and quantity-break tiers are untouched — both count units per item, and
-- an option changes what a unit costs, not how many were taken.
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
  p_target_execution_date TIMESTAMPTZ DEFAULT NULL,
  p_experience_id UUID DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
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
  v_expires_at TIMESTAMPTZ := p_expires_at;

  v_stock RECORD;
  v_on_hand INTEGER;
  v_item_name TEXT;
  v_available BOOLEAN;
  v_unit_prices JSONB := '{}'::JSONB;

  v_vendor_idx INTEGER;
  v_line_key TEXT;
  v_selection JSONB;
  v_resolved JSONB;
  v_line_deltas JSONB := '{}'::JSONB;
  v_line_details JSONB := '{}'::JSONB;
  v_line_delta INTEGER;
BEGIN
  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF p_credits_to_apply < 0 THEN
    RAISE EXCEPTION 'Credits to apply cannot be negative';
  END IF;

  IF p_experience_id IS NOT NULL THEN
    SELECT expires_at INTO v_expires_at FROM public.experiences WHERE id = p_experience_id;
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
    v_item_ids := v_vendor->'item_ids';
    IF v_item_ids IS NULL OR jsonb_array_length(v_item_ids) = 0 THEN
      RAISE EXCEPTION 'Vendor group has no items';
    END IF;
  END LOOP;

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

    v_price := public.unit_price_for(v_stock.item_id, v_stock.qty);
    v_unit_prices := v_unit_prices || jsonb_build_object(v_stock.item_id::text, v_price);
    v_grand_total := v_grand_total + (v_price * v_stock.qty);

    IF v_on_hand IS NOT NULL THEN
      IF v_on_hand < v_stock.qty THEN
        RAISE EXCEPTION 'Only % left of "%" - please reduce the quantity',
          v_on_hand, COALESCE(v_item_name, v_stock.item_id::text);
      END IF;

      UPDATE public.items
      SET stock_quantity = stock_quantity - v_stock.qty
      WHERE id = v_stock.item_id;
    END IF;
  END LOOP;

  -- Options: priced once, per line.
  -- line_options is optional and aligned index-for-index with item_ids, so a
  -- client that has never heard of options keeps working unchanged.
  FOR v_vendor_idx IN 0..jsonb_array_length(p_vendors) - 1 LOOP
    v_vendor := p_vendors->v_vendor_idx;
    v_item_ids := v_vendor->'item_ids';

    FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
      v_selection := v_vendor->'line_options'->i;

      IF v_selection IS NULL OR jsonb_typeof(v_selection) <> 'object' THEN
        v_selection := '{}'::JSONB;
      END IF;

      v_resolved := public.resolve_item_selection((v_item_ids->>i)::UUID, v_selection);
      v_line_delta := (v_resolved->>'delta')::INTEGER;

      v_line_key := v_vendor_idx::text || ':' || i::text;
      v_line_deltas := v_line_deltas || jsonb_build_object(v_line_key, v_line_delta);
      v_line_details := v_line_details || jsonb_build_object(v_line_key, v_resolved->'detail');

      v_grand_total := v_grand_total + v_line_delta;
    END LOOP;
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
    VALUES (v_wallet_id, -p_credits_to_apply, v_transaction_id, 'Wallet credits applied to your order');
  END IF;

  FOR v_vendor_idx IN 0..jsonb_array_length(p_vendors) - 1 LOOP
    v_vendor := p_vendors->v_vendor_idx;
    v_shop_id := (v_vendor->>'shop_id')::UUID;
    v_subtotal := 0;
    v_item_ids := v_vendor->'item_ids';
    v_claim_code := public.gen_claim_code(8);

    FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
      v_item_id := v_item_ids->>i;
      v_line_key := v_vendor_idx::text || ':' || i::text;
      v_subtotal := v_subtotal
                  + (v_unit_prices->>v_item_id)::INTEGER
                  + (v_line_deltas->>v_line_key)::INTEGER;
    END LOOP;

    INSERT INTO public.shop_orders (
      transaction_id, shop_id, claim_code, claim_status, subtotal,
      recipient_name, recipient_phone, message, target_execution_date,
      experience_id, expires_at
    )
    VALUES (
      v_transaction_id, v_shop_id, v_claim_code, v_order_claim_status, v_subtotal,
      p_recipient_name, p_recipient_phone, p_message, p_target_execution_date,
      p_experience_id, v_expires_at
    )
    RETURNING shop_order_id INTO v_shop_order_id;

    FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
      v_item_id := v_item_ids->>i;
      v_line_key := v_vendor_idx::text || ':' || i::text;

      INSERT INTO public.order_items (shop_order_id, item_id, allocated_price, selected_options)
      VALUES (
        v_shop_order_id,
        v_item_id::UUID,
        (v_unit_prices->>v_item_id)::INTEGER + (v_line_deltas->>v_line_key)::INTEGER,
        NULLIF(v_line_details->v_line_key, '[]'::jsonb)
      );
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

GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ
) TO authenticated, service_role;
