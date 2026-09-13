\set ON_ERROR_STOP on
\pset pager off

-- Pretend today is a fixed date so the expectations below cannot rot.
\set today '2026-09-12'

\echo '--- 1. the shared date engine answers for holidays, unchanged ---'
SELECT
  h.name,
  h.recurrence,
  public.occasion_next_date(h.recurrence, h.month, h.day, h.year, :'today'::date) AS next_date
FROM public.holidays h
WHERE h.country_code = 'ZM'
  AND h.name IN ('Independence Day', 'Christmas Day', 'New Year''s Day', 'Month end')
ORDER BY next_date;

\echo '--- 2. constraints actually reject bad rows ---'
DO $$
DECLARE
  failures text[] := '{}';
  ok boolean;
BEGIN
  -- monthly must not carry a month
  BEGIN
    INSERT INTO public.holidays (country_code, name, recurrence, month, day)
    VALUES ('ZM', 'bad monthly', 'monthly', 5, 10);
    failures := failures || 'monthly-with-month was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 31 February is not a date
  BEGIN
    INSERT INTO public.holidays (country_code, name, recurrence, month, day)
    VALUES ('ZM', 'bad feb', 'annual', 2, 31);
    failures := failures || '31-February was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- annual needs a month
  BEGIN
    INSERT INTO public.holidays (country_code, name, recurrence, month, day)
    VALUES ('ZM', 'bad annual', 'annual', NULL, 10);
    failures := failures || 'annual-without-month was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- once needs a year
  BEGIN
    INSERT INTO public.holidays (country_code, name, recurrence, month, day, year)
    VALUES ('ZM', 'bad once', 'once', 5, 10, NULL);
    failures := failures || 'once-without-year was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- unknown kind
  BEGIN
    INSERT INTO public.holidays (country_code, name, kind, recurrence, month, day)
    VALUES ('ZM', 'bad kind', 'nonsense', 'annual', 5, 10);
    failures := failures || 'unknown kind was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- lowercase country code
  BEGIN
    INSERT INTO public.countries (code, name) VALUES ('zm', 'lowercase');
    failures := failures || 'lowercase country code was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- holiday for a country that does not exist
  BEGIN
    INSERT INTO public.holidays (country_code, name, recurrence, month, day)
    VALUES ('XX', 'orphan', 'annual', 5, 10);
    failures := failures || 'orphan holiday was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: all 7 invalid rows rejected';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 3. RLS: anon reads, anon cannot write ---'
DO $$
DECLARE n integer;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.holidays;
  IF n = 0 THEN RAISE EXCEPTION 'FAIL: anon cannot read holidays'; END IF;
  RAISE NOTICE 'PASS: anon reads % holidays', n;

  BEGIN
    INSERT INTO public.holidays (country_code, name, recurrence, month, day)
    VALUES ('ZM', 'anon insert', 'annual', 5, 10);
    RAISE EXCEPTION 'FAIL: anon was allowed to write a holiday';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon write refused';
  END;
  RESET ROLE;
END $$;

\echo '--- 4. inactive holidays are hidden from readers ---'
UPDATE public.holidays SET is_active = false WHERE name = 'Farmers Day';
DO $$
DECLARE n integer;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.holidays WHERE name = 'Farmers Day';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: anon sees an inactive holiday'; END IF;
  RAISE NOTICE 'PASS: inactive holiday hidden from anon';
  RESET ROLE;
END $$;
UPDATE public.holidays SET is_active = true WHERE name = 'Farmers Day';
