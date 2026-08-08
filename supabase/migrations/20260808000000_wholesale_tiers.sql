-- =============================================================================
-- Quantity-break pricing — replacing the wholesale fields that were never applied
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- items.is_wholesale / wholesale_price_zmw / minimum_order_quantity were
-- captured by the admin form and rendered to buyers as "ZMW X per unit on
-- orders of N or more", but no pricing code read them. checkout_init_atomic
-- charged price_zmw for every unit. The platform advertised a discount and
-- then did not honour it, which is why the UI was hidden pending this.
--
-- ---------------------------------------------------------------------------
-- The model
-- ---------------------------------------------------------------------------
-- Tiers, not a single wholesale rate, so a shop can price 6 / 12 / 24 packs
-- differently. A tier is a floor: buy at least `min_quantity` and *every* unit
-- drops to `unit_price_zmw`. Where several tiers qualify the buyer gets the
-- cheapest, so adding tiers can never accidentally cost them more.
--
-- The break is applied against the quantity of that item across the whole
-- order. checkout-init expresses quantity by repeating an item id, and Phase 4
-- already added a pass to checkout_init_atomic that aggregates those repeats
-- for the stock decrement — pricing now rides on the same aggregation, so the
-- unit price is decided once per item rather than per occurrence.
--
-- ---------------------------------------------------------------------------
-- The old columns stay
-- ---------------------------------------------------------------------------
-- is_wholesale, wholesale_price_zmw and minimum_order_quantity are backfilled
-- into tiers and then left alone rather than dropped. They are referenced by
-- the generated database types and by admin form state, and dropping them is a
-- separate, riskier change than making pricing correct.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tiers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_price_tiers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  min_quantity   integer NOT NULL,
  unit_price_zmw integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- A "break" at one unit is just the price, so the lowest meaningful tier is 2.
  CONSTRAINT item_price_tiers_min_quantity_check CHECK (min_quantity >= 2),
  CONSTRAINT item_price_tiers_price_check CHECK (unit_price_zmw > 0)
);

COMMENT ON TABLE public.item_price_tiers IS
  'Quantity breaks. Buying min_quantity or more prices every unit at unit_price_zmw. Applied server-side in checkout_init_atomic.';

CREATE UNIQUE INDEX IF NOT EXISTS item_price_tiers_item_qty_idx
  ON public.item_price_tiers (item_id, min_quantity);

-- ---------------------------------------------------------------------------
-- 2. A tier must actually be a discount
--
-- Cannot be a CHECK: the comparison is against a column on another table. A
-- tier at or above the base price would be a display bug at best and would
-- silently overcharge if the MIN() below ever picked it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_price_tier()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_base integer;
BEGIN
  SELECT price_zmw INTO v_base FROM public.items WHERE id = NEW.item_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Item % not found', NEW.item_id;
  END IF;

  IF NEW.unit_price_zmw >= v_base THEN
    RAISE EXCEPTION 'A bulk price (%) must be below the unit price (%)',
      NEW.unit_price_zmw, v_base;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS item_price_tiers_validate ON public.item_price_tiers;
CREATE TRIGGER item_price_tiers_validate
  BEFORE INSERT OR UPDATE ON public.item_price_tiers
  FOR EACH ROW EXECUTE FUNCTION public.validate_price_tier();

-- ---------------------------------------------------------------------------
-- 3. Row level security — mirrors item_images, which hangs off items the same way
-- ---------------------------------------------------------------------------
ALTER TABLE public.item_price_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_price_tiers_public_read ON public.item_price_tiers;
CREATE POLICY item_price_tiers_public_read ON public.item_price_tiers
  FOR SELECT USING (true);

DROP POLICY IF EXISTS item_price_tiers_admin_write ON public.item_price_tiers;
CREATE POLICY item_price_tiers_admin_write ON public.item_price_tiers
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS item_price_tiers_merchant_write ON public.item_price_tiers;
CREATE POLICY item_price_tiers_merchant_write ON public.item_price_tiers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.items i
      JOIN public.merchant_shops ms ON ms.shop_id = i.shop_id
      JOIN public.shops s ON s.id = ms.shop_id
      WHERE i.id = item_price_tiers.item_id
        AND ms.user_id = auth.uid()
        AND s.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.items i
      JOIN public.merchant_shops ms ON ms.shop_id = i.shop_id
      JOIN public.shops s ON s.id = ms.shop_id
      WHERE i.id = item_price_tiers.item_id
        AND ms.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ---------------------------------------------------------------------------
-- 4. The price of one unit at a given quantity
--
-- Single source of truth: checkout calls it, and the storefront calls it to
-- show what a break would cost. Falls back to the base price when nothing
-- qualifies, so it is safe to call for any item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unit_price_for(p_item_id uuid, p_quantity integer)
RETURNS integer
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT MIN(t.unit_price_zmw)
      FROM public.item_price_tiers t
      WHERE t.item_id = p_item_id
        AND t.min_quantity <= GREATEST(COALESCE(p_quantity, 1), 1)
    ),
    (SELECT price_zmw FROM public.items WHERE id = p_item_id)
  )
$$;

REVOKE ALL ON FUNCTION public.unit_price_for(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unit_price_for(uuid, integer) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Backfill the single wholesale rate as one tier
--
-- Only where the data is coherent: flagged wholesale, a price present, and that
-- price genuinely below the base — otherwise the validation trigger would
-- reject it and take the whole migration with it.
-- ---------------------------------------------------------------------------
INSERT INTO public.item_price_tiers (item_id, min_quantity, unit_price_zmw)
SELECT i.id, GREATEST(COALESCE(i.minimum_order_quantity, 2), 2), i.wholesale_price_zmw
FROM public.items i
WHERE i.is_wholesale IS TRUE
  AND i.wholesale_price_zmw IS NOT NULL
  AND i.wholesale_price_zmw > 0
  AND i.wholesale_price_zmw < i.price_zmw
  AND NOT EXISTS (
    SELECT 1 FROM public.item_price_tiers t WHERE t.item_id = i.id
  );

-- ---------------------------------------------------------------------------
-- 6. checkout_init_atomic — price the break server-side
--
-- Same signature. The change is that the per-item aggregation pass introduced
-- for stock now also decides the unit price, and both the basket total and the
-- per-line allocated_price read from that decision instead of re-reading
-- price_zmw per occurrence.
--
-- The old first pass validated availability once per *occurrence* and summed as
-- it went; that work now happens once per item inside the aggregation, so the
-- same guards run with fewer reads. Vendor-shape validation is kept separate
-- because it must still reject an empty vendor group.
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
  -- item_id -> unit price actually charged, after any quantity break.
  v_unit_prices JSONB := '{}'::JSONB;
BEGIN
  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF p_credits_to_apply < 0 THEN
    RAISE EXCEPTION 'Credits to apply cannot be negative';
  END IF;

  -- Trust the experience's own deadline over anything the client sent.
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
      p_recipient_name, p_recipient_phone, p_message, p_target_execution_date,
      p_experience_id, v_expires_at
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
$$;

GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ
) TO authenticated, service_role;
