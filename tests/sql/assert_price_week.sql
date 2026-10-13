\set ON_ERROR_STOP on
\pset pager off

-- 20260926010000: costs are admin-only, a price week publishes atomically,
-- editing a bundle keeps its prices, and the catalogue report tells the truth.
--
-- Self-cleaning, so the file can be run repeatedly. admin_action_log refuses
-- deletes, so its assertions count rows by run id instead of expecting none.
DELETE FROM public.experiences WHERE slug LIKE 'pw-test-%';
DELETE FROM public.items WHERE name LIKE 'pw-test-%';
DELETE FROM public.shops WHERE name = 'pw-test-merchant';
DELETE FROM public.users WHERE id IN (
  'aaaaaaaa-0000-0000-0000-00000000c0a1',
  'bbbbbbbb-0000-0000-0000-00000000c0b1'
);

INSERT INTO public.users (id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000c0a1', 'admin'),
  ('bbbbbbbb-0000-0000-0000-00000000c0b1', 'sender');

INSERT INTO public.shops (name, owner_id)
SELECT 'KithLy', NULL WHERE NOT EXISTS (SELECT 1 FROM public.shops WHERE name = 'KithLy');
INSERT INTO public.shops (name, owner_id) VALUES ('pw-test-merchant', NULL);

INSERT INTO public.items (name, shop_id, price_zmw)
SELECT 'pw-test-rice', id, 10000 FROM public.shops WHERE name = 'KithLy';
INSERT INTO public.items (name, shop_id, price_zmw)
SELECT 'pw-test-oil', id, 5000 FROM public.shops WHERE name = 'KithLy';
INSERT INTO public.items (name, shop_id, price_zmw)
SELECT 'pw-test-cake', id, 20000 FROM public.shops WHERE name = 'pw-test-merchant';

INSERT INTO public.experiences (name, slug, is_active) VALUES ('Month', 'pw-test-month', true);
INSERT INTO public.experience_items (experience_id, item_id, quantity)
SELECT e.id, i.id, q.qty
FROM public.experiences e
CROSS JOIN (VALUES ('pw-test-rice', 2), ('pw-test-oil', 1), ('pw-test-cake', 1)) AS q(name, qty)
JOIN public.items i ON i.name = q.name
WHERE e.slug = 'pw-test-month';

\echo '--- 1. nobody but an admin can see what we pay ---'
DO $$
DECLARE n integer;
BEGIN
  INSERT INTO public.house_item_costs (item_id, sourced_cost_zmw, run_id)
  SELECT id, 9000, gen_random_uuid() FROM public.items WHERE name = 'pw-test-rice';

  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM public.house_item_costs;
    RAISE EXCEPTION 'FAIL: anon read house_item_costs (% rows)', n;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', 'bbbbbbbb-0000-0000-0000-00000000c0b1', true);
  SELECT count(*) INTO n FROM public.house_item_costs;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: a sender saw % cost rows', n;
  END IF;

  BEGIN
    UPDATE public.house_item_costs SET sourced_cost_zmw = 1;
    RAISE EXCEPTION 'FAIL: authenticated could write costs directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-00000000c0a1', true);
  SELECT count(*) INTO n FROM public.house_item_costs c
  JOIN public.items i ON i.id = c.item_id WHERE i.name = 'pw-test-rice';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: the admin saw % rows, expected 1', n;
  END IF;
  RAISE NOTICE 'PASS: anon refused, sender sees none, nobody writes directly, admin reads';
END $$;
RESET ROLE;
DELETE FROM public.house_item_costs WHERE item_id IN (SELECT id FROM public.items WHERE name LIKE 'pw-test-%');

\echo '--- 2. only an admin publishes, and a caller with no role is not one ---'
DO $$
BEGIN
  PERFORM set_config('test.uid', 'bbbbbbbb-0000-0000-0000-00000000c0b1', true);
  BEGIN
    PERFORM public.admin_publish_price_week(
      jsonb_build_object((SELECT id FROM public.items WHERE name = 'pw-test-rice')::text, 1),
      current_date + 7, gen_random_uuid());
    RAISE EXCEPTION 'FAIL: a sender published a price';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- Signed in, but no users row: current_user_role() is NULL here, which a
  -- plain <> comparison would have waved through.
  PERFORM set_config('test.uid', 'cccccccc-0000-0000-0000-00000000c0c1', true);
  BEGIN
    PERFORM public.admin_publish_price_week(
      jsonb_build_object((SELECT id FROM public.items WHERE name = 'pw-test-rice')::text, 1),
      current_date + 7, gen_random_uuid());
    RAISE EXCEPTION 'FAIL: a caller with no role published a price';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: sender and role-less caller both refused';
END $$;

\echo '--- 3. anon cannot even reach the functions ---'
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_publish_price_week(jsonb, date, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute admin_publish_price_week';
  END IF;
  IF has_function_privilege('anon', 'public.admin_catalogue_report()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute admin_catalogue_report';
  END IF;
  IF to_regprocedure('public.experience_price_health(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: experience_price_health still exists';
  END IF;
  RAISE NOTICE 'PASS: EXECUTE revoked from anon; the broken instrument is gone';
END $$;

\echo '--- 4. a publish sets the charged price, the lock and the window together ---'
DO $$
DECLARE
  v_rice uuid := (SELECT id FROM public.items WHERE name = 'pw-test-rice');
  v_oil  uuid := (SELECT id FROM public.items WHERE name = 'pw-test-oil');
  v_run  uuid := gen_random_uuid();
  v_n integer; v_price integer; v_locked integer; v_until date; v_logs integer;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-00000000c0a1', true);
  -- 1500.0 is a whole number of ngwee written as a decimal; it must be taken.
  v_n := public.admin_publish_price_week(
    jsonb_build_object(v_rice::text, 10000, v_oil::text, 1500.0),
    current_date + 7, v_run);
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL: published % items, expected 2', v_n; END IF;

  SELECT price_zmw INTO v_price FROM public.items WHERE id = v_rice;
  IF v_price <> 10500 THEN RAISE EXCEPTION 'FAIL: rice charges %, expected 10500 (5%% on 10000)', v_price; END IF;
  SELECT price_zmw INTO v_price FROM public.items WHERE id = v_oil;
  IF v_price <> 1575 THEN RAISE EXCEPTION 'FAIL: oil charges %, expected 1575', v_price; END IF;

  SELECT locked_price_zmw INTO v_locked FROM public.experience_items WHERE item_id = v_rice;
  IF v_locked IS DISTINCT FROM 10500 THEN RAISE EXCEPTION 'FAIL: rice line locked at %', v_locked; END IF;

  SELECT price_valid_until INTO v_until FROM public.experiences WHERE slug = 'pw-test-month';
  IF v_until IS DISTINCT FROM current_date + 7 THEN RAISE EXCEPTION 'FAIL: window is %', v_until; END IF;

  SELECT count(*) INTO v_logs FROM public.admin_action_log
  WHERE action = 'PRICE_WEEK_PUBLISHED' AND payload->>'run_id' = v_run::text;
  IF v_logs <> 1 THEN RAISE EXCEPTION 'FAIL: % audit rows for the run', v_logs; END IF;

  -- The merchant's line is theirs to price and must not have been touched.
  SELECT price_zmw INTO v_price FROM public.items WHERE name = 'pw-test-cake';
  IF v_price <> 20000 THEN RAISE EXCEPTION 'FAIL: the merchant item moved to %', v_price; END IF;
  RAISE NOTICE 'PASS: price, lock, window and audit row written as one; merchant untouched';
END $$;

\echo '--- 5. a run that names a merchant item is refused whole ---'
DO $$
DECLARE
  v_rice uuid := (SELECT id FROM public.items WHERE name = 'pw-test-rice');
  v_cake uuid := (SELECT id FROM public.items WHERE name = 'pw-test-cake');
  v_price integer;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-00000000c0a1', true);
  BEGIN
    PERFORM public.admin_publish_price_week(
      jsonb_build_object(v_rice::text, 99999, v_cake::text, 1),
      current_date + 7, gen_random_uuid());
    RAISE EXCEPTION 'FAIL: a run touching a merchant item was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  SELECT price_zmw INTO v_price FROM public.items WHERE id = v_rice;
  IF v_price <> 10500 THEN
    RAISE EXCEPTION 'FAIL: the house item moved to % in a refused run -- not atomic', v_price;
  END IF;
  RAISE NOTICE 'PASS: refused, and nothing in it landed';
END $$;

\echo '--- 6. a hold date outside today..+31 is refused ---'
DO $$
DECLARE v_rice uuid := (SELECT id FROM public.items WHERE name = 'pw-test-rice');
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-00000000c0a1', true);
  BEGIN
    PERFORM public.admin_publish_price_week(jsonb_build_object(v_rice::text, 1), current_date - 1, gen_random_uuid());
    RAISE EXCEPTION 'FAIL: a hold date in the past was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.admin_publish_price_week(jsonb_build_object(v_rice::text, 1), current_date + 400, gen_random_uuid());
    RAISE EXCEPTION 'FAIL: a hold date a year out was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.admin_publish_price_week(jsonb_build_object(v_rice::text, 12.5), current_date + 7, gen_random_uuid());
    RAISE EXCEPTION 'FAIL: a fractional ngwee cost was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: past, far-future and fractional inputs refused';
END $$;

\echo '--- 7. a retry keeps last week; a new run moves it ---'
DO $$
DECLARE
  v_rice uuid := (SELECT id FROM public.items WHERE name = 'pw-test-rice');
  v_run  uuid := gen_random_uuid();
  v_prev integer;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-00000000c0a1', true);
  -- Week two: rice goes 10000 -> 13000.
  PERFORM public.admin_publish_price_week(jsonb_build_object(v_rice::text, 13000), current_date + 7, v_run);
  SELECT previous_cost_zmw INTO v_prev FROM public.house_item_costs WHERE item_id = v_rice;
  IF v_prev IS DISTINCT FROM 10000 THEN RAISE EXCEPTION 'FAIL: previous is %, expected 10000', v_prev; END IF;

  -- The same run again -- a double click, a network retry.
  PERFORM public.admin_publish_price_week(jsonb_build_object(v_rice::text, 13000), current_date + 7, v_run);
  SELECT previous_cost_zmw INTO v_prev FROM public.house_item_costs WHERE item_id = v_rice;
  IF v_prev IS DISTINCT FROM 10000 THEN
    RAISE EXCEPTION 'FAIL: a retry overwrote last week with this week (previous now %)', v_prev;
  END IF;
  RAISE NOTICE 'PASS: retry idempotent; the week-on-week movement survives it';
END $$;

\echo '--- 8. the report measures the basket against the ceiling ---'
DO $$
DECLARE r jsonb; e jsonb;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-00000000c0a1', true);
  r := public.admin_catalogue_report();
  SELECT x INTO e FROM jsonb_array_elements(r->'experiences') x WHERE x->>'slug' = 'pw-test-month';
  IF e IS NULL THEN RAISE EXCEPTION 'FAIL: the test bundle is missing from the report'; END IF;

  -- Only rice has a previous cost: 2 x 10000 -> 2 x 13000 is +30%, over 20%.
  IF (e->>'movement_bps')::int <> 3000 THEN
    RAISE EXCEPTION 'FAIL: movement %, expected 3000', e->>'movement_bps';
  END IF;
  IF NOT (e->>'breached')::boolean THEN RAISE EXCEPTION 'FAIL: +30%% did not breach a 20%% ceiling'; END IF;

  -- Margin over costed house lines: rice 2 x (13650 - 13000) + oil (1575 - 1500).
  IF (e->>'margin_ngwee')::int <> 1375 THEN
    RAISE EXCEPTION 'FAIL: margin %, expected 1375', e->>'margin_ngwee';
  END IF;
  IF (e->>'house_lines')::int <> 2 OR (e->>'uncosted_lines')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: house/uncosted lines %/%', e->>'house_lines', e->>'uncosted_lines';
  END IF;
  IF (e->>'drift_lines')::int <> 0 OR (e->>'stale_lines')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: fresh run reported drift % / stale %', e->>'drift_lines', e->>'stale_lines';
  END IF;
  RAISE NOTICE 'PASS: movement, breach, margin and line counts correct';
END $$;

\echo '--- 9. a house price changed outside the run shows as drift ---'
DO $$
DECLARE r jsonb; e jsonb;
BEGIN
  UPDATE public.items SET price_zmw = price_zmw + 100 WHERE name = 'pw-test-oil';
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-00000000c0a1', true);
  r := public.admin_catalogue_report();
  SELECT x INTO e FROM jsonb_array_elements(r->'experiences') x WHERE x->>'slug' = 'pw-test-month';
  IF (e->>'drift_lines')::int <> 1 THEN RAISE EXCEPTION 'FAIL: drift %, expected 1', e->>'drift_lines'; END IF;
  IF (e->>'charged_ngwee')::int - (e->>'shown_ngwee')::int <> 100 THEN
    RAISE EXCEPTION 'FAIL: shown % vs charged % should differ by 100', e->>'shown_ngwee', e->>'charged_ngwee';
  END IF;
  RAISE NOTICE 'PASS: the shelf/till mismatch is reported, to the ngwee';
END $$;

\echo '--- 10. only an admin reads the report ---'
DO $$
BEGIN
  PERFORM set_config('test.uid', 'bbbbbbbb-0000-0000-0000-00000000c0b1', true);
  BEGIN
    PERFORM public.admin_catalogue_report();
    RAISE EXCEPTION 'FAIL: a sender read the catalogue report';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: sender refused';
END $$;

\echo '--- 11. saving a bundle keeps the prices of the lines that stayed ---'
DO $$
DECLARE
  v_exp  uuid := (SELECT id FROM public.experiences WHERE slug = 'pw-test-month');
  v_rice uuid := (SELECT id FROM public.items WHERE name = 'pw-test-rice');
  v_oil  uuid := (SELECT id FROM public.items WHERE name = 'pw-test-oil');
  v_locked integer; v_n integer;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-00000000c0a1', true);
  -- Keep rice (new quantity) and oil; drop the cake.
  PERFORM public.set_experience_items(v_exp, jsonb_build_array(
    jsonb_build_object('item_id', v_rice, 'quantity', 3),
    jsonb_build_object('item_id', v_oil,  'quantity', 1)));

  SELECT locked_price_zmw INTO v_locked FROM public.experience_items
  WHERE experience_id = v_exp AND item_id = v_rice;
  IF v_locked IS DISTINCT FROM 13650 THEN
    RAISE EXCEPTION 'FAIL: saving the bundle reset the rice lock to %', v_locked;
  END IF;
  SELECT count(*) INTO v_n FROM public.experience_items WHERE experience_id = v_exp;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL: % lines after removing one of three', v_n; END IF;
  SELECT quantity INTO v_n FROM public.experience_items WHERE experience_id = v_exp AND item_id = v_rice;
  IF v_n <> 3 THEN RAISE EXCEPTION 'FAIL: quantity %, expected 3', v_n; END IF;
  RAISE NOTICE 'PASS: kept lines keep their lock; removed line gone; quantity updated';
END $$;
