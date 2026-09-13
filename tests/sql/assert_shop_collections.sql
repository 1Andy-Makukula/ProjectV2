\set ON_ERROR_STOP on
\pset pager off

-- Self-cleaning so the file can be re-run against the same database.
DELETE FROM public.users WHERE id IN (
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
DELETE FROM public.shops WHERE id IN (
  'dddddddd-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000002'
);
DELETE FROM public.categories WHERE slug IN ('test-bakery', 'test-drinks');

INSERT INTO public.users (id, role) VALUES
  ('33333333-3333-3333-3333-333333333333', 'merchant'),
  ('44444444-4444-4444-4444-444444444444', 'merchant');

INSERT INTO public.shops (id, owner_id, name) VALUES
  ('dddddddd-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Mama Africa'),
  ('dddddddd-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Rival Shop');

INSERT INTO public.merchant_shops (user_id, shop_id) VALUES
  ('33333333-3333-3333-3333-333333333333', 'dddddddd-0000-0000-0000-000000000001'),
  ('44444444-4444-4444-4444-444444444444', 'dddddddd-0000-0000-0000-000000000002');

INSERT INTO public.categories (id, name, slug) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'Bakery', 'test-bakery'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'Drinks', 'test-drinks');

-- Five items in Mama Africa: four available, one not. One belongs to the rival.
INSERT INTO public.items (id, shop_id, category_id, name, is_available) VALUES
  ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Chocolate cake', true),
  ('ffffffff-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Scones',         true),
  ('ffffffff-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002', 'Maheu',          true),
  ('ffffffff-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000001', NULL,                                   'Unfiled thing',  true),
  ('ffffffff-0000-0000-0000-000000000005', 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Sold out loaf',  false),
  ('ffffffff-0000-0000-0000-000000000009', 'dddddddd-0000-0000-0000-000000000002', NULL,                                   'Rival item',     true);

\echo '--- 1. no collections, categories present -> category grouping ---'
DO $$
DECLARE src text; groups integer; items integer;
BEGIN
  SELECT DISTINCT group_source INTO src
  FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000001');
  IF src <> 'category' THEN
    RAISE EXCEPTION 'FAIL: expected category grouping, got %', src;
  END IF;

  SELECT count(DISTINCT group_key), count(DISTINCT item_id) INTO groups, items
  FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000001');

  -- Bakery, Drinks, and the catch-all for the uncategorised item.
  IF groups <> 3 THEN RAISE EXCEPTION 'FAIL: expected 3 groups, got %', groups; END IF;
  RAISE NOTICE 'PASS: category grouping, % groups, % items', groups, items;
END $$;

\echo '--- 2. an unavailable item is invisible to a shopper, and to the grouping ---'
DO $$
DECLARE items integer;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(DISTINCT item_id) INTO items
  FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000001');
  IF items <> 4 THEN
    RAISE EXCEPTION 'FAIL: anon sees % items, expected 4 (the sold-out loaf must not appear)', items;
  END IF;
  RAISE NOTICE 'PASS: SECURITY INVOKER lets items_public_read decide -- 4 of 5 visible';
  RESET ROLE;
END $$;

\echo '--- 3. cross-shop membership is structurally impossible ---'
INSERT INTO public.shop_collections (id, shop_id, name, sort_order) VALUES
  ('99999999-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'Weekday lunches', 0);
DO $$
DECLARE failures text[] := '{}';
BEGIN
  BEGIN
    INSERT INTO public.shop_collection_items (collection_id, item_id, shop_id)
    VALUES ('99999999-0000-0000-0000-000000000001',
            'ffffffff-0000-0000-0000-000000000009',
            'dddddddd-0000-0000-0000-000000000001');
    failures := failures || 'rival item entered this shop collection';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.shop_collection_items (collection_id, item_id, shop_id)
    VALUES ('99999999-0000-0000-0000-000000000001',
            'ffffffff-0000-0000-0000-000000000009',
            'dddddddd-0000-0000-0000-000000000002');
    failures := failures || 'rival item entered via spoofed shop_id';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: cross-shop membership impossible in both directions';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 4. an EMPTY collection must not switch the shop into collection mode ---'
DO $$
DECLARE src text;
BEGIN
  SELECT DISTINCT group_source INTO src
  FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000001');
  IF src <> 'category' THEN
    RAISE EXCEPTION
      'FAIL: an empty collection switched grouping to %, stranding every item in the trailing group', src;
  END IF;
  RAISE NOTICE 'PASS: empty collection ignored';
END $$;

\echo '--- 5. filled collection wins, and NOTHING is hidden ---'
INSERT INTO public.shop_collection_items (collection_id, item_id, shop_id, sort_order) VALUES
  ('99999999-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 0);
DO $$
DECLARE src text; grouped integer; visible integer; uncollected integer;
BEGIN
  SET LOCAL ROLE anon;

  SELECT DISTINCT group_source INTO src
  FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000001');
  IF src <> 'collection' THEN
    RAISE EXCEPTION 'FAIL: expected collection grouping, got %', src;
  END IF;

  SELECT count(DISTINCT item_id) INTO grouped
  FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000001');

  SELECT count(*) INTO visible
  FROM public.items WHERE shop_id = 'dddddddd-0000-0000-0000-000000000001';

  -- The whole point. One item is filed; the other three must still appear.
  IF grouped <> visible THEN
    RAISE EXCEPTION
      'FAIL: grouping hides items -- % of % visible items returned', grouped, visible;
  END IF;

  SELECT count(*) INTO uncollected
  FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000001')
  WHERE group_key = 'uncollected';
  IF uncollected <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected 3 items in the trailing group, got %', uncollected;
  END IF;

  RAISE NOTICE 'PASS: collection grouping, all % items still reachable, % in the trailing group',
    grouped, uncollected;
  RESET ROLE;
END $$;

\echo '--- 6. flat when there is neither ---'
DO $$
DECLARE src text; n integer;
BEGIN
  UPDATE public.items SET category_id = NULL WHERE shop_id = 'dddddddd-0000-0000-0000-000000000002';
  SELECT DISTINCT group_source INTO src
  FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000002');
  IF src <> 'flat' THEN RAISE EXCEPTION 'FAIL: expected flat, got %', src; END IF;

  SELECT count(*) INTO n FROM public.shop_item_groups('dddddddd-0000-0000-0000-000000000002');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 item flat, got %', n; END IF;
  RAISE NOTICE 'PASS: flat grouping when a shop has neither layer';
END $$;

\echo '--- 7. only the owning merchant may write a collection ---'
DO $$
BEGIN
  SET LOCAL ROLE authenticated;

  PERFORM set_config('test.uid', '44444444-4444-4444-4444-444444444444', true);
  BEGIN
    INSERT INTO public.shop_collections (shop_id, name)
    VALUES ('dddddddd-0000-0000-0000-000000000001', 'Hostile takeover');
    RAISE EXCEPTION 'FAIL: a rival merchant wrote a collection into another shop';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: rival merchant refused';
  END;

  PERFORM set_config('test.uid', '33333333-3333-3333-3333-333333333333', true);
  INSERT INTO public.shop_collections (shop_id, name)
  VALUES ('dddddddd-0000-0000-0000-000000000001', 'Owner can write');
  RAISE NOTICE 'PASS: owning merchant may write';

  RESET ROLE;
END $$;
