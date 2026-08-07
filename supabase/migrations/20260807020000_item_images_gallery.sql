-- =============================================================================
-- Phase 3 — Multi-image item galleries
--
-- An item can now carry up to five photographs instead of one.
--
-- ---------------------------------------------------------------------------
-- Why a child table and not more columns on items
-- ---------------------------------------------------------------------------
-- items.image_url is read by the cart, checkout, search, experiences, the
-- storefront cards and the order history. Changing its meaning — or replacing
-- it with an array — would touch every one of those. So it stays exactly what
-- it is today: the single cover image.
--
-- The gallery is purely additive alongside it, and a trigger keeps the cover in
-- step with the first gallery image so the two can never disagree.
--
-- ---------------------------------------------------------------------------
-- The cover is only ever written, never cleared
-- ---------------------------------------------------------------------------
-- Every item that exists today has an image_url and no gallery rows. A trigger
-- that nulled the cover whenever the gallery was empty would therefore wipe the
-- cover from the entire catalogue the moment it was installed. sync_item_cover
-- only assigns a cover when a gallery row exists to assign from; emptying a
-- gallery leaves the last cover in place.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  image_url  text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT item_images_sort_order_check CHECK (sort_order BETWEEN 0 AND 4),
  CONSTRAINT item_images_url_check CHECK (btrim(image_url) <> '')
);

COMMENT ON TABLE public.item_images IS
  'Gallery photographs for an item, up to five. sort_order 0 is the cover and is mirrored into items.image_url.';

-- Ordering is always per item, so the index carries the sort key with it.
CREATE INDEX IF NOT EXISTS item_images_item_id_sort_order_idx
  ON public.item_images (item_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2. The five-image cap
--
-- The upload Edge Function receives a shop_id and a file — it has no item_id
-- (a brand new item does not have one yet), so it cannot count anything. The
-- cap therefore lives here, where it holds for every writer regardless of which
-- client is talking to the database.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_item_image_cap()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.item_images
  WHERE item_id = NEW.item_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'An item may have at most 5 images';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS item_images_cap ON public.item_images;
CREATE TRIGGER item_images_cap
  BEFORE INSERT ON public.item_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_item_image_cap();

-- ---------------------------------------------------------------------------
-- 3. Keep items.image_url pointing at the first gallery image
--
-- Runs after every gallery change, including the reorder that follows deleting
-- the current cover — which is what promotes the next image up rather than
-- leaving the card blank.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_item_cover()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_item_id uuid := COALESCE(NEW.item_id, OLD.item_id);
  v_cover   text;
BEGIN
  SELECT image_url INTO v_cover
  FROM public.item_images
  WHERE item_id = v_item_id
  ORDER BY sort_order, created_at, id
  LIMIT 1;

  -- Deliberately no ELSE: an emptied gallery keeps whatever cover the item
  -- already had rather than losing its picture entirely.
  IF v_cover IS NOT NULL THEN
    UPDATE public.items
    SET image_url = v_cover
    WHERE id = v_item_id AND image_url IS DISTINCT FROM v_cover;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS item_images_sync_cover ON public.item_images;
CREATE TRIGGER item_images_sync_cover
  AFTER INSERT OR UPDATE OR DELETE ON public.item_images
  FOR EACH ROW EXECUTE FUNCTION public.sync_item_cover();

-- ---------------------------------------------------------------------------
-- 4. Row level security
--
-- Mirrors the items policies this table hangs off, including the approval
-- gating added in 20260802020000: a merchant whose shop is not live must not be
-- able to write gallery rows either. Permissions resolve through the parent
-- item rather than being duplicated onto this table.
-- ---------------------------------------------------------------------------
ALTER TABLE public.item_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_images_public_read ON public.item_images;
CREATE POLICY item_images_public_read ON public.item_images
  FOR SELECT USING (true);

DROP POLICY IF EXISTS item_images_admin_write ON public.item_images;
CREATE POLICY item_images_admin_write ON public.item_images
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS item_images_merchant_write ON public.item_images;
CREATE POLICY item_images_merchant_write ON public.item_images
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.items i
      JOIN public.merchant_shops ms ON ms.shop_id = i.shop_id
      JOIN public.shops s ON s.id = ms.shop_id
      WHERE i.id = item_images.item_id
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
      WHERE i.id = item_images.item_id
        AND ms.user_id = auth.uid()
        AND s.is_active = true
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Backfill the existing single images
--
-- Without this the gallery editor would open empty for every item that already
-- has a picture, and a merchant adding a second photograph would appear to have
-- lost the first. Idempotent: re-running skips items that already have rows.
-- ---------------------------------------------------------------------------
INSERT INTO public.item_images (item_id, image_url, sort_order)
SELECT i.id, i.image_url, 0
FROM public.items i
WHERE i.image_url IS NOT NULL
  AND btrim(i.image_url) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.item_images ii WHERE ii.item_id = i.id
  );
