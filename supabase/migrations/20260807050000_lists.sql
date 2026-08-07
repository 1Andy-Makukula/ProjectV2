-- =============================================================================
-- Phase 6 — Shop and community lists
--
-- A named, shareable collection of items that can span several businesses:
-- "October groceries", "Everything for a braai", "Baby shower — Chanda".
-- Anyone can build one; a shop can build one as merchandising; an admin can
-- publish one under the KithLy name.
--
-- ---------------------------------------------------------------------------
-- Deliberately separate from `experiences`
-- ---------------------------------------------------------------------------
-- experiences is admin-curated, slug-shareable and buyable as a unit, which
-- overlaps heavily. It is nonetheless left alone: it is a live feature with its
-- own checkout path (checkout_init_atomic takes p_experience_id), and widening
-- it to carry user- and shop-owned collections with three visibilities would
-- put that at risk to save one table. `bundles` was dropped rather than made to
-- overlap a third time.
--
-- ---------------------------------------------------------------------------
-- Saving is a bookmark, not a copy
-- ---------------------------------------------------------------------------
-- list_saves points at the original, so a saved shop list keeps showing the
-- shop's updates. Duplicating on save would fill the community feed with stale
-- near-identical lists. Copying is a separate, explicit act that mints a new
-- list owned by whoever copied it.
--
-- ---------------------------------------------------------------------------
-- Why list_items keeps a snapshot
-- ---------------------------------------------------------------------------
-- Items are hard-deleted (useAdminItemForm calls .delete()). A row that only
-- held item_id would vanish with it, and a list shared as 12 items would
-- silently arrive as 9. The FK is ON DELETE SET NULL and the row keeps the name
-- and picture it was added with, so the entry can still be shown, greyed, with
-- a reason. Live item data always wins while the item exists — the snapshot is
-- only ever a fallback.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  description   text,

  owner_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  owner_shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,

  visibility    text NOT NULL DEFAULT 'private',
  is_anonymous  boolean NOT NULL DEFAULT false,
  -- Set when an admin publishes; badged as KithLy rather than as the person.
  is_platform   boolean NOT NULL DEFAULT false,

  -- Denormalised so the community feed never runs an aggregate per card.
  save_count    integer NOT NULL DEFAULT 0,
  rating_count  integer NOT NULL DEFAULT 0,
  rating_sum    integer NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lists_title_check CHECK (btrim(title) <> ''),
  CONSTRAINT lists_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT lists_visibility_check CHECK (visibility IN ('private', 'link', 'community')),
  -- Exactly one owner. A list belongs to a person or to a shop, never both.
  CONSTRAINT lists_single_owner_check CHECK (
    (owner_user_id IS NOT NULL AND owner_shop_id IS NULL)
    OR (owner_user_id IS NULL AND owner_shop_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.lists IS
  'Named collections of items, spanning shops. Owned by a person or a shop; private, link-shared, or published to the community feed.';

CREATE INDEX IF NOT EXISTS lists_community_idx
  ON public.lists (created_at DESC)
  WHERE visibility = 'community';

CREATE INDEX IF NOT EXISTS lists_owner_user_idx ON public.lists (owner_user_id);
CREATE INDEX IF NOT EXISTS lists_owner_shop_idx ON public.lists (owner_shop_id);

-- ---------------------------------------------------------------------------
-- 2. List entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.list_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id            uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: the entry outlives the item so it can be shown as
  -- no longer available instead of silently disappearing.
  item_id            uuid REFERENCES public.items(id) ON DELETE SET NULL,
  snapshot_name      text NOT NULL,
  snapshot_image_url text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT list_items_snapshot_name_check CHECK (btrim(snapshot_name) <> '')
);

CREATE INDEX IF NOT EXISTS list_items_list_sort_idx
  ON public.list_items (list_id, sort_order);

-- An item appears once per list; quantity is not a list concept.
CREATE UNIQUE INDEX IF NOT EXISTS list_items_unique_item_idx
  ON public.list_items (list_id, item_id)
  WHERE item_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Saves and ratings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.list_saves (
  list_id    uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id)
);

CREATE INDEX IF NOT EXISTS list_saves_user_idx ON public.list_saves (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.list_ratings (
  list_id    uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating     integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id),

  CONSTRAINT list_ratings_rating_check CHECK (rating BETWEEN 1 AND 5)
);

COMMENT ON TABLE public.list_ratings IS
  'One KithLy Rating per person per list. Separate from shop ratings: anyone who can see a list may rate it, whereas rating a shop requires having bought from it.';

-- ---------------------------------------------------------------------------
-- 4. Permission helpers
--
-- SECURITY DEFINER so the policies on list_items / list_saves / list_ratings
-- can ask about a list without re-entering the lists policies and recursing —
-- the same reason current_user_role() exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_list(p_list_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lists l
    WHERE l.id = p_list_id
      AND (
        -- 'link' is unlisted rather than secret: holding the URL is the access
        -- control, so it cannot be enforced here. The community feed query
        -- filters on visibility = 'community' to keep them out of browsing.
        l.visibility IN ('community', 'link')
        OR l.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.merchant_shops ms
          WHERE ms.shop_id = l.owner_shop_id AND ms.user_id = auth.uid()
        )
        OR public.current_user_role() = 'admin'
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_list(p_list_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lists l
    WHERE l.id = p_list_id
      AND (
        l.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.merchant_shops ms
          WHERE ms.shop_id = l.owner_shop_id AND ms.user_id = auth.uid()
        )
        OR public.current_user_role() = 'admin'
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_list(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_list(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_list(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lists_read ON public.lists;
CREATE POLICY lists_read ON public.lists
  FOR SELECT USING (
    visibility IN ('community', 'link')
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = lists.owner_shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- A person may only create a list owned by themselves; a merchant may create
-- one owned by a shop they run. is_platform stays false for both — only the
-- admin policy below can set it, so nobody can badge their own list as KithLy.
DROP POLICY IF EXISTS lists_owner_write ON public.lists;
CREATE POLICY lists_owner_write ON public.lists
  FOR ALL TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = lists.owner_shop_id AND ms.user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_platform = false
    AND (
      owner_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.merchant_shops ms
        WHERE ms.shop_id = lists.owner_shop_id AND ms.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS lists_admin_write ON public.lists;
CREATE POLICY lists_admin_write ON public.lists
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS list_items_read ON public.list_items;
CREATE POLICY list_items_read ON public.list_items
  FOR SELECT USING (public.can_view_list(list_id));

DROP POLICY IF EXISTS list_items_write ON public.list_items;
CREATE POLICY list_items_write ON public.list_items
  FOR ALL TO authenticated
  USING (public.can_edit_list(list_id))
  WITH CHECK (public.can_edit_list(list_id));

-- Saves and ratings are personal rows: you manage your own, against any list
-- you are allowed to see.
DROP POLICY IF EXISTS list_saves_read ON public.list_saves;
CREATE POLICY list_saves_read ON public.list_saves
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_edit_list(list_id));

DROP POLICY IF EXISTS list_saves_write ON public.list_saves;
CREATE POLICY list_saves_write ON public.list_saves
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_view_list(list_id));

DROP POLICY IF EXISTS list_ratings_read ON public.list_ratings;
CREATE POLICY list_ratings_read ON public.list_ratings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_edit_list(list_id));

DROP POLICY IF EXISTS list_ratings_write ON public.list_ratings;
CREATE POLICY list_ratings_write ON public.list_ratings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_view_list(list_id));

-- ---------------------------------------------------------------------------
-- 6. Counter maintenance
--
-- save_count and the rating aggregates live on `lists` so the community feed is
-- a single indexed read. Triggers keep them honest rather than trusting the
-- client to increment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_list_save_count()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_list_id uuid := COALESCE(NEW.list_id, OLD.list_id);
BEGIN
  UPDATE public.lists
  SET save_count = (SELECT count(*) FROM public.list_saves WHERE list_id = v_list_id)
  WHERE id = v_list_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS list_saves_sync_count ON public.list_saves;
CREATE TRIGGER list_saves_sync_count
  AFTER INSERT OR DELETE ON public.list_saves
  FOR EACH ROW EXECUTE FUNCTION public.sync_list_save_count();

CREATE OR REPLACE FUNCTION public.sync_list_rating()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_list_id uuid := COALESCE(NEW.list_id, OLD.list_id);
BEGIN
  UPDATE public.lists
  SET rating_count = (SELECT count(*) FROM public.list_ratings WHERE list_id = v_list_id),
      rating_sum   = (SELECT COALESCE(sum(rating), 0) FROM public.list_ratings WHERE list_id = v_list_id)
  WHERE id = v_list_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS list_ratings_sync ON public.list_ratings;
CREATE TRIGGER list_ratings_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.list_ratings
  FOR EACH ROW EXECUTE FUNCTION public.sync_list_rating();

CREATE OR REPLACE FUNCTION public.touch_list_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lists_touch_updated_at ON public.lists;
CREATE TRIGGER lists_touch_updated_at
  BEFORE UPDATE ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.touch_list_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Slug allocation
--
-- Titles collide constantly ("Groceries"), so the slug carries a short random
-- suffix rather than a counter — no read-then-write race to lose.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_list_slug(p_title text)
RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
DECLARE
  v_base text;
  v_slug text;
  v_attempt integer := 0;
BEGIN
  v_base := btrim(both '-' from regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g'));
  IF v_base = '' THEN
    v_base := 'list';
  END IF;
  v_base := left(v_base, 48);

  LOOP
    v_slug := v_base || '-' || lower(public.gen_claim_code(6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lists WHERE slug = v_slug);

    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not allocate a unique slug';
    END IF;
  END LOOP;

  RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_list_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_list_slug(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Copying a list
--
-- The counterpart to saving. Produces an independent private list owned by the
-- caller, carrying the entries as they stand right now. Ratings, saves and
-- visibility deliberately do not come along.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_list(p_list_id uuid, p_title text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_source RECORD;
  v_title text;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_view_list(p_list_id) THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  SELECT id, title, description INTO v_source FROM public.lists WHERE id = p_list_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  v_title := COALESCE(nullif(btrim(coalesce(p_title, '')), ''), v_source.title || ' (my copy)');

  INSERT INTO public.lists (slug, title, description, owner_user_id, visibility)
  VALUES (public.generate_list_slug(v_title), v_title, v_source.description, v_uid, 'private')
  RETURNING id INTO v_new_id;

  INSERT INTO public.list_items (list_id, item_id, snapshot_name, snapshot_image_url, sort_order)
  SELECT v_new_id, li.item_id, li.snapshot_name, li.snapshot_image_url, li.sort_order
  FROM public.list_items li
  WHERE li.list_id = p_list_id
  ORDER BY li.sort_order;

  RETURN jsonb_build_object('success', true, 'list_id', v_new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.copy_list(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_list(uuid, text) TO authenticated;
