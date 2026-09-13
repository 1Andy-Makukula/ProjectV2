-- =============================================================================
-- Shop collections — so a shop reads as a shop, not a heap
--
-- WHY
-- ---
-- `items.category_id` has existed since 20260727000000 and ~100 categories were
-- seeded in 20260826220000. Nothing groups by either. `ShopDetail.tsx` renders
-- one flat grid, so a shop with forty items is forty tiles in a row and a
-- shopper has no way to find the thing they came for.
--
-- That is a data gap wearing a UI complaint's clothes. A shop needs a way to
-- say "these go together", and every shop that never bothers still needs to
-- look organised.
--
-- TWO LAYERS, BOTH SHIPPING
-- -------------------------
--   1. Merchant collections -- a shopkeeper names their own groups. "Weekday
--      lunches", "School kit". Human, intentional, and the supply side of the
--      Composer later: a collection is somebody who knows the stock saying
--      which things belong together.
--
--   2. Category fallback -- where a merchant has made none, group by
--      category_id automatically, so a shop is organised from day one at zero
--      merchant effort.
--
-- ONE RESOLUTION ORDER, IN ONE FUNCTION
-- -------------------------------------
-- `shop_item_groups()` below is the single place that decides how a shop is
-- organised: collections if any exist, else categories, else flat. Every
-- surface calls it -- ShopDetail, the storefront, and the Composer -- so they
-- cannot drift into three different answers about the same shop.
--
-- GROUPING MUST NEVER HIDE AN ITEM
-- --------------------------------
-- The failure mode of grouping is an item that belongs to no group and
-- therefore appears nowhere. A merchant who puts three of fifty items into one
-- collection would lose the other forty-seven from their own shop page.
--
-- So the function always emits every visible item: anything outside a
-- collection falls into a trailing group. That is a correctness property, not
-- a presentation choice, and the assertion file tests for it by count.
--
-- SAME-SHOP INTEGRITY, DECLARED NOT TRIGGERED
-- -------------------------------------------
-- The same composite-foreign-key approach 20260912070000 used for contact
-- groups: membership carries shop_id and references (id, shop_id) on both
-- sides, so one shop's item cannot enter another shop's collection.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Composite FK target on items
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'items_id_shop_key' AND conrelid = 'public.items'::regclass
  ) THEN
    ALTER TABLE public.items ADD CONSTRAINT items_id_shop_key UNIQUE (id, shop_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The collection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_collections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,

  name         text NOT NULL,

  /* What the group is for, shown under the heading where a shop wants to
     explain itself. Optional -- most collections are self-evident. */
  description  text,

  /* The merchant's own order. Ties break on name so the result is stable. */
  sort_order   integer NOT NULL DEFAULT 0,

  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shop_collections_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT shop_collections_shop_name_key UNIQUE (shop_id, name),
  CONSTRAINT shop_collections_id_shop_key UNIQUE (id, shop_id)
);

COMMENT ON TABLE public.shop_collections IS
  'Merchant-named groups of their own items. The first layer of how a shop page is organised.';

CREATE INDEX IF NOT EXISTS shop_collections_shop_idx
  ON public.shop_collections (shop_id, sort_order)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- 3. Membership
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_collection_items (
  collection_id  uuid NOT NULL,
  item_id        uuid NOT NULL,

  /* Carried so the composite keys below can assert that a collection and the
     item it holds belong to the same shop. Derivable; the point is that the
     database enforces it rather than the application remembering to. */
  shop_id        uuid NOT NULL,

  sort_order     integer NOT NULL DEFAULT 0,
  added_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (collection_id, item_id),

  CONSTRAINT shop_collection_items_collection_fkey
    FOREIGN KEY (collection_id, shop_id)
    REFERENCES public.shop_collections (id, shop_id) ON DELETE CASCADE,

  CONSTRAINT shop_collection_items_item_fkey
    FOREIGN KEY (item_id, shop_id)
    REFERENCES public.items (id, shop_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.shop_collection_items IS
  'Which items sit in which collection. Composite FKs make a cross-shop membership structurally impossible.';

CREATE INDEX IF NOT EXISTS shop_collection_items_item_idx
  ON public.shop_collection_items (item_id);

-- ---------------------------------------------------------------------------
-- 4. RLS
--
-- Read is open to anon: a shop page is public. Writes gate through
-- merchant_shops, the same join `posts_merchant_write` uses, plus admin.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_collections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_collection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_collections_read ON public.shop_collections;
CREATE POLICY shop_collections_read ON public.shop_collections
  FOR SELECT TO anon, authenticated USING (is_active);

DROP POLICY IF EXISTS shop_collections_merchant_write ON public.shop_collections;
CREATE POLICY shop_collections_merchant_write ON public.shop_collections
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_collections.shop_id AND ms.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_collections.shop_id AND ms.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS shop_collections_admin_write ON public.shop_collections;
CREATE POLICY shop_collections_admin_write ON public.shop_collections
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS shop_collection_items_read ON public.shop_collection_items;
CREATE POLICY shop_collection_items_read ON public.shop_collection_items
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS shop_collection_items_merchant_write ON public.shop_collection_items;
CREATE POLICY shop_collection_items_merchant_write ON public.shop_collection_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_collection_items.shop_id AND ms.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_collection_items.shop_id AND ms.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS shop_collection_items_admin_write ON public.shop_collection_items;
CREATE POLICY shop_collection_items_admin_write ON public.shop_collection_items
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.touch_shop_collection_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shop_collections_touch ON public.shop_collections;
CREATE TRIGGER shop_collections_touch
  BEFORE UPDATE ON public.shop_collections
  FOR EACH ROW EXECUTE FUNCTION public.touch_shop_collection_updated_at();

-- ---------------------------------------------------------------------------
-- 5. The resolution order, in one place
--
-- SECURITY INVOKER deliberately. Item visibility is already decided by
-- `items_public_read` (is_available IS NOT FALSE), so running as the caller
-- gives the right answer for free -- and a SECURITY DEFINER here would quietly
-- expose unavailable items to anyone who called it.
--
-- Returns one row per (group, item). A shop with no visible items returns
-- nothing at all, which the caller should render as an empty shop rather than
-- an empty group.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.shop_item_groups(uuid);
CREATE FUNCTION public.shop_item_groups(p_shop_id uuid)
RETURNS TABLE (
  group_key    text,
  group_label  text,
  group_source text,
  group_sort   integer,
  item_id      uuid,
  item_sort    integer
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_has_collections boolean;
  v_has_categories  boolean;
BEGIN
  -- A collection counts only if it actually holds a visible item. An empty
  -- collection must not switch the whole shop into collection mode and leave
  -- every item in the trailing group.
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_collections sc
    JOIN public.shop_collection_items sci ON sci.collection_id = sc.id
    JOIN public.items i ON i.id = sci.item_id
    WHERE sc.shop_id = p_shop_id AND sc.is_active
  ) INTO v_has_collections;

  IF v_has_collections THEN
    RETURN QUERY
      SELECT
        sc.id::text,
        sc.name,
        'collection'::text,
        sc.sort_order,
        i.id,
        sci.sort_order
      FROM public.shop_collections sc
      JOIN public.shop_collection_items sci ON sci.collection_id = sc.id
      JOIN public.items i ON i.id = sci.item_id
      WHERE sc.shop_id = p_shop_id AND sc.is_active;

    -- Everything the merchant has not filed. See the header: grouping must
    -- never hide an item. Sorted last by a deliberately large group_sort.
    RETURN QUERY
      SELECT
        'uncollected'::text,
        'More from this shop'::text,
        'collection'::text,
        1000000,
        i.id,
        0
      FROM public.items i
      WHERE i.shop_id = p_shop_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.shop_collection_items sci
          JOIN public.shop_collections sc
            ON sc.id = sci.collection_id AND sc.is_active
          WHERE sci.item_id = i.id
        );
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.items i
    WHERE i.shop_id = p_shop_id AND i.category_id IS NOT NULL
  ) INTO v_has_categories;

  IF v_has_categories THEN
    RETURN QUERY
      SELECT
        COALESCE(c.id::text, 'uncategorised'),
        COALESCE(c.name, 'Everything else'),
        'category'::text,
        /* Named categories first, in name order; the catch-all last. The
           ordinal is resolved here rather than by the caller so two surfaces
           cannot order the same shop differently. */
        CASE WHEN c.id IS NULL THEN 1000000 ELSE 0 END,
        i.id,
        0
      FROM public.items i
      LEFT JOIN public.categories c ON c.id = i.category_id
      WHERE i.shop_id = p_shop_id;
    RETURN;
  END IF;

  -- Neither layer applies: one unnamed group, which the caller renders as the
  -- plain grid it renders today.
  RETURN QUERY
    SELECT
      'all'::text,
      NULL::text,
      'flat'::text,
      0,
      i.id,
      0
    FROM public.items i
    WHERE i.shop_id = p_shop_id;
END;
$$;

COMMENT ON FUNCTION public.shop_item_groups(uuid) IS
  'How one shop is organised: collections if any hold items, else categories, else flat. The single source of that order.';

REVOKE ALL ON FUNCTION public.shop_item_groups(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_item_groups(uuid) TO anon, authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'shop collections ready';
END $$;
