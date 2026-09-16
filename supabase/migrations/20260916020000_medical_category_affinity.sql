-- =============================================================================
-- Kappa for medical: wiring the health shelves to the occasion
--
-- WHY THIS EXISTS
-- ---------------
-- 20260914070000 seeded kappa for every occasion, but `medical` got two weak
-- links -- health-foods at 0.60 and skin-care at 0.45 -- because at the time
-- there was no pharmacy on the platform and pointing the occasion at shelves
-- nobody stocked would have produced an empty slate.
--
-- 20260826220000 had already seeded the shelves themselves: Pharmacy, Vitamins
-- & Supplements, Medical Supplies, Mobility Aids, Optical and Personal Care all
-- exist in public.categories and none of them were reachable from an occasion.
-- Six categories, zero affinity rows. There is now a pharmacy merchant, so the
-- shelves have stock behind them and the links are worth making.
--
-- WHAT THE STRENGTHS MEAN
-- -----------------------
-- Health & Care is not one need. It is a chronic refill, a first-aid restock,
-- and an elderly parent's monthly consumables, and the ordering reflects which
-- of those a diaspora sender is most often paying for:
--
--   pharmacy             the counter itself, and the reason the tile exists
--   medical-supplies     strips, cuffs, dressings -- the repeat purchase
--   vitamins-supplements the well-meant top-up that travels badly by post
--   mobility-aids        bought once, and usually by somebody far away
--   personal-care        elder care consumables, which is what this really is
--   optical              real, but seasonal and usually prescribed first
--
-- SCOPE: OVER-THE-COUNTER ONLY
-- ---------------------------
-- Nothing here dispenses. A prescription needs a pharmacist, a script, and a
-- regulator KithLy does not answer to, and none of those are in this schema.
-- These categories are ordinary retail goods that happen to be sold by a
-- chemist. If dispensing is ever in scope it arrives as its own rail, with its
-- own verification, and not by quietly widening a seed list.
--
-- SAFETY
-- ------
-- The JOIN on slug is the guard: a category that does not exist contributes no
-- row rather than failing the migration. ON CONFLICT DO NOTHING means the two
-- strengths seeded in 20260914070000 keep the values they were given -- this
-- adds reach, it does not restate what is already there.
-- =============================================================================

INSERT INTO kithly_reco.kind_category (occasion_kind, category_id, strength)
SELECT v.kind, c.id, v.strength
FROM (VALUES
  ('medical', 'pharmacy',             0.95),
  ('medical', 'medical-supplies',     0.85),
  ('medical', 'vitamins-supplements', 0.70),
  ('medical', 'mobility-aids',        0.60),
  ('medical', 'personal-care',        0.50),
  ('medical', 'optical',              0.45)
) AS v(kind, slug, strength)
JOIN public.categories c ON c.slug = v.slug
ON CONFLICT (occasion_kind, category_id) DO NOTHING;
