-- =============================================================================
-- Phase 7 — KithLy Rating for shops
--
-- Trust on a storefront currently rests on two things: the KithLy Verified
-- badge, which says an admin checked the paperwork, and a fulfilment count,
-- which says orders got collected. Neither says whether the experience was any
-- good. For services in particular — work bought sight unseen and held in
-- escrow — that is the gap worth closing.
--
-- ---------------------------------------------------------------------------
-- Why this is not the same table as list_ratings
-- ---------------------------------------------------------------------------
-- The two look alike and are governed completely differently. Anyone who can
-- see a list may rate it. Rating a shop requires having actually collected an
-- order from it, which is a join through shop_orders and transactions. Sharing
-- one table would mean one set of RLS policies trying to express both rules.
--
-- ---------------------------------------------------------------------------
-- Eligibility is the whole point
-- ---------------------------------------------------------------------------
-- A rating anyone can leave is a rating anyone can farm. can_rate_shop requires
-- a REDEEMED shop_order belonging to the rater, so a score can only ever come
-- from someone who paid and collected. Enforced in the policy, not in the UI.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Aggregates on the shop
--
-- Denormalised for the same reason lists carry theirs: the storefront renders
-- a dozen shop cards at once and must not run an aggregate per card.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS rating_sum integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.shops.rating_count IS
  'Number of KithLy Ratings left by buyers who collected an order. Maintained by trigger.';

-- ---------------------------------------------------------------------------
-- 2. The ratings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_ratings (
  shop_id    uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating     integer NOT NULL,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, user_id),

  CONSTRAINT shop_ratings_rating_check CHECK (rating BETWEEN 1 AND 5),
  -- Short enough to be a note rather than a review essay, and therefore a much
  -- smaller moderation surface than open comments would have been.
  CONSTRAINT shop_ratings_comment_check CHECK (comment IS NULL OR length(comment) <= 280)
);

COMMENT ON TABLE public.shop_ratings IS
  'One KithLy Rating per buyer per shop. Requires a redeemed order from that shop — see can_rate_shop.';

CREATE INDEX IF NOT EXISTS shop_ratings_shop_idx ON public.shop_ratings (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Eligibility
--
-- SECURITY DEFINER so the policy can look through shop_orders and transactions
-- without the rater needing to be able to read them directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_rate_shop(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_orders so
    JOIN public.transactions t ON t.transaction_id = so.transaction_id
    WHERE so.shop_id = p_shop_id
      AND t.buyer_id = auth.uid()
      AND so.claim_status = 'REDEEMED'
  )
$$;

REVOKE ALL ON FUNCTION public.can_rate_shop(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_rate_shop(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Row level security
--
-- Individual rows are readable by their author and by admins only. The public
-- never needs them: the storefront reads the aggregate off `shops`, so there is
-- no reason to expose who rated whom.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_ratings_read ON public.shop_ratings;
CREATE POLICY shop_ratings_read ON public.shop_ratings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_role() = 'admin');

DROP POLICY IF EXISTS shop_ratings_write ON public.shop_ratings;
CREATE POLICY shop_ratings_write ON public.shop_ratings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_rate_shop(shop_id));

-- ---------------------------------------------------------------------------
-- 5. Keeping the aggregate honest
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_shop_rating()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_shop_id uuid := COALESCE(NEW.shop_id, OLD.shop_id);
BEGIN
  UPDATE public.shops
  SET rating_count = (SELECT count(*) FROM public.shop_ratings WHERE shop_id = v_shop_id),
      rating_sum   = (SELECT COALESCE(sum(rating), 0) FROM public.shop_ratings WHERE shop_id = v_shop_id)
  WHERE id = v_shop_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS shop_ratings_sync ON public.shop_ratings;
CREATE TRIGGER shop_ratings_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.shop_ratings
  FOR EACH ROW EXECUTE FUNCTION public.sync_shop_rating();
