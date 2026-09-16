-- =============================================================================
-- Which occasion a curated bundle belongs to
--
-- WHY THIS EXISTS
-- ---------------
-- `experiences` is already the curated multi-shop bundle the occasion tiles
-- need: items referenced rather than copied, a total derived at read time, one
-- shared deadline, and a purchase that resolves into the ordinary cart. What it
-- has never had is any notion of *what it is for*, so there is no way to ask
-- for "the graduation ones" -- and that question is the whole front door.
--
-- The taxonomy is not invented here. `occasion_lead_times.kind` already names
-- the thirteen kinds, is already seeded with all of them, and is already what
-- `contact_occasions.kind` is written against. Pointing at it with a foreign
-- key rather than repeating the list in a CHECK means the tiles, a person's
-- saved occasions and the reminder lead times can never drift into three
-- slightly different vocabularies.
--
-- NULL IS A REAL STATE, NOT A MISSING ONE
-- ---------------------------------------
-- An untagged experience is reachable by link and by search but sits under no
-- tile. That is the correct home for a one-off -- a single restaurant's
-- Valentine's menu, a partner promotion -- so the column is nullable with no
-- default and nothing backfills it.
--
-- BLAST RADIUS: 🟡 Feature. `experiences` is read by useExperiences,
-- AdminExperiences, ConsumerStorefront, Landing, SignUp, ExperienceDetail,
-- MerchantDashboard and reco/track. All of them select named columns or `*`
-- and none writes an exhaustive column list, so a nullable addition is
-- invisible to every one of them until something asks for it.
-- =============================================================================

ALTER TABLE public.experiences
  ADD COLUMN IF NOT EXISTS occasion_kind text
    REFERENCES public.occasion_lead_times(kind) ON DELETE SET NULL;

COMMENT ON COLUMN public.experiences.occasion_kind IS
  'Which occasion tile this bundle appears under. Null means it is reachable by
   link and by search but sits under no tile -- the correct state for a one-off,
   not an error. ON DELETE SET NULL because retiring a kind from the taxonomy
   must never take the bundles with it.';

-- Partial, because every caller of this asks the same question: the active
-- bundles for one occasion, in display order. The predicate keeps drafts and
-- retired bundles out of the index entirely rather than out of the result.
CREATE INDEX IF NOT EXISTS experiences_occasion_idx
  ON public.experiences (occasion_kind, sort_order)
  WHERE is_active = true;
