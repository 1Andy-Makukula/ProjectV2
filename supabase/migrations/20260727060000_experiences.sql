-- =============================================================================
-- Phase 5 — Experiences
--
-- A curated set of items sold as one thing: a spa afternoon, a birthday
-- package, a date night. The items may come from different shops, which is the
-- point — the platform assembles something no single merchant sells.
--
-- Naming: these are "experiences", not "bundles". In this codebase a bundle
-- already means the set of items under one claim code at the fulfilment
-- terminal (the Smart Bundle Protocol in CashierVerificationTerminal), and
-- reusing the word for a second concept would make merchant-facing language
-- ambiguous.
--
-- Purchase deliberately adds no payment logic. Buying an experience adds its
-- items to the cart and goes through the existing checkout, which already
-- groups a cart by shop and issues one claim code per shop. A three-shop
-- experience therefore produces three claim codes, one per merchant, each
-- fulfilled and settled exactly as any other order.
--
-- What an experience does add is a shared deadline: every order created from
-- it expires on the same date, regardless of the individual items' own clocks.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Experiences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.experiences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  tagline         text,
  description     text,
  image_url       text,
  is_active       boolean NOT NULL DEFAULT false,
  is_featured     boolean NOT NULL DEFAULT false,

  -- The shared deadline. An absolute date suits how these are sold: "redeem
  -- your Valentine's package by 28 February", not "within 60 days of buying".
  expires_at      timestamptz,

  sort_order      integer NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT experiences_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT experiences_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE INDEX IF NOT EXISTS experiences_active_idx
  ON public.experiences (sort_order, created_at DESC)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 2. What is in one
--
-- Items are referenced, not copied. An experience always reflects the shop's
-- current price, so a merchant repricing does not leave a stale figure on a
-- curated listing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.experience_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experience_id uuid NOT NULL REFERENCES public.experiences(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantity      integer NOT NULL DEFAULT 1,
  note          text,
  sort_order    integer NOT NULL DEFAULT 0,

  CONSTRAINT experience_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT experience_items_unique UNIQUE (experience_id, item_id)
);

CREATE INDEX IF NOT EXISTS experience_items_experience_idx
  ON public.experience_items (experience_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. Order provenance and the shared deadline
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS experience_id uuid;
COMMENT ON COLUMN public.shop_orders.experience_id IS
  'Set when this order came from an experience. One experience purchase yields one order per participating shop.';

ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS expires_at timestamptz;
COMMENT ON COLUMN public.shop_orders.expires_at IS
  'Absolute expiry that overrides the per-item clock. Set from an experience so every part of it lapses together.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_experience_id_fkey') THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_experience_id_fkey
      FOREIGN KEY (experience_id) REFERENCES public.experiences(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Pricing
--
-- The total is derived from the items rather than stored, so a curated listing
-- can never quote a price the checkout would not honour. checkout_init_atomic
-- prices every line from `items` at purchase time; storing a separate figure
-- here would create exactly the drift this avoids.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.experience_total(p_experience_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(ei.quantity * i.price_zmw), 0)::integer
  FROM public.experience_items ei
  JOIN public.items i ON i.id = ei.item_id
  WHERE ei.experience_id = p_experience_id
$$;

/** True when every item in the experience is still purchasable. */
CREATE OR REPLACE FUNCTION public.experience_is_available(p_experience_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.experience_items WHERE experience_id = p_experience_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.experience_items ei
       JOIN public.items i ON i.id = ei.item_id
       WHERE ei.experience_id = p_experience_id
         AND (i.is_available IS FALSE OR i.is_quote_only = true)
     )
$$;

-- ---------------------------------------------------------------------------
-- 5. Access
-- ---------------------------------------------------------------------------
ALTER TABLE public.experiences      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS experiences_public_read ON public.experiences;
CREATE POLICY experiences_public_read ON public.experiences
  FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.current_user_role() = 'admin');

DROP POLICY IF EXISTS experiences_admin_write ON public.experiences;
CREATE POLICY experiences_admin_write ON public.experiences
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS experience_items_public_read ON public.experience_items;
CREATE POLICY experience_items_public_read ON public.experience_items
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.experiences e
      WHERE e.id = experience_items.experience_id
        AND (e.is_active = true OR public.current_user_role() = 'admin')
    )
  );

DROP POLICY IF EXISTS experience_items_admin_write ON public.experience_items;
CREATE POLICY experience_items_admin_write ON public.experience_items
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 6. Curation
--
-- One RPC replaces the whole contents so the admin builder can save a list in
-- a single call without a delete-then-insert window where the experience is
-- momentarily empty.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_experience_items(
  p_experience_id uuid,
  p_items         jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_item_id uuid;
  v_qty integer;
  v_count integer := 0;
  i integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may curate experiences';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.experiences WHERE id = p_experience_id) THEN
    RAISE EXCEPTION 'Experience not found';
  END IF;

  DELETE FROM public.experience_items WHERE experience_id = p_experience_id;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;

  FOR i IN 0..jsonb_array_length(p_items) - 1 LOOP
    v_line := p_items->i;
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty := COALESCE((v_line->>'quantity')::integer, 1);

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Every line needs an item';
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be at least 1';
    END IF;

    -- A quote item belongs to the conversation that produced it and cannot be
    -- resold inside a curated listing.
    IF EXISTS (SELECT 1 FROM public.items WHERE id = v_item_id AND is_quote_only = true) THEN
      RAISE EXCEPTION 'Custom quote items cannot be added to an experience';
    END IF;

    INSERT INTO public.experience_items (experience_id, item_id, quantity, note, sort_order)
    VALUES (p_experience_id, v_item_id, v_qty, nullif(btrim(coalesce(v_line->>'note','')), ''), i)
    ON CONFLICT (experience_id, item_id)
    DO UPDATE SET quantity = excluded.quantity,
                  note = excluded.note,
                  sort_order = excluded.sort_order;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.experiences SET updated_at = now() WHERE id = p_experience_id;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. The shared deadline wins over the per-item clock
--
-- Rewritten from Phase 4b with one change: shop_orders.expires_at, when set,
-- takes precedence. Everything else is identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_expired_vouchers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_refund_percent integer;
  v_sender_refund integer;
  v_merchant_credit integer;
  v_count integer := 0;
  v_owner_id uuid;
BEGIN
  SELECT COALESCE(expiry_sender_refund_percent, 80) INTO v_refund_percent
  FROM public.platform_settings WHERE id = 1;
  v_refund_percent := COALESCE(v_refund_percent, 80);

  FOR v_item IN
    SELECT oi.order_item_id,
           oi.allocated_price,
           oi.shop_order_id,
           so.transaction_id,
           so.shop_id,
           so.claim_code,
           t.buyer_id
    FROM public.order_items oi
    JOIN public.shop_orders so ON oi.shop_order_id = so.shop_order_id
    JOIN public.transactions t ON so.transaction_id = t.transaction_id
    JOIN public.items it ON it.id = oi.item_id
    WHERE oi.fulfillment_status IN ('PENDING', 'FLOATING')
      AND so.claim_status NOT IN ('REDEEMED', 'CANCELLED', 'EXPIRED')
      AND so.settled IS NOT TRUE
      AND so.disputed_at IS NULL
      AND COALESCE(it.has_expiry, true)
      AND COALESCE(
            so.expires_at,
            public.voucher_expiry_at(
              oi.created_at, so.target_execution_date, it.requires_scheduling, it.valid_for_days
            )
          ) <= now()
    ORDER BY oi.created_at
    LIMIT 1000
    FOR UPDATE OF oi
  LOOP
    v_sender_refund := floor(v_item.allocated_price * v_refund_percent / 100.0)::integer;
    v_merchant_credit := v_item.allocated_price - v_sender_refund;

    UPDATE public.order_items
    SET fulfillment_status = 'EXPIRED', fulfilled_at = now()
    WHERE order_item_id = v_item.order_item_id;

    IF v_sender_refund > 0 THEN
      PERFORM public.increment_wallet_balance(
        v_item.buyer_id, v_sender_refund,
        'REFUND_EXPIRY:' || v_item.order_item_id, v_item.shop_order_id);
    END IF;

    IF v_merchant_credit > 0 THEN
      PERFORM public.increment_merchant_balance(v_item.shop_id, v_merchant_credit);

      INSERT INTO public.payout_ledger
        (shop_order_id, shop_id, amount, commission, status, ledger_type, credit_amount)
      VALUES
        (v_item.shop_order_id, v_item.shop_id, v_merchant_credit, 0,
         'pending_withdrawal', 'EXPIRY_CREDIT', v_merchant_credit);
    END IF;

    INSERT INTO public.transaction_events (transaction_id, event_type, payload)
    VALUES (
      v_item.transaction_id, 'AUTO_EXPIRED',
      jsonb_build_object(
        'order_item_id', v_item.order_item_id,
        'allocated_price', v_item.allocated_price,
        'buyer_id', v_item.buyer_id,
        'sender_refund', v_sender_refund,
        'merchant_credit', v_merchant_credit,
        'refund_percent', v_refund_percent
      ));

    PERFORM public.create_notification(
      v_item.buyer_id,
      'Gift ' || COALESCE(v_item.claim_code, '') || ' went uncollected and has expired. '
        || v_refund_percent::text || '% of its value is back in your wallet.',
      'warning', v_item.shop_order_id::text);

    SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_item.shop_id;
    IF v_merchant_credit > 0 AND v_owner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_owner_id,
        'Gift ' || COALESCE(v_item.claim_code, '') || ' expired uncollected. '
          || 'A partial credit has been added to your balance.',
        'info', v_item.shop_order_id::text);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. checkout_init_atomic — records where an order came from
--
-- Two more optional parameters. Everything else is the Phase 4b definition.
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
    'items_subtotal', v_grand_total,
    'platform_fee', v_platform_fee,
    'shop_orders', v_shop_orders
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ
) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.checkout_init_atomic(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ);

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_experience_items(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.experience_total(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.experience_is_available(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_experience_items(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.experience_total(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.experience_is_available(uuid) TO anon, authenticated, service_role;
