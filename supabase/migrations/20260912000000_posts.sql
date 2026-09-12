-- =============================================================================
-- P1 — The post model
--
-- A merchant can advertise inside KithLy: photographs, a caption, and a binding
-- to the items the post is about. The post is the advert; the items are what is
-- actually sold. Nothing here is purchasable yet — P3 builds the Buy sheet on
-- top of `post_items`.
--
-- ---------------------------------------------------------------------------
-- A post never stores a price
-- ---------------------------------------------------------------------------
-- There is deliberately no price column anywhere below, and there should never
-- be one. A post is long-lived; a price is not. Stock moves, wholesale tiers
-- trigger on quantity, FX shifts, item_options alter the total. A price copied
-- onto a post is stale the moment a merchant edits the item, and a stale price
-- on a purchasable surface is a dispute.
--
-- So a post binds to items, and P3 resolves the money at the moment somebody
-- taps Buy, through price_basket_zmw — the same path the cart already uses.
-- One pricing path, no second route around the FX quote lock or the tier rules.
--
-- ---------------------------------------------------------------------------
-- Merchants only
-- ---------------------------------------------------------------------------
-- Authorship is a shop, never a person. That keeps RLS to an ownership check
-- against merchant_shops, and it keeps the user-generated-content surface of
-- this whole feature down to a single field — the note on a wish, which P4
-- adds. No comments, no post reviews, no ratings, no dislikes: engagement here
-- is a like, a save, and a purchase.
--
-- shop_ratings keeps its meaning. It is gated on real purchase by
-- can_rate_shop(); nothing free-form is being put next to it.
--
-- ---------------------------------------------------------------------------
-- Retiring social_posts
-- ---------------------------------------------------------------------------
-- `social_posts` arrived in the 2026-05-25 baseline snapshot with roughly this
-- shape — shop_id, media_url, caption, item_ids[]. No application code has ever
-- referenced it, it holds no rows in data_backup.sql, and it is single-image, so
-- it cannot carry the galleries the feature needs. It is dropped rather than
-- extended. supabase/clear_shop_data.sql is updated in the same change.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Retire the unused predecessor
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.social_posts;

-- ---------------------------------------------------------------------------
-- 1. Posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,

  caption        text,
  -- Free text, not a foreign key. The reference designs show branch-level
  -- chips (Levy Junction, Mungwi Road) but `shops` carries exactly one
  -- location, and it also carries float_balance, payout_trust_tier and
  -- rating_sum — so splitting a shop per branch would fragment money and
  -- reputation. Real branches are a schema change well outside this feature.
  location_label text,

  -- One status column, not a status plus an is_active boolean. Two flags for
  -- one concept is two sources of truth and eventually they disagree.
  status         text NOT NULL DEFAULT 'draft',
  published_at   timestamptz,

  -- Denormalised so a feed card never runs an aggregate. Trigger-maintained
  -- below; never written by a client.
  like_count     integer NOT NULL DEFAULT 0,
  save_count     integer NOT NULL DEFAULT 0,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT posts_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT posts_caption_length_check CHECK (caption IS NULL OR length(caption) <= 2000),
  CONSTRAINT posts_location_label_length_check
    CHECK (location_label IS NULL OR length(location_label) <= 120),
  -- A published post knows when it was published; the feed orders on it.
  CONSTRAINT posts_published_at_check
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);

COMMENT ON TABLE public.posts IS
  'Shop-authored adverts: photographs, a caption, and a binding to the items they are about. Carries no price — P3 resolves that at buy-intent through price_basket_zmw.';

-- The feed read: newest published first, across all shops.
CREATE INDEX IF NOT EXISTS posts_feed_idx
  ON public.posts (published_at DESC)
  WHERE status = 'published';

-- A shop's own posts, including drafts, for the merchant dashboard.
CREATE INDEX IF NOT EXISTS posts_shop_idx
  ON public.posts (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Images
--
-- A child table rather than columns on posts, for the same reason
-- item_images exists: a gallery is a list, and a list in columns is a lie.
--
-- The ten-image cap is enforced by the unique slot constraint plus the
-- sort_order range, not by a trigger. item_images needed a counting trigger
-- because its uploader has no item_id to count against and its sort_order may
-- repeat; here the slot is unique per post, so ten legal values means at most
-- ten rows and the database enforces it with no procedural code at all.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  image_url  text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  alt_text   text,
  width      integer,
  height     integer,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_images_sort_order_check CHECK (sort_order BETWEEN 0 AND 9),
  CONSTRAINT post_images_url_check CHECK (btrim(image_url) <> ''),
  CONSTRAINT post_images_dimensions_check CHECK (
    (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
  ),
  CONSTRAINT post_images_unique_slot UNIQUE (post_id, sort_order)
);

COMMENT ON TABLE public.post_images IS
  'Photographs on a post, up to ten. sort_order 0 is the hero image in the collage.';

CREATE INDEX IF NOT EXISTS post_images_post_sort_idx
  ON public.post_images (post_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. The commerce binding
--
-- What makes a post purchasable. P3 reads this to build the Buy sheet.
--
-- item_id is SET NULL rather than CASCADE, and the snapshot columns mirror
-- list_items for the same reason given there: the entry outlives the item so
-- the sheet can say "no longer available" instead of the line silently
-- vanishing and the post quietly becoming something else.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  item_id            uuid REFERENCES public.items(id) ON DELETE SET NULL,
  snapshot_name      text NOT NULL,
  snapshot_image_url text,
  sort_order         integer NOT NULL DEFAULT 0,
  -- The item the post is mainly about, when there is more than one.
  is_primary         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_items_snapshot_name_check CHECK (btrim(snapshot_name) <> '')
);

COMMENT ON TABLE public.post_items IS
  'Items a post sells. Every attached item belongs to the posting shop, so a post is always single-vendor and checkout_init_atomic keeps one entry in p_vendors.';

CREATE INDEX IF NOT EXISTS post_items_post_sort_idx
  ON public.post_items (post_id, sort_order);

CREATE INDEX IF NOT EXISTS post_items_item_idx
  ON public.post_items (item_id)
  WHERE item_id IS NOT NULL;

-- An item appears once per post; quantity is a basket concept, not a post one.
CREATE UNIQUE INDEX IF NOT EXISTS post_items_unique_item_idx
  ON public.post_items (post_id, item_id)
  WHERE item_id IS NOT NULL;

-- At most one primary per post.
CREATE UNIQUE INDEX IF NOT EXISTS post_items_one_primary_idx
  ON public.post_items (post_id)
  WHERE is_primary;

-- ---------------------------------------------------------------------------
-- 3b. A post may only sell its own shop's items
--
-- This is load-bearing for P3, not tidiness. checkout_init_atomic takes a
-- p_vendors array; the Buy sheet stays simple only because a post resolves to
-- exactly one vendor. Enforced here rather than in the composer so it holds for
-- every writer, including an admin fixing data by hand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_post_item_same_shop()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_post_shop uuid;
  v_item_shop uuid;
BEGIN
  IF NEW.item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT shop_id INTO v_post_shop FROM public.posts WHERE id = NEW.post_id;
  SELECT shop_id INTO v_item_shop FROM public.items WHERE id = NEW.item_id;

  IF v_post_shop IS DISTINCT FROM v_item_shop THEN
    RAISE EXCEPTION
      'post_items: item % belongs to shop %, but post % belongs to shop %',
      NEW.item_id, v_item_shop, NEW.post_id, v_post_shop
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_items_same_shop ON public.post_items;
CREATE TRIGGER post_items_same_shop
  BEFORE INSERT OR UPDATE OF post_id, item_id ON public.post_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_item_same_shop();

-- ---------------------------------------------------------------------------
-- 4. Likes and saves
--
-- Personal rows, one per person per post. No dislikes: there is no column that
-- could carry one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_likes_user_idx
  ON public.post_likes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.post_saves (
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_saves_user_idx
  ON public.post_saves (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Permission helpers
--
-- SECURITY DEFINER so the policies on the child tables can ask about a post
-- without re-entering the posts policy and recursing — the same reason
-- can_view_list and current_user_role exist.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_post(p_post_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.posts p
    JOIN public.shops s ON s.id = p.shop_id
    WHERE p.id = p_post_id
      AND (
        (p.status = 'published' AND s.is_active IS TRUE)
        OR EXISTS (
          SELECT 1 FROM public.merchant_shops ms
          WHERE ms.shop_id = p.shop_id AND ms.user_id = auth.uid()
        )
        OR public.current_user_role() = 'admin'
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_post(p_post_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.posts p
    WHERE p.id = p_post_id
      AND (
        EXISTS (
          SELECT 1 FROM public.merchant_shops ms
          WHERE ms.shop_id = p.shop_id AND ms.user_id = auth.uid()
        )
        OR public.current_user_role() = 'admin'
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_post(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_post(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_post(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;

-- A published post of an active shop is public, and readable signed out — the
-- storefront is browsable before login and the og function reads as anon.
DROP POLICY IF EXISTS posts_read ON public.posts;
CREATE POLICY posts_read ON public.posts
  FOR SELECT USING (
    (
      status = 'published'
      AND EXISTS (
        SELECT 1 FROM public.shops s
        WHERE s.id = posts.shop_id AND s.is_active IS TRUE
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = posts.shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- Authorship is the shop. A merchant may only write posts for a shop they run,
-- and the WITH CHECK stops them moving a post to a shop they do not.
DROP POLICY IF EXISTS posts_merchant_write ON public.posts;
CREATE POLICY posts_merchant_write ON public.posts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = posts.shop_id AND ms.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = posts.shop_id AND ms.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS posts_admin_write ON public.posts;
CREATE POLICY posts_admin_write ON public.posts
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS post_images_read ON public.post_images;
CREATE POLICY post_images_read ON public.post_images
  FOR SELECT USING (public.can_view_post(post_id));

DROP POLICY IF EXISTS post_images_write ON public.post_images;
CREATE POLICY post_images_write ON public.post_images
  FOR ALL TO authenticated
  USING (public.can_edit_post(post_id))
  WITH CHECK (public.can_edit_post(post_id));

DROP POLICY IF EXISTS post_items_read ON public.post_items;
CREATE POLICY post_items_read ON public.post_items
  FOR SELECT USING (public.can_view_post(post_id));

DROP POLICY IF EXISTS post_items_write ON public.post_items;
CREATE POLICY post_items_write ON public.post_items
  FOR ALL TO authenticated
  USING (public.can_edit_post(post_id))
  WITH CHECK (public.can_edit_post(post_id));

-- Your own like, against any post you can see. The shop cannot read the list of
-- who liked it — only the count on the post, which the trigger maintains.
DROP POLICY IF EXISTS post_likes_read ON public.post_likes;
CREATE POLICY post_likes_read ON public.post_likes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS post_likes_write ON public.post_likes;
CREATE POLICY post_likes_write ON public.post_likes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_view_post(post_id));

DROP POLICY IF EXISTS post_saves_read ON public.post_saves;
CREATE POLICY post_saves_read ON public.post_saves
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS post_saves_write ON public.post_saves;
CREATE POLICY post_saves_write ON public.post_saves
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_view_post(post_id));

-- ---------------------------------------------------------------------------
-- 7. Counter and timestamp maintenance
--
-- Recomputed from the source rows rather than incremented, so a double-fire or
-- a retry cannot drift the number.
--
-- SECURITY DEFINER, and that part is not optional. A trigger function runs as
-- the user who fired it, so RLS applies inside its body: a shopper liking a
-- shop's post has no UPDATE privilege on `posts`, and an UPDATE that RLS
-- filters does not raise — it matches zero rows and returns quietly. The count
-- would simply never move, and nothing would report an error.
--
-- sync_list_save_count and sync_list_rating are the same shape WITHOUT the
-- definer clause, which means lists.save_count and the rating aggregates only
-- change when the list's own owner saves or rates it. That predates this
-- migration and is deliberately not fixed here — it is the lists feature, it
-- is live, and it deserves its own change and its own verification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_post_like_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_post_id uuid := COALESCE(NEW.post_id, OLD.post_id);
BEGIN
  UPDATE public.posts
  SET like_count = (SELECT count(*) FROM public.post_likes WHERE post_id = v_post_id)
  WHERE id = v_post_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS post_likes_sync_count ON public.post_likes;
CREATE TRIGGER post_likes_sync_count
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_like_count();

-- SECURITY DEFINER for the same reason as sync_post_like_count above.
CREATE OR REPLACE FUNCTION public.sync_post_save_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_post_id uuid := COALESCE(NEW.post_id, OLD.post_id);
BEGIN
  UPDATE public.posts
  SET save_count = (SELECT count(*) FROM public.post_saves WHERE post_id = v_post_id)
  WHERE id = v_post_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS post_saves_sync_count ON public.post_saves;
CREATE TRIGGER post_saves_sync_count
  AFTER INSERT OR DELETE ON public.post_saves
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_save_count();

-- published_at is stamped by the database on the transition into 'published',
-- so the feed's ordering cannot be set by a client sending its own clock.
CREATE OR REPLACE FUNCTION public.touch_post_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();

  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_touch_updated_at ON public.posts;
CREATE TRIGGER posts_touch_updated_at
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.touch_post_updated_at();
