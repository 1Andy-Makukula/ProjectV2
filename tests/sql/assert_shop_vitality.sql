\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.users WHERE id IN (
  'aaaa1111-0000-0000-0000-000000000001',
  'aaaa1111-0000-0000-0000-000000000002'
);
DELETE FROM public.shops WHERE id = 'bbbb2222-0000-0000-0000-000000000001';

INSERT INTO public.users (id, role) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'merchant'),
  ('aaaa1111-0000-0000-0000-000000000002', 'admin');

INSERT INTO public.shops (id, name, is_active) VALUES
  ('bbbb2222-0000-0000-0000-000000000001', 'Mama Africa', true);
INSERT INTO public.merchant_shops (user_id, shop_id) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000001');

\echo '--- 1. a merchant cannot promote their own item ---'
DO $$
DECLARE pick boolean; badge text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', 'aaaa1111-0000-0000-0000-000000000001', true);

  -- Asking for the Weekly Pick slot on the way in.
  INSERT INTO public.items (id, shop_id, name, price_zmw, is_weekly_pick, promo_badge_text)
  VALUES ('cccc3333-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000001',
          'Chocolate cake', 20000, true, 'BEST IN LUSAKA');

  SELECT is_weekly_pick, promo_badge_text INTO pick, badge
  FROM public.items WHERE id = 'cccc3333-0000-0000-0000-000000000001';

  IF pick IS TRUE THEN
    RAISE EXCEPTION 'FAIL: a merchant put their own item in the Weekly Pick rail';
  END IF;
  IF badge IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: a merchant wrote their own promo badge (%)', badge;
  END IF;
  RAISE NOTICE 'PASS: insert stripped the governance fields';
  RESET ROLE;
END $$;

\echo '--- 2. nor by updating afterwards ---'
DO $$
DECLARE pick boolean; nm text;
BEGIN
  -- The platform grants it.
  UPDATE public.items SET is_weekly_pick = true, promo_badge_text = 'EDITOR''S CHOICE'
   WHERE id = 'cccc3333-0000-0000-0000-000000000001';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', 'aaaa1111-0000-0000-0000-000000000001', true);

  -- The merchant tries to take it away and rename their own item in one write.
  UPDATE public.items
     SET name = 'Chocolate cake (large)', is_weekly_pick = false, promo_badge_text = 'MINE'
   WHERE id = 'cccc3333-0000-0000-0000-000000000001';

  SELECT is_weekly_pick, name INTO pick, nm
  FROM public.items WHERE id = 'cccc3333-0000-0000-0000-000000000001';

  IF pick IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: a merchant cleared a platform-granted Weekly Pick';
  END IF;
  -- And the legitimate half of the same write must still have landed, or every
  -- merchant form that sends the whole row back would silently stop working.
  IF nm <> 'Chocolate cake (large)' THEN
    RAISE EXCEPTION 'FAIL: the merchant''s own edit was lost (name is %)', nm;
  END IF;
  RAISE NOTICE 'PASS: governance held, the merchant''s own edit went through';
  RESET ROLE;
END $$;

\echo '--- 3. an admin still curates ---'
DO $$
DECLARE pick boolean;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', 'aaaa1111-0000-0000-0000-000000000002', true);

  UPDATE public.items SET is_weekly_pick = false
   WHERE id = 'cccc3333-0000-0000-0000-000000000001';

  SELECT is_weekly_pick INTO pick FROM public.items
   WHERE id = 'cccc3333-0000-0000-0000-000000000001';
  IF pick IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: an admin could not change the Weekly Pick';
  END IF;
  RAISE NOTICE 'PASS: admin merchandising unaffected';
  RESET ROLE;
END $$;

\echo '--- 4. an empty shop scores low and is told what to do first ---'
DO $$
DECLARE sc integer; nudge text;
BEGIN
  DELETE FROM public.items WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';

  SELECT score INTO sc FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';
  nudge := public.shop_vitality_nudge('bbbb2222-0000-0000-0000-000000000001');

  IF sc > 20 THEN RAISE EXCEPTION 'FAIL: an empty shop scored %', sc; END IF;
  IF nudge NOT LIKE 'Add your first item%' THEN
    RAISE EXCEPTION 'FAIL: unexpected first nudge: %', nudge;
  END IF;
  RAISE NOTICE 'PASS: empty shop scores %, told to add an item', sc;
END $$;

\echo '--- 5. filling the shop raises the score, step by step ---'
DO $$
DECLARE before_score integer; after_covers integer; after_gallery integer; nudge text;
BEGIN
  -- Five items, no photographs at all.
  INSERT INTO public.items (id, shop_id, name, price_zmw)
  SELECT gen_random_uuid(), 'bbbb2222-0000-0000-0000-000000000001', 'Item ' || i, 1000 * i
  FROM generate_series(1, 5) i;

  SELECT score INTO before_score FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';

  nudge := public.shop_vitality_nudge('bbbb2222-0000-0000-0000-000000000001');
  IF nudge NOT LIKE '%no photograph%' THEN
    RAISE EXCEPTION 'FAIL: a shop with uncovered items was told: %', nudge;
  END IF;

  -- Give every item a cover.
  UPDATE public.items SET image_url = 'https://example.test/cover.jpg'
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';

  SELECT score INTO after_covers FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';
  IF after_covers <= before_score THEN
    RAISE EXCEPTION 'FAIL: adding covers did not raise the score (% -> %)', before_score, after_covers;
  END IF;

  -- And five photographs each.
  INSERT INTO public.item_images (item_id, image_url, sort_order)
  SELECT i.id, 'https://example.test/' || n || '.jpg', n
  FROM public.items i, generate_series(0, 4) n
  WHERE i.shop_id = 'bbbb2222-0000-0000-0000-000000000001';

  SELECT score INTO after_gallery FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';
  IF after_gallery <= after_covers THEN
    RAISE EXCEPTION 'FAIL: filling galleries did not raise the score (% -> %)', after_covers, after_gallery;
  END IF;

  RAISE NOTICE 'PASS: % -> % -> % as the shop filled up', before_score, after_covers, after_gallery;
END $$;

\echo '--- 6. a new shop is not punished for having no orders or ratings ---'
DO $$
DECLARE fulfil numeric; v_rating numeric;
BEGIN
  SELECT fulfilment, rating INTO fulfil, v_rating FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';

  IF fulfil <> 0.5 THEN
    RAISE EXCEPTION 'FAIL: a shop with no order history scored % on fulfilment, expected neutral 0.5', fulfil;
  END IF;
  IF v_rating <> 0.5 THEN
    RAISE EXCEPTION 'FAIL: an unrated shop scored % on rating, expected neutral 0.5', v_rating;
  END IF;
  RAISE NOTICE 'PASS: unknown is neutral, not bad';
END $$;

\echo '--- 7. a fulfilment rate only counts once there is enough of it ---'
DO $$
DECLARE fulfil numeric;
BEGIN
  -- Four orders, all failed. Still too few to mean anything.
  INSERT INTO public.shop_orders (shop_id, claim_status)
  SELECT 'bbbb2222-0000-0000-0000-000000000001', 'EXPIRED' FROM generate_series(1, 4);

  SELECT fulfilment INTO fulfil FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';
  IF fulfil <> 0.5 THEN
    RAISE EXCEPTION 'FAIL: four orders were enough to move fulfilment to %', fulfil;
  END IF;

  -- A fifth crosses the threshold, and now the record counts.
  INSERT INTO public.shop_orders (shop_id, claim_status)
  VALUES ('bbbb2222-0000-0000-0000-000000000001', 'EXPIRED');

  SELECT fulfilment INTO fulfil FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';
  IF fulfil <> 0 THEN
    RAISE EXCEPTION 'FAIL: five uncollected orders scored % on fulfilment', fulfil;
  END IF;
  RAISE NOTICE 'PASS: neutral below five orders, real above';
END $$;

\echo '--- 8. hours and collections both register ---'
DO $$
DECLARE before_score integer; after_score integer; nudge text;
BEGIN
  SELECT score INTO before_score FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';

  nudge := public.shop_vitality_nudge('bbbb2222-0000-0000-0000-000000000001');
  IF nudge NOT LIKE 'Group your items%' THEN
    RAISE EXCEPTION 'FAIL: an ungrouped shop was told: %', nudge;
  END IF;

  INSERT INTO public.shop_collections (shop_id, name)
  VALUES ('bbbb2222-0000-0000-0000-000000000001', 'Weekday lunches');
  UPDATE public.shops SET opening_hours = '{"mon":"08:00-17:00"}'::jsonb
   WHERE id = 'bbbb2222-0000-0000-0000-000000000001';

  SELECT score INTO after_score FROM public.shop_vitality
   WHERE shop_id = 'bbbb2222-0000-0000-0000-000000000001';
  IF after_score <= before_score THEN
    RAISE EXCEPTION 'FAIL: collections and hours did not raise the score (% -> %)', before_score, after_score;
  END IF;
  RAISE NOTICE 'PASS: % -> % with hours and a collection', before_score, after_score;
END $$;
