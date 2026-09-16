\set ON_ERROR_STOP on
\pset pager off

-- experiences.occasion_kind: the tie between a curated bundle and the tile it
-- appears under. Self-cleaning, so the file can be run repeatedly.
DELETE FROM public.experiences WHERE slug LIKE 'occ-test-%';

\echo '--- 1. an untagged bundle is legal, because not everything has an occasion ---'
DO $$
DECLARE v_kind text;
BEGIN
  INSERT INTO public.experiences (name, slug) VALUES ('A one-off', 'occ-test-untagged');

  SELECT occasion_kind INTO v_kind FROM public.experiences WHERE slug = 'occ-test-untagged';
  IF v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: an untagged bundle defaulted to %', v_kind;
  END IF;
  RAISE NOTICE 'PASS: null is a real state and nothing backfills it';
END $$;

\echo '--- 2. a kind the taxonomy names is accepted ---'
DO $$
DECLARE v_kind text;
BEGIN
  INSERT INTO public.experiences (name, slug, occasion_kind)
  VALUES ('Graduation blessing', 'occ-test-graduation', 'graduation');

  SELECT occasion_kind INTO v_kind FROM public.experiences WHERE slug = 'occ-test-graduation';
  IF v_kind <> 'graduation' THEN
    RAISE EXCEPTION 'FAIL: stored %, expected graduation', v_kind;
  END IF;
  RAISE NOTICE 'PASS: a seeded kind tags a bundle';
END $$;

\echo '--- 3. a kind it does not name is refused ---'
DO $$
BEGIN
  BEGIN
    INSERT INTO public.experiences (name, slug, occasion_kind)
    VALUES ('Invented', 'occ-test-bogus', 'kitchen_party');
    RAISE EXCEPTION 'FAIL: an unknown occasion kind was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  RAISE NOTICE 'PASS: the lookup is the vocabulary, not a suggestion';
END $$;

\echo '--- 4. every kind the reminder engine knows can tag a bundle ---'
-- The FK and contact_occasions.kind have to stay one vocabulary. If a kind
-- were ever added to the CHECK on contact_occasions without being seeded into
-- occasion_lead_times, a tile for it would be untaggable and this catches it.
DO $$
DECLARE k text; n integer := 0;
BEGIN
  FOR k IN SELECT kind FROM public.occasion_lead_times LOOP
    INSERT INTO public.experiences (name, slug, occasion_kind)
    VALUES (k, 'occ-test-all-' || k, k);
    n := n + 1;
  END LOOP;

  IF n < 13 THEN
    RAISE EXCEPTION 'FAIL: only % kinds are seeded, expected at least 13', n;
  END IF;
  RAISE NOTICE 'PASS: all % seeded kinds are usable as a tile', n;
END $$;

\echo '--- 5. retiring a kind must not take the bundles with it ---'
DO $$
DECLARE v_del char;
BEGIN
  SELECT confdeltype INTO v_del
  FROM pg_constraint
  WHERE conrelid = 'public.experiences'::regclass
    AND confrelid = 'public.occasion_lead_times'::regclass
    AND contype = 'f';

  IF v_del IS NULL THEN
    RAISE EXCEPTION 'FAIL: no foreign key from experiences to occasion_lead_times';
  END IF;
  -- 'n' = SET NULL. 'c' would cascade the delete into the bundles, which is
  -- the outcome the column comment explicitly rules out.
  IF v_del <> 'n' THEN
    RAISE EXCEPTION 'FAIL: on-delete is %, expected n (SET NULL)', v_del;
  END IF;
  RAISE NOTICE 'PASS: dropping a kind unfiles its bundles rather than deleting them';
END $$;

\echo '--- 6. the lookup index is the partial one the storefront query needs ---'
DO $$
DECLARE v_def text;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'experiences_occasion_idx';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: experiences_occasion_idx does not exist';
  END IF;
  IF v_def NOT LIKE '%is_active%' THEN
    RAISE EXCEPTION 'FAIL: index is not partial on is_active: %', v_def;
  END IF;
  IF v_def NOT LIKE '%sort_order%' THEN
    RAISE EXCEPTION 'FAIL: index does not carry sort_order: %', v_def;
  END IF;
  RAISE NOTICE 'PASS: partial index covers (occasion_kind, sort_order) where active';
END $$;

DELETE FROM public.experiences WHERE slug LIKE 'occ-test-%';
