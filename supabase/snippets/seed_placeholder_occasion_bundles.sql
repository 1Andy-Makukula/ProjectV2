-- =============================================================================
-- Placeholder occasion bundles
--
-- WHAT THIS IS FOR
-- ----------------
-- The occasion mosaic on the front door is derived from what is actually
-- curated: a kind only gets a tile once at least one active experience is
-- filed under it. That is deliberate -- a tile can never lead to an empty page
-- -- but it does mean the new front door shows nothing at all until somebody
-- tags some bundles.
--
-- This fills that gap with real bundles built from whatever is genuinely in
-- the catalogue, so the mosaic, the occasion pages and the checkout path can
-- all be walked end to end before any merchandising has been done.
--
-- THESE ARE PLACEHOLDERS. Every slug begins `placeholder-`, so replacing them
-- later is:
--
--     DELETE FROM public.experiences WHERE slug LIKE 'placeholder-%';
--
-- which also removes their lines, via ON DELETE CASCADE on experience_items.
--
-- SAFE TO RUN TWICE
-- -----------------
-- Bundles are upserted on slug and their contents replaced, so re-running
-- refreshes them rather than duplicating them. It creates no items, no shops
-- and no orders, and touches nothing that was not created by this script.
--
-- REQUIRES: 20260916010000_experience_occasion_kind.sql to have been pushed.
--
-- Run as the database owner (the Supabase SQL editor is fine). It writes to
-- experience_items directly rather than through set_experience_items, because
-- that RPC checks auth.uid() and there is no signed-in user in a SQL session.
-- =============================================================================

DO $$
DECLARE
  spec       record;
  v_exp_id   uuid;
  v_item     record;
  v_pool     integer;
  v_offset   integer := 0;
  v_sort     integer;
  v_image    text;
  v_made     integer := 0;
BEGIN
  -- The pool every bundle draws from: things somebody could actually buy.
  SELECT count(*) INTO v_pool
  FROM public.items
  WHERE is_available IS NOT FALSE
    AND is_quote_only = false
    AND price_zmw > 0;

  IF v_pool = 0 THEN
    RAISE NOTICE 'No purchasable items in the catalogue -- nothing to build bundles from.';
    RETURN;
  END IF;

  RAISE NOTICE 'Building placeholder bundles from a pool of % items.', v_pool;

  FOR spec IN
    SELECT * FROM (VALUES
      ('placeholder-monthly-groceries', 'Monthly groceries',  'groceries',
       'The month''s staples, collected from a shop they already use.',      4, 10),
      ('placeholder-birthday-parcel',   'Birthday parcel',    'birthday',
       'Something that arrives on the day itself.',                          3, 20),
      ('placeholder-graduation',        'Graduation blessing','graduation',
       'For the walk across the stage, and the years behind it.',            3, 30),
      ('placeholder-school-prep',       'Term prep',          'school_fees',
       'Books, shoes and stationery, sorted before the term starts.',        4, 40),
      ('placeholder-new-baby',          'New baby basket',    'new_baby',
       'What a new mother runs out of first.',                               3, 50),
      ('placeholder-pharmacy-run',      'Pharmacy run',       'medical',
       'A refill collected close to home, paid for from abroad.',            2, 60)
    ) AS t(slug, name, kind, tagline, line_count, sort_order)
  LOOP
    INSERT INTO public.experiences (name, slug, tagline, occasion_kind, is_active, sort_order)
    VALUES (spec.name, spec.slug, spec.tagline, spec.kind, true, spec.sort_order)
    ON CONFLICT (slug) DO UPDATE
      SET name          = EXCLUDED.name,
          tagline       = EXCLUDED.tagline,
          occasion_kind = EXCLUDED.occasion_kind,
          is_active     = true,
          sort_order    = EXCLUDED.sort_order,
          updated_at    = now()
    RETURNING id INTO v_exp_id;

    -- Replaced wholesale, so a re-run refreshes rather than appends.
    DELETE FROM public.experience_items WHERE experience_id = v_exp_id;

    v_sort := 0;
    v_image := NULL;

    -- Each bundle starts where the last one stopped and wraps around the pool,
    -- so six bundles drawn from three items still differ from one another
    -- instead of all being the same three.
    FOR v_item IN
      WITH pool AS (
        SELECT id,
               image_url,
               (row_number() OVER (ORDER BY created_at NULLS LAST, id)) - 1 AS rn
        FROM public.items
        WHERE is_available IS NOT FALSE
          AND is_quote_only = false
          AND price_zmw > 0
      ),
      picks AS (
        SELECT ((v_offset + g) % v_pool) AS rn
        FROM generate_series(0, spec.line_count - 1) AS g
      )
      SELECT pool.id, pool.image_url
      FROM pool
      JOIN picks ON picks.rn = pool.rn
      ORDER BY pool.rn
    LOOP
      INSERT INTO public.experience_items (experience_id, item_id, quantity, sort_order)
      VALUES (v_exp_id, v_item.id, 1, v_sort)
      ON CONFLICT (experience_id, item_id) DO NOTHING;

      v_sort := v_sort + 1;
      v_image := COALESCE(v_image, v_item.image_url);
    END LOOP;

    -- The tile borrows its picture from the bundle, and the bundle borrows its
    -- picture from the first item that has one. No new assets to maintain.
    UPDATE public.experiences SET image_url = v_image WHERE id = v_exp_id;

    v_offset := v_offset + spec.line_count;
    v_made := v_made + 1;
  END LOOP;

  RAISE NOTICE 'Done: % placeholder bundles across % occasions.', v_made, v_made;
  RAISE NOTICE 'Remove them later with: DELETE FROM public.experiences WHERE slug LIKE ''placeholder-%%'';';
END $$;

-- What the front door will now show, in the order the mosaic will show it.
SELECT
  e.occasion_kind,
  e.name,
  e.slug,
  count(ei.id)                                   AS lines,
  count(*) FILTER (WHERE e.image_url IS NOT NULL) AS has_image
FROM public.experiences e
LEFT JOIN public.experience_items ei ON ei.experience_id = e.id
WHERE e.slug LIKE 'placeholder-%'
GROUP BY e.id, e.occasion_kind, e.name, e.slug, e.sort_order
ORDER BY e.sort_order;
