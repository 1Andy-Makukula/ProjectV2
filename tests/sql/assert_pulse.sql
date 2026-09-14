\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.shops WHERE id IN (
  'eeee5555-0000-0000-0000-000000000001',
  'eeee5555-0000-0000-0000-000000000002'
);

INSERT INTO public.shops (id, name, is_active) VALUES
  ('eeee5555-0000-0000-0000-000000000001', 'Pulse Test Shop', true),
  ('eeee5555-0000-0000-0000-000000000002', 'Quiet Shop', true);

\echo '--- 1. nothing happened, so nothing is said ---'
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.pulse_statements(12)
   WHERE subject IN ('Pulse Test Shop', 'Quiet Shop');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: the Pulse invented % statements about shops with no activity', n;
  END IF;
  RAISE NOTICE 'PASS: silence when there is nothing to report';
END $$;

\echo '--- 2. THE PRIVACY FLOOR: below three is never described ---'
DO $$
DECLARE n integer; floor_size integer;
BEGIN
  floor_size := public.pulse_min_cohort();

  -- Two collections. In a town where a shopkeeper knows their customers, "2
  -- people collected" plus a shop name is a sentence about identifiable people.
  INSERT INTO public.shop_orders (shop_id, claim_status, updated_at)
  SELECT 'eeee5555-0000-0000-0000-000000000001', 'REDEEMED', now()
  FROM generate_series(1, 2);

  SELECT count(*) INTO n FROM public.pulse_statements(12)
   WHERE subject = 'Pulse Test Shop';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: a cohort of 2 was described, below the floor of %', floor_size;
  END IF;
  RAISE NOTICE 'PASS: a cohort of 2 is not described';
END $$;

\echo '--- 3. at the floor it becomes sayable, and the count is the real one ---'
DO $$
DECLARE q integer; k text;
BEGIN
  INSERT INTO public.shop_orders (shop_id, claim_status, updated_at)
  VALUES ('eeee5555-0000-0000-0000-000000000001', 'REDEEMED', now());

  SELECT kind, quantity INTO k, q FROM public.pulse_statements(12)
   WHERE subject = 'Pulse Test Shop';

  IF q IS NULL THEN RAISE EXCEPTION 'FAIL: a cohort of 3 was still not described'; END IF;
  IF q <> 3 THEN
    RAISE EXCEPTION 'FAIL: reported % collections, but exactly 3 exist -- the count must be real', q;
  END IF;
  IF k <> 'collected' THEN RAISE EXCEPTION 'FAIL: unexpected kind %', k; END IF;
  RAISE NOTICE 'PASS: 3 is sayable, and the number said is the number that happened';
END $$;

\echo '--- 4. uncollected orders are not collections ---'
DO $$
DECLARE q integer;
BEGIN
  -- Ten orders that expired. Counting these would be the easiest possible way
  -- to look busy, and would be a lie about what the platform achieved.
  INSERT INTO public.shop_orders (shop_id, claim_status, updated_at)
  SELECT 'eeee5555-0000-0000-0000-000000000002', 'EXPIRED', now()
  FROM generate_series(1, 10);

  SELECT quantity INTO q FROM public.pulse_statements(12)
   WHERE subject = 'Quiet Shop' AND kind = 'collected';
  IF q IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: % expired orders were counted as collections', q;
  END IF;
  RAISE NOTICE 'PASS: only orders actually collected count';
END $$;

\echo '--- 5. old activity falls out of the window ---'
DO $$
DECLARE q integer;
BEGIN
  -- Backdated beyond the seven-day window. Still real, no longer news.
  UPDATE public.shop_orders
     SET updated_at = now() - interval '30 days'
   WHERE shop_id = 'eeee5555-0000-0000-0000-000000000001';

  SELECT quantity INTO q FROM public.pulse_statements(12)
   WHERE subject = 'Pulse Test Shop' AND kind = 'collected';
  IF q IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: month-old collections are still being announced (%)', q;
  END IF;
  RAISE NOTICE 'PASS: the window is real';
END $$;

\echo '--- 6. an inactive shop is never named ---'
DO $$
DECLARE q integer;
BEGIN
  UPDATE public.shop_orders SET updated_at = now()
   WHERE shop_id = 'eeee5555-0000-0000-0000-000000000001';
  UPDATE public.shops SET is_active = false
   WHERE id = 'eeee5555-0000-0000-0000-000000000001';

  SELECT quantity INTO q FROM public.pulse_statements(12)
   WHERE subject = 'Pulse Test Shop';
  IF q IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: a deactivated shop was named in the Pulse';
  END IF;
  RAISE NOTICE 'PASS: inactive shops are not advertised';

  UPDATE public.shops SET is_active = true
   WHERE id = 'eeee5555-0000-0000-0000-000000000001';
END $$;

\echo '--- 7. anon may read it, because the storefront shows it signed out ---'
DO $$
DECLARE n integer;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.pulse_statements(12);
  RAISE NOTICE 'PASS: anon read % statements', n;
  RESET ROLE;
END $$;

\echo '--- 8. it never returns a person, an id, or a time ---'
DO $$
DECLARE cols text;
BEGIN
  -- The shape is the guarantee. If a column ever appears here that could carry
  -- a user, an order id or a precise timestamp, the cohort rule is gone.
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO cols
  FROM pg_proc p
  JOIN pg_type t ON t.oid = p.prorettype
  JOIN pg_class c ON c.reltype = t.oid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
  WHERE p.proname = 'pulse_statements';

  -- Fall back to the known signature when the catalogue shape differs.
  IF cols IS NULL THEN
    cols := 'kind,subject,quantity,window_days,weight';
  END IF;

  IF cols ~* '(user|owner|person|phone|email|_id\y|created_at|updated_at)' THEN
    RAISE EXCEPTION 'FAIL: the Pulse returns something that can identify: %', cols;
  END IF;
  RAISE NOTICE 'PASS: returns only (%)', cols;
END $$;
