-- =============================================================================
-- Fix: list save and rating counters never moved for anyone but the owner
--
-- ---------------------------------------------------------------------------
-- The bug
-- ---------------------------------------------------------------------------
-- sync_list_save_count and sync_list_rating (20260807050000_lists.sql) are
-- plain plpgsql with no SECURITY DEFINER. A trigger function runs as the user
-- who fired it, so RLS applies inside its body.
--
-- The app inserts into list_saves directly as the signed-in user
-- (useLists.ts, useListDetail.ts — there is no RPC in between). list_saves_write
-- allows that: the row is their own. The AFTER trigger then runs as that same
-- user and issues:
--
--     UPDATE public.lists SET save_count = (...) WHERE id = v_list_id;
--
-- `lists` has RLS enabled, and its only write policies are lists_owner_write
-- (owner or the owning shop's merchant) and lists_admin_write. For anybody
-- else the UPDATE matches zero rows.
--
-- And that is the part that made this invisible for a month: an UPDATE filtered
-- by RLS does not raise. It reports success having changed nothing. No error
-- surfaced, no test failed, and the counter simply stayed where it was.
--
-- Net effect: lists.save_count, rating_count and rating_sum only ever changed
-- when a list's own owner saved or rated it. The community feed reads those
-- columns directly, so every list built by somebody else has been showing zero
-- saves and no KithLy Rating regardless of what people actually did.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on both functions, so the recompute runs with the definer's
-- rights rather than the saver's. The bodies are otherwise untouched — they
-- already recompute from source rows rather than incrementing, so they were
-- always correct when they were allowed to run.
--
-- search_path stays pinned, which matters more now that these are definer
-- functions.
--
-- 20260912000000_posts.sql already applies this pattern to the post counters;
-- this brings lists into line rather than leaving two conventions.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_list_save_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

CREATE OR REPLACE FUNCTION public.sync_list_rating()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Every counter written while the bug was live is wrong, and the triggers only
-- fire on future writes — a save that was dropped is not replayed by fixing the
-- function. So recompute all three columns from the source tables once.
--
-- lists_touch_updated_at is disabled around this. It is a BEFORE UPDATE trigger
-- that stamps updated_at = now() unconditionally, so a blind backfill would
-- mark every list in the platform as edited this instant. Repairing a counter
-- is not an edit by the person who owns the list.
--
-- Only rows whose stored value actually disagrees are touched.
-- ---------------------------------------------------------------------------
ALTER TABLE public.lists DISABLE TRIGGER lists_touch_updated_at;

WITH computed AS (
  SELECT
    l.id,
    (SELECT count(*) FROM public.list_saves s WHERE s.list_id = l.id)                     AS real_saves,
    (SELECT count(*) FROM public.list_ratings r WHERE r.list_id = l.id)                   AS real_rating_count,
    (SELECT COALESCE(sum(r.rating), 0) FROM public.list_ratings r WHERE r.list_id = l.id) AS real_rating_sum
  FROM public.lists l
)
UPDATE public.lists l
SET save_count   = c.real_saves,
    rating_count = c.real_rating_count,
    rating_sum   = c.real_rating_sum
FROM computed c
WHERE c.id = l.id
  AND (
    l.save_count   IS DISTINCT FROM c.real_saves
    OR l.rating_count IS DISTINCT FROM c.real_rating_count
    OR l.rating_sum   IS DISTINCT FROM c.real_rating_sum
  );

ALTER TABLE public.lists ENABLE TRIGGER lists_touch_updated_at;
