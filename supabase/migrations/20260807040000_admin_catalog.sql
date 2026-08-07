-- =============================================================================
-- Phase 5 — Admin-curated catalogue that shops import from
--
-- A library of ready-made listings ("Bag of Cement", "Birthday Setup") an admin
-- maintains centrally, which any verified shop can pull into its own catalogue
-- and then price and edit independently.
--
-- ---------------------------------------------------------------------------
-- Why a sibling table rather than nullable shop_id on items
-- ---------------------------------------------------------------------------
-- Making items.shop_id nullable to hold ownerless templates would reach into
-- items RLS, the cart, checkout, settlement and the expiry sweep — all of which
-- assume every item belongs to a shop. catalog_items is therefore a separate
-- table with no relationship to live commerce at all: nothing reads it at
-- checkout, and `items` is untouched until a shop actually imports something.
--
-- ---------------------------------------------------------------------------
-- Import copies, it does not reference
-- ---------------------------------------------------------------------------
-- Each shop that imports "Bag of Cement" needs to set its own price, edit the
-- description and mark itself out of stock without any of that touching the
-- catalogue entry or the other shops that imported it. So the import writes new
-- `items` and `item_images` rows and then walks away — there is no live link
-- back, by design.
--
-- Image files are copied too, not just their URLs; that happens in the
-- `import-catalog-item` Edge Function, which is the only caller of the RPC
-- below. Sharing a storage object would mean deleting a catalogue entry could
-- blank the picture on every shop that had imported it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalog_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id        uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name               text NOT NULL,
  description        text,
  suggested_price_zmw integer,
  item_type          text NOT NULL DEFAULT 'product',
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT catalog_items_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT catalog_items_item_type_check CHECK (item_type IN ('product', 'service')),
  -- Mirrors items.price_zmw: prices are ngwee integers and never zero.
  CONSTRAINT catalog_items_price_check
    CHECK (suggested_price_zmw IS NULL OR suggested_price_zmw > 0)
);

COMMENT ON TABLE public.catalog_items IS
  'Admin-maintained listing templates. Copied into a shop''s items on import; never read by checkout.';

CREATE TABLE IF NOT EXISTS public.catalog_item_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_item_id uuid NOT NULL REFERENCES public.catalog_items(id) ON DELETE CASCADE,
  image_url       text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT catalog_item_images_sort_order_check CHECK (sort_order BETWEEN 0 AND 4),
  CONSTRAINT catalog_item_images_url_check CHECK (btrim(image_url) <> '')
);

CREATE INDEX IF NOT EXISTS catalog_item_images_item_sort_idx
  ON public.catalog_item_images (catalog_item_id, sort_order);

CREATE INDEX IF NOT EXISTS catalog_items_active_idx
  ON public.catalog_items (is_active, category_id);

-- Same five-image ceiling as item_images, for the same reason.
CREATE OR REPLACE FUNCTION public.enforce_catalog_image_cap()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.catalog_item_images
  WHERE catalog_item_id = NEW.catalog_item_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'A catalogue item may have at most 5 images';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalog_item_images_cap ON public.catalog_item_images;
CREATE TRIGGER catalog_item_images_cap
  BEFORE INSERT ON public.catalog_item_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_catalog_image_cap();

-- ---------------------------------------------------------------------------
-- 2. Row level security
--
-- Any signed-in merchant needs to browse the catalogue to import from it, but
-- only admins may curate it. Unlike items, this is not public: there is no
-- reason for an anonymous visitor to read the template library.
-- ---------------------------------------------------------------------------
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_item_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_items_authenticated_read ON public.catalog_items;
CREATE POLICY catalog_items_authenticated_read ON public.catalog_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalog_items_admin_write ON public.catalog_items;
CREATE POLICY catalog_items_admin_write ON public.catalog_items
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS catalog_item_images_authenticated_read ON public.catalog_item_images;
CREATE POLICY catalog_item_images_authenticated_read ON public.catalog_item_images
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalog_item_images_admin_write ON public.catalog_item_images;
CREATE POLICY catalog_item_images_admin_write ON public.catalog_item_images
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 3. import_catalog_item_to_shop
--
-- Writes the copy in one transaction so a shop can never end up with an item
-- row whose gallery half-arrived.
--
-- Granted to service_role only. The `import-catalog-item` Edge Function is the
-- sole caller: it authenticates the JWT, copies the image files, and passes the
-- resulting URLs plus the verified caller id. Authorization is re-checked here
-- against p_actor_id rather than taken on trust, so a mistake in the function
-- cannot let a merchant write into somebody else's shop.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_catalog_item_to_shop(
  p_catalog_item_id uuid,
  p_shop_id         uuid,
  p_actor_id        uuid,
  p_price_zmw       integer,
  p_image_urls      text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_catalog RECORD;
  v_role TEXT;
  v_item_id uuid;
  v_url TEXT;
  v_index integer := 0;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_price_zmw IS NULL OR p_price_zmw <= 0 THEN
    RAISE EXCEPTION 'A price is required to import this item';
  END IF;

  SELECT role INTO v_role FROM public.users WHERE id = p_actor_id;

  -- Admins may import into any shop; a merchant only into one they are
  -- assigned to, and only once that shop is live — the same bar
  -- items_merchant_write sets for writing a catalogue at all.
  IF v_role IS DISTINCT FROM 'admin' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.merchant_shops ms
      JOIN public.shops s ON s.id = ms.shop_id
      WHERE ms.shop_id = p_shop_id
        AND ms.user_id = p_actor_id
        AND s.is_active = true
    ) THEN
      RAISE EXCEPTION 'Forbidden: not assigned to this shop';
    END IF;
  END IF;

  SELECT id, name, description, category_id, item_type, is_active
  INTO v_catalog
  FROM public.catalog_items
  WHERE id = p_catalog_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalogue item not found';
  END IF;

  IF v_catalog.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'This catalogue item has been retired and cannot be imported';
  END IF;

  INSERT INTO public.items (
    shop_id, name, description, price_zmw, category_id, item_type,
    image_url, is_available
  )
  VALUES (
    p_shop_id,
    v_catalog.name,
    v_catalog.description,
    p_price_zmw,
    v_catalog.category_id,
    v_catalog.item_type,
    p_image_urls[1],
    true
  )
  RETURNING id INTO v_item_id;

  FOREACH v_url IN ARRAY COALESCE(p_image_urls, '{}')
  LOOP
    EXIT WHEN v_index >= 5;
    INSERT INTO public.item_images (item_id, image_url, sort_order)
    VALUES (v_item_id, v_url, v_index);
    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', v_item_id,
    'shop_id', p_shop_id,
    'images', v_index
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_catalog_item_to_shop(uuid, uuid, uuid, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_catalog_item_to_shop(uuid, uuid, uuid, integer, text[]) TO service_role;
