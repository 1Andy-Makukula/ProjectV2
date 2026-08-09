-- =============================================================================
-- Quote against the total checkout will actually compute
--
-- THE TRAP THIS AVOIDS
-- --------------------
-- checkout-init reprices a cart in TypeScript from items.price_zmw.
-- checkout_init_atomic reprices it again in SQL, but through unit_price_for,
-- which applies wholesale quantity breaks. For a basket that crosses a price
-- tier those two totals DISAGREE.
--
-- That difference is harmless today, because the edge function's figure is only
-- logged and the database's is what gets charged. It stops being harmless the
-- moment a quote is bound to a total: fx_quotes is deliberately anti-swap, so a
-- quote issued for the TypeScript total would be rejected at checkout when the
-- SQL total came out lower. The buyer would see "your quote expired or does not
-- match this order" on a perfectly ordinary tiered basket, and the cause would
-- be invisible.
--
-- So the quote is priced by the database, by the same rule that will charge it.
--
-- WHY THIS IS A SEPARATE FUNCTION
-- -------------------------------
-- price_basket_zmw is the resolver that D2 anticipated, arriving because a
-- second caller genuinely needs the same answer rather than because a plan said
-- to extract one. checkout_init_atomic still prices inline: its loop also
-- reserves stock and locks item rows in a deterministic order, and pulling
-- pricing out of it without pulling those out too would leave the reservation
-- reading a different price than the total was built from. Adopting this there
-- is a real change with real risk and belongs on its own.
--
-- Until then the two implementations must agree, so they are tested against
-- each other rather than trusted -- see the tiered-basket case in the
-- integration suite.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.price_basket_zmw(p_vendors JSONB)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row   RECORD;
  v_price INTEGER;
  v_total INTEGER := 0;
BEGIN
  IF p_vendors IS NULL OR jsonb_array_length(p_vendors) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- Aggregated per item across the whole basket, exactly as
  -- checkout_init_atomic does, because a quantity break is decided on the total
  -- quantity of an item in the order rather than per vendor group. Splitting
  -- the same item across two shops must not lose the break.
  FOR v_row IN
    SELECT e.value::UUID AS item_id, count(*)::INTEGER AS qty
    FROM jsonb_array_elements(p_vendors) AS v,
         jsonb_array_elements_text(v->'item_ids') AS e(value)
    GROUP BY e.value
    ORDER BY 1
  LOOP
    SELECT price_zmw INTO v_price FROM public.items
    WHERE id = v_row.item_id AND is_available IS NOT FALSE;

    IF v_price IS NULL THEN
      RAISE EXCEPTION 'Item % is invalid or unavailable', v_row.item_id;
    END IF;

    v_price := public.unit_price_for(v_row.item_id, v_row.qty);
    v_total := v_total + (v_price * v_row.qty);
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.price_basket_zmw(JSONB) IS
  'Basket total in ngwee, with wholesale quantity breaks applied. Must agree '
  'with the inline pricing in checkout_init_atomic -- a quote bound to a '
  'different total is rejected at checkout as a mismatch, on an ordinary tiered '
  'basket, with no visible cause.';

-- ---------------------------------------------------------------------------
-- Issue a quote for a basket, rather than for a number the caller supplied.
--
-- The client never states what its cart is worth. It says what is in the cart;
-- the database decides what that costs and quotes against that. A client that
-- understated the total would otherwise get a cheap quote -- and while
-- consume_fx_quote would catch it at checkout, the failure would surface as a
-- confusing rejection rather than never happening.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_fx_quote_for_basket(
  p_buyer_id        UUID,
  p_target_currency TEXT,
  p_vendors         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_basket INTEGER;
BEGIN
  v_basket := public.price_basket_zmw(p_vendors);
  RETURN public.issue_fx_quote(p_buyer_id, p_target_currency, v_basket);
END;
$$;

-- ---------------------------------------------------------------------------
-- The fallback, also priced from the basket rather than from a claim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_estimate_for_basket(
  p_target_currency TEXT,
  p_vendors         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_basket INTEGER;
  v_fee    NUMERIC;
  v_total  INTEGER;
BEGIN
  v_basket := public.price_basket_zmw(p_vendors);

  SELECT international_buyer_fee_percent INTO v_fee
  FROM public.platform_settings WHERE id = 1;

  -- The same fee the native path charges. A diaspora buyer is buying the same
  -- service either way; only who performs the currency conversion differs.
  v_total := v_basket + round(v_basket * v_fee / 100.0)::INTEGER;

  RETURN public.fx_estimate_local_cost(p_target_currency, v_total)
         || jsonb_build_object('basket_zmw_minor', v_basket,
                               'platform_fee_minor', v_total - v_basket);
END;
$$;

REVOKE ALL ON FUNCTION public.price_basket_zmw(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.price_basket_zmw(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.issue_fx_quote_for_basket(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_fx_quote_for_basket(UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.fx_estimate_for_basket(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_estimate_for_basket(TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- Verify the two pricing implementations agree on a tiered basket.
--
-- This is the failure this migration exists to prevent, so it is proved rather
-- than asserted: build an item with a quantity break, price it both ways, and
-- require the same answer.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user   UUID := gen_random_uuid();
  v_shop   UUID := gen_random_uuid();
  v_item   UUID := gen_random_uuid();
  v_vendors JSONB;
  v_priced INTEGER;
  v_checkout JSONB;
  v_txn_total INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'tierprobe-'||v_user::text||'@example.test','',now(),now());
  INSERT INTO public.shops (id, name, owner_id, is_active) VALUES (v_shop,'Tier Probe',v_user,true);
  INSERT INTO public.merchant_shops (user_id, shop_id) VALUES (v_user, v_shop);
  INSERT INTO public.items (id, shop_id, name, price_zmw, is_available)
  VALUES (v_item, v_shop, 'Tier Probe Item', 1000, true);

  -- 10 or more drops the unit price from 1000 to 800.
  INSERT INTO public.item_price_tiers (item_id, min_quantity, unit_price_zmw)
  VALUES (v_item, 10, 800);

  SELECT jsonb_build_array(jsonb_build_object(
           'shop_id', v_shop,
           'item_ids', (SELECT jsonb_agg(v_item) FROM generate_series(1,10))
         )) INTO v_vendors;

  v_priced := public.price_basket_zmw(v_vendors);

  -- Recipient details supplied explicitly. shop_orders.recipient_name is
  -- NOT NULL in production while the migration chain produces it nullable, so
  -- an empty context applies cleanly here and fails there. Passing them makes
  -- the probe independent of which of the two a database happens to be.
  v_checkout := public.checkout_init_atomic(
    v_user, 'LOCAL', 'tier-probe-'||gen_random_uuid()::text, v_vendors,
    jsonb_build_object('recipient_name', 'Tier Probe', 'recipient_phone', '+260970000000')
  );
  v_txn_total := (v_checkout->>'items_subtotal')::INTEGER;

  IF v_priced <> v_txn_total THEN
    RAISE EXCEPTION
      'pricing implementations disagree on a tiered basket: price_basket_zmw=% checkout=%',
      v_priced, v_txn_total;
  END IF;

  IF v_priced <> 8000 THEN
    RAISE EXCEPTION 'expected 10 x 800 = 8000 ngwee with the break applied, got %', v_priced;
  END IF;

  RAISE NOTICE 'pricing agrees on a tiered basket: % ngwee (break applied)', v_priced;

  -- The transaction and its children cannot be removed (append-only events),
  -- so this probe deliberately leaves them; it runs against a disposable
  -- database in CI and a live one only once, at migration time.
END $$;
