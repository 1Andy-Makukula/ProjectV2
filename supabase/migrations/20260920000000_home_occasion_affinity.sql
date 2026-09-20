-- =============================================================================
-- Kappa for `rent`, which is really "Home"
--
-- WHY THIS EXISTS
-- ---------------
-- 20260914070000 seeded kappa for all thirteen occasions, and `rent` came out
-- of it with two entries -- furniture 0.45 and home-decor 0.35 -- the only two
-- values in the whole seed below 0.50. That was the table being honest: rent is
-- money, KithLy sends things, and there is no basket for a month's rent.
--
-- The occasion is being kept and reframed rather than dropped. As a tile it is
-- "Home": the appliances, the furniture, the bedding and everything else that
-- makes a place somebody is renting actually liveable. That IS a basket, and a
-- large one -- it is what a diaspora sender buys when a relative moves into an
-- empty flat.
--
-- The reminder keeps the kind name `rent`, because a monthly date on a contact
-- is genuinely about rent and `contact_occasions` rows already point at it. Only
-- the tile is renamed, in the frontend, where tile labels live.
--
-- BLAST RADIUS: 🟢 Local. Inserts into kithly_reco.kind_category, which is read
-- only by the ranker and is not on the public API. ON CONFLICT DO UPDATE so the
-- two weak seeded rows are corrected rather than left to win by being first.
-- =============================================================================

INSERT INTO kithly_reco.kind_category (occasion_kind, category_id, strength)
SELECT v.kind, c.id, v.strength
FROM (VALUES
  -- The big-ticket things somebody actually asks for. Andy's framing: "it will
  -- have appliances inside and everything home".
  ('rent', 'home-appliances',       0.90),
  ('rent', 'furniture',             0.88),
  ('rent', 'kitchen-appliances',    0.80),
  ('rent', 'bedding-linen',         0.78),
  ('rent', 'kitchenware',           0.75),
  -- The things that turn a furnished room into somewhere you live.
  ('rent', 'home-decor',            0.60),
  ('rent', 'lighting',              0.58),
  ('rent', 'curtains-blinds',       0.55),
  ('rent', 'rugs-carpets',          0.50),
  ('rent', 'storage-organisation',  0.48)
) AS v(kind, slug, strength)
JOIN public.categories c ON c.slug = v.slug
ON CONFLICT (occasion_kind, category_id)
  DO UPDATE SET strength = EXCLUDED.strength,
                source   = 'seeded',
                updated_at = now();
