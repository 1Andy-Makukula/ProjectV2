\set ON_ERROR_STOP on
\pset pager off

-- Kappa for medical. 20260914070000 seeded it with two weak links because no
-- pharmacy existed yet; 20260916020000 wires up the six health shelves that
-- had been sitting in public.categories unreachable from any occasion.

\echo '--- 1. the pharmacy counter is linked, and leads ---'
DO $$
DECLARE v_strength numeric;
BEGIN
  SELECT kc.strength INTO v_strength
  FROM kithly_reco.kind_category kc
  JOIN public.categories c ON c.id = kc.category_id
  WHERE kc.occasion_kind = 'medical' AND c.slug = 'pharmacy';

  IF v_strength IS NULL THEN
    RAISE EXCEPTION 'FAIL: medical has no link to pharmacy';
  END IF;
  IF v_strength <> 0.95 THEN
    RAISE EXCEPTION 'FAIL: pharmacy seeded at %, expected 0.95', v_strength;
  END IF;
  RAISE NOTICE 'PASS: pharmacy is the strongest shelf behind Health & Care';
END $$;

\echo '--- 2. all six health shelves are reachable from the occasion ---'
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(w.slug, ', ') INTO v_missing
  FROM (VALUES
    ('pharmacy'), ('medical-supplies'), ('vitamins-supplements'),
    ('mobility-aids'), ('personal-care'), ('optical')
  ) AS w(slug)
  -- Only categories that actually exist can be expected to be linked; the
  -- migration joins on slug precisely so a missing one is skipped, not fatal.
  JOIN public.categories c ON c.slug = w.slug
  WHERE NOT EXISTS (
    SELECT 1 FROM kithly_reco.kind_category kc
    WHERE kc.occasion_kind = 'medical' AND kc.category_id = c.id
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: medical is not linked to %', v_missing;
  END IF;
  RAISE NOTICE 'PASS: every health shelf that exists is reachable';
END $$;

\echo '--- 3. the strengths that were already there were not restated ---'
DO $$
DECLARE v_strength numeric;
BEGIN
  SELECT kc.strength INTO v_strength
  FROM kithly_reco.kind_category kc
  JOIN public.categories c ON c.id = kc.category_id
  WHERE kc.occasion_kind = 'medical' AND c.slug = 'health-foods';

  -- ON CONFLICT DO NOTHING: 20260914070000 said 0.60 and keeps saying it.
  IF v_strength IS DISTINCT FROM 0.60 THEN
    RAISE EXCEPTION 'FAIL: health-foods is now %, expected the seeded 0.60', v_strength;
  END IF;
  RAISE NOTICE 'PASS: the original seed survives a second migration';
END $$;

\echo '--- 4. nothing was seeded outside the strength constraint ---'
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM kithly_reco.kind_category
  WHERE occasion_kind = 'medical' AND (strength <= 0 OR strength > 1);

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: % medical rows fall outside (0, 1]', v_bad;
  END IF;
  RAISE NOTICE 'PASS: every strength is a real weight';
END $$;

\echo '--- 5. the pharmacy counter outranks every other health shelf ---'
DO $$
DECLARE v_top text; v_n int;
BEGIN
  -- Deliberately not a count against another occasion: the harness seeds only
  -- the health shelves, so groceries has none and any such comparison would
  -- pass for the wrong reason. This asserts the editorial claim instead.
  SELECT c.slug INTO v_top
  FROM kithly_reco.kind_category kc
  JOIN public.categories c ON c.id = kc.category_id
  WHERE kc.occasion_kind = 'medical'
  ORDER BY kc.strength DESC, c.slug
  LIMIT 1;

  IF v_top IS DISTINCT FROM 'pharmacy' THEN
    RAISE EXCEPTION 'FAIL: % outranks pharmacy behind Health & Care', COALESCE(v_top, 'nothing');
  END IF;

  SELECT count(*) INTO v_n
  FROM kithly_reco.kind_category WHERE occasion_kind = 'medical';
  RAISE NOTICE 'PASS: pharmacy leads % shelves behind Health & Care', v_n;
END $$;

\echo '--- 6. applying the migration twice adds nothing ---'
DO $$
DECLARE v_before int; v_after int;
BEGIN
  SELECT count(*) INTO v_before
  FROM kithly_reco.kind_category WHERE occasion_kind = 'medical';

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

  SELECT count(*) INTO v_after
  FROM kithly_reco.kind_category WHERE occasion_kind = 'medical';

  IF v_after <> v_before THEN
    RAISE EXCEPTION 'FAIL: a re-run added % rows', v_after - v_before;
  END IF;
  RAISE NOTICE 'PASS: the seed is idempotent';
END $$;
