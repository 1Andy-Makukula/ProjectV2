\set ON_ERROR_STOP on
\pset pager off

DELETE FROM kithly_reco.signals;
DELETE FROM public.users WHERE id IN (
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666'
);
INSERT INTO public.users (id, role) VALUES
  ('55555555-5555-5555-5555-555555555555', 'sender'),
  ('66666666-6666-6666-6666-666666666666', 'sender');

\echo '--- 1. the action and subject vocabularies are closed ---'
DO $$
DECLARE failures text[] := '{}';
BEGIN
  BEGIN
    INSERT INTO kithly_reco.signals (surface, action, subject_type, subject_id)
    VALUES ('storefront', 'hovered', 'item', gen_random_uuid());
    failures := failures || 'unknown action accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO kithly_reco.signals (surface, action, subject_type, subject_id)
    VALUES ('storefront', 'tap', 'banner', gen_random_uuid());
    failures := failures || 'unknown subject_type accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO kithly_reco.signals (surface, action, subject_type)
    VALUES ('storefront', 'tap', 'item');
    failures := failures || 'signal with no subject accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- a search legitimately has no subject id
  INSERT INTO kithly_reco.signals (surface, action, subject_type, context)
  VALUES ('storefront', 'search', 'query', '{"q":"cake"}'::jsonb);

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: vocabulary closed, search exempt from needing a subject';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 2. append-only: nobody may rewrite history ---'
DO $$
DECLARE failures text[] := '{}';
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', '55555555-5555-5555-5555-555555555555', true);

  INSERT INTO kithly_reco.signals (user_id, surface, action, subject_type, subject_id)
  VALUES ('55555555-5555-5555-5555-555555555555', 'storefront', 'tap', 'item', gen_random_uuid());

  BEGIN
    UPDATE kithly_reco.signals SET action = 'purchase' WHERE action = 'tap';
    failures := failures || 'UPDATE was permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    DELETE FROM kithly_reco.signals WHERE action = 'tap';
    failures := failures || 'DELETE was permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  RESET ROLE;

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: UPDATE and DELETE both refused -- the REVOKE holds';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 3. a user may not write a signal attributed to someone else ---'
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', '55555555-5555-5555-5555-555555555555', true);

  BEGIN
    INSERT INTO kithly_reco.signals (user_id, surface, action, subject_type, subject_id)
    VALUES ('66666666-6666-6666-6666-666666666666', 'storefront', 'tap', 'item', gen_random_uuid());
    RAISE EXCEPTION 'FAIL: a user poisoned the log with another user''s id';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: cannot attribute a signal to another user';
  END;
  RESET ROLE;
END $$;

\echo '--- 4. anonymous browsing is recordable ---'
DO $$
DECLARE n integer;
BEGIN
  SET LOCAL ROLE anon;
  INSERT INTO kithly_reco.signals (session_id, surface, action, subject_type, subject_id)
  VALUES (gen_random_uuid(), 'storefront', 'impression', 'item', gen_random_uuid());
  RAISE NOTICE 'PASS: anon may write a signal with no user_id';

  -- and must not be able to read the log back
  SELECT count(*) INTO n FROM kithly_reco.signals;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon read % signals; there is no SELECT policy for anon', n;
  END IF;
  RAISE NOTICE 'PASS: anon cannot read the log';
  RESET ROLE;
END $$;

\echo '--- 5. a user reads their own signals and nobody else''s ---'
DO $$
DECLARE mine integer; theirs integer;
BEGIN
  SET LOCAL ROLE authenticated;

  PERFORM set_config('test.uid', '55555555-5555-5555-5555-555555555555', true);
  SELECT count(*) INTO mine FROM kithly_reco.signals;
  IF mine <> 1 THEN RAISE EXCEPTION 'FAIL: owner sees % of their signals, expected 1', mine; END IF;

  PERFORM set_config('test.uid', '66666666-6666-6666-6666-666666666666', true);
  SELECT count(*) INTO theirs FROM kithly_reco.signals;
  IF theirs <> 0 THEN RAISE EXCEPTION 'FAIL: another user sees % signals', theirs; END IF;

  RAISE NOTICE 'PASS: own signals visible, others not';
  RESET ROLE;
END $$;

\echo '--- 6. a deleted account anonymises its signals rather than erasing them ---'
DO $$
DECLARE remaining integer; orphaned integer;
BEGIN
  DELETE FROM public.users WHERE id = '55555555-5555-5555-5555-555555555555';

  SELECT count(*) INTO remaining FROM kithly_reco.signals;
  SELECT count(*) INTO orphaned FROM kithly_reco.signals WHERE user_id IS NULL;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'FAIL: deleting a user cascaded the log away';
  END IF;
  IF orphaned < 1 THEN
    RAISE EXCEPTION 'FAIL: a deleted user is still identifiable in the log';
  END IF;
  RAISE NOTICE 'PASS: % signals kept, % anonymised', remaining, orphaned;
END $$;

\echo '--- 7. prune refuses to destroy the history the ranker needs ---'
DO $$
BEGIN
  BEGIN
    PERFORM kithly_reco.prune_signals(7);
    RAISE EXCEPTION 'FAIL: prune accepted a 7-day retention';
  EXCEPTION
    WHEN raise_exception THEN
      IF sqlerrm LIKE 'FAIL:%' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: prune refused an unsafe retention window';
  END;

  PERFORM kithly_reco.prune_signals(180);
  RAISE NOTICE 'PASS: prune runs at a sane window';
END $$;
