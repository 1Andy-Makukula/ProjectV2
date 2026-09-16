\set ON_ERROR_STOP on
\pset pager off

-- The placeholder-bundle snippet, exercised as the file that actually ships.
--
-- Worth covering because it is the rare script somebody runs by hand against
-- production, where a failure is found by the person running it rather than by
-- CI. It is pulled in with \i rather than copied, so the test cannot drift from
-- the snippet the way a duplicate would.
--
-- Everything below runs inside transactions that roll back. The suites share
-- one database and earlier ones leave items behind, so the pool the snippet
-- draws from is only knowable if this file narrows it first -- and a rollback
-- is also why no cleanup is needed at the end.

BEGIN;

-- Nothing else purchasable, so the pool is exactly the three below. That is
-- the shape of a real catalogue on day one, and the case where the snippet's
-- wrap-around actually has to work.
UPDATE public.items SET is_available = false;

INSERT INTO public.shops (id, name) VALUES
  ('5eed0000-0000-0000-0000-000000000001', 'seedtest-shop');

INSERT INTO public.items (id, shop_id, name, price_zmw, is_available, image_url) VALUES
  ('5eed0000-0000-0000-0000-00000000000a', '5eed0000-0000-0000-0000-000000000001',
   'seedtest-mealie-meal', 18000, true, 'https://example.test/mealie.jpg'),
  ('5eed0000-0000-0000-0000-00000000000b', '5eed0000-0000-0000-0000-000000000001',
   'seedtest-cooking-oil',  9500, true, NULL),
  ('5eed0000-0000-0000-0000-00000000000c', '5eed0000-0000-0000-0000-000000000001',
   'seedtest-sugar',        4200, true, 'https://example.test/sugar.jpg');

\echo '--- 1. the snippet runs and files every bundle under an occasion ---'
\i supabase/snippets/seed_placeholder_occasion_bundles.sql

DO $$
DECLARE n_bundles integer; n_untagged integer; n_inactive integer;
BEGIN
  SELECT count(*) INTO n_bundles FROM public.experiences WHERE slug LIKE 'placeholder-%';
  SELECT count(*) INTO n_untagged FROM public.experiences
   WHERE slug LIKE 'placeholder-%' AND occasion_kind IS NULL;
  SELECT count(*) INTO n_inactive FROM public.experiences
   WHERE slug LIKE 'placeholder-%' AND is_active = false;

  IF n_bundles <> 6 THEN
    RAISE EXCEPTION 'FAIL: % bundles created, expected 6', n_bundles;
  END IF;
  -- An untagged or inactive bundle never reaches a tile, which is the job.
  IF n_untagged > 0 THEN
    RAISE EXCEPTION 'FAIL: % bundles carry no occasion_kind', n_untagged;
  END IF;
  IF n_inactive > 0 THEN
    RAISE EXCEPTION 'FAIL: % bundles are inactive and so invisible', n_inactive;
  END IF;
  RAISE NOTICE 'PASS: six bundles, every one tagged and active';
END $$;

\echo '--- 2. a pool of three fills bundles that asked for four ---'
DO $$
DECLARE n_lines integer; thinnest integer; dupes integer;
BEGIN
  SELECT count(*) INTO n_lines
  FROM public.experience_items ei
  JOIN public.experiences e ON e.id = ei.experience_id
  WHERE e.slug LIKE 'placeholder-%';

  SELECT min(n) INTO thinnest FROM (
    SELECT count(ei.id) AS n
    FROM public.experiences e
    JOIN public.experience_items ei ON ei.experience_id = e.id
    WHERE e.slug LIKE 'placeholder-%'
    GROUP BY e.id
  ) t;

  SELECT count(*) INTO dupes FROM (
    SELECT ei.experience_id, ei.item_id
    FROM public.experience_items ei
    JOIN public.experiences e ON e.id = ei.experience_id
    WHERE e.slug LIKE 'placeholder-%'
    GROUP BY ei.experience_id, ei.item_id
    HAVING count(*) > 1
  ) d;

  -- The snippet asks for 4, 3, 3, 4, 3, 2 lines. Against a three-item pool the
  -- unique constraint caps each at three, so 3+3+3+3+3+2 = 17. Change the line
  -- counts in the snippet and this number moves with them, deliberately.
  IF n_lines <> 17 THEN
    RAISE EXCEPTION 'FAIL: % lines across the six bundles, expected 17', n_lines;
  END IF;
  IF thinnest < 2 THEN
    RAISE EXCEPTION 'FAIL: thinnest bundle holds only % lines', thinnest;
  END IF;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'FAIL: % bundles list the same item twice', dupes;
  END IF;
  RAISE NOTICE 'PASS: wraps a short pool, and never lists an item against itself';
END $$;

\echo '--- 3. no bundle is left empty ---'
DO $$
DECLARE empty_ones text;
BEGIN
  SELECT string_agg(e.slug, ', ') INTO empty_ones
  FROM public.experiences e
  LEFT JOIN public.experience_items ei ON ei.experience_id = e.id
  WHERE e.slug LIKE 'placeholder-%'
  GROUP BY e.id, e.slug
  HAVING count(ei.id) = 0;

  IF empty_ones IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: empty bundles: %', empty_ones;
  END IF;
  RAISE NOTICE 'PASS: nothing priced at zero because it holds nothing';
END $$;

\echo '--- 4. the tile gets a picture, borrowed from the first item that has one ---'
DO $$
DECLARE n_with_image integer;
BEGIN
  SELECT count(*) INTO n_with_image FROM public.experiences
  WHERE slug LIKE 'placeholder-%' AND image_url IS NOT NULL;

  -- Two of the three fixture items carry one, and every bundle draws from all
  -- three, so a bundle with no picture means the borrowing is broken.
  IF n_with_image <> 6 THEN
    RAISE EXCEPTION 'FAIL: % of 6 bundles borrowed a picture', n_with_image;
  END IF;
  RAISE NOTICE 'PASS: every tile has a picture without a new asset being made';
END $$;

\echo '--- 5. running it again refreshes rather than duplicates ---'
\i supabase/snippets/seed_placeholder_occasion_bundles.sql

DO $$
DECLARE n_bundles integer; n_lines integer;
BEGIN
  SELECT count(*) INTO n_bundles FROM public.experiences WHERE slug LIKE 'placeholder-%';
  SELECT count(*) INTO n_lines
  FROM public.experience_items ei
  JOIN public.experiences e ON e.id = ei.experience_id
  WHERE e.slug LIKE 'placeholder-%';

  IF n_bundles <> 6 THEN
    RAISE EXCEPTION 'FAIL: the second run left % bundles', n_bundles;
  END IF;
  IF n_lines <> 17 THEN
    RAISE EXCEPTION 'FAIL: the second run left % lines -- contents appended, not replaced', n_lines;
  END IF;
  RAISE NOTICE 'PASS: idempotent, so it is safe to re-run after adding stock';
END $$;

ROLLBACK;

\echo '--- 6. an empty catalogue is a notice, not a crash ---'
-- A fresh install has nothing purchasable at all. The snippet has to say so
-- and stop, rather than leave half a mosaic or raise into somebody's console.
BEGIN;
UPDATE public.items SET is_available = false;
\i supabase/snippets/seed_placeholder_occasion_bundles.sql

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.experiences WHERE slug LIKE 'placeholder-%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: % bundles built from an empty catalogue', n;
  END IF;
  -- Reaching here at all means the snippet returned cleanly: ON_ERROR_STOP
  -- would have aborted the whole file otherwise.
  RAISE NOTICE 'PASS: empty catalogue builds nothing and fails at nothing';
END $$;
ROLLBACK;
