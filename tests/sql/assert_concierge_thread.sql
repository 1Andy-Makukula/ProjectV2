\set ON_ERROR_STOP on
\pset pager off

-- start_kithly_conversation: the buyer's side of the concierge desk.
--
-- Self-cleaning, so the file can be run repeatedly against the same database.
DELETE FROM public.notifications;
DELETE FROM public.conversations
  WHERE buyer_id IN ('bbbbbbbb-0000-0000-0000-000000000001',
                     'bbbbbbbb-0000-0000-0000-000000000002');
DELETE FROM public.users WHERE id IN (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000002',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002'
);

-- Two admins, so a fan-out that reaches only the first one is visible as a
-- failure rather than passing by luck.
INSERT INTO public.users (id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'admin'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'sender'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'sender');

\echo '--- 1. a buyer can open a thread, and it is shaped as an admin_buyer one ---'
DO $$
DECLARE v_id uuid; v_conv RECORD; failures text[] := '{}';
BEGIN
  PERFORM set_config('test.uid', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  v_id := public.start_kithly_conversation('  A BP monitor from Woodlands  ');

  SELECT * INTO v_conv FROM public.conversations WHERE id = v_id;

  IF v_conv.kind <> 'admin_buyer' THEN
    failures := failures || ('kind was ' || v_conv.kind);
  END IF;
  IF v_conv.shop_id IS NOT NULL THEN
    failures := failures || 'a shop was attached';
  END IF;
  IF v_conv.buyer_id <> 'bbbbbbbb-0000-0000-0000-000000000001' THEN
    failures := failures || 'buyer_id is not the caller';
  END IF;
  -- Trimmed, because the subject is typed by a person into a text box.
  IF v_conv.subject <> 'A BP monitor from Woodlands' THEN
    failures := failures || ('subject was not trimmed: ' || quote_literal(v_conv.subject));
  END IF;

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: thread opens with no shop and a trimmed subject';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 2. every admin hears about it, exactly once ---'
-- Counted against public.users rather than against the two this file
-- inserts: the suites share one database and earlier ones leave their own
-- admins behind, so a hard-coded 2 asserts the fixture rather than the
-- fan-out. What has to hold is that the desk reaches *every* admin and
-- does not ring any of them twice.
DO $$
DECLARE v_id uuid; n_admins integer; n_sent integer; n_reached integer;
BEGIN
  SELECT id INTO v_id FROM public.conversations
  WHERE buyer_id = 'bbbbbbbb-0000-0000-0000-000000000001';

  SELECT count(*) INTO n_admins FROM public.users WHERE role = 'admin';
  SELECT count(*), count(DISTINCT user_id) INTO n_sent, n_reached
  FROM public.notifications
  WHERE type = 'message' AND reference_id = v_id::text;

  IF n_reached <> n_admins THEN
    RAISE EXCEPTION 'FAIL: % of % admins were notified', n_reached, n_admins;
  END IF;
  IF n_sent <> n_admins THEN
    RAISE EXCEPTION 'FAIL: % notifications for % admins -- somebody was told twice', n_sent, n_admins;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users u WHERE u.role = 'admin'
      AND NOT EXISTS (SELECT 1 FROM public.notifications n
                      WHERE n.user_id = u.id AND n.reference_id = v_id::text)
  ) THEN
    RAISE EXCEPTION 'FAIL: an admin was left out of the fan-out';
  END IF;

  RAISE NOTICE 'PASS: every admin notified, exactly once each (% admins)', n_admins;
END $$;

\echo '--- 3. tapping the button again rejoins rather than opening a second desk ---'
DO $$
DECLARE v_first uuid; v_second uuid; n_before integer; n_after integer;
BEGIN
  PERFORM set_config('test.uid', 'bbbbbbbb-0000-0000-0000-000000000001', true);

  SELECT id INTO v_first FROM public.conversations
  WHERE buyer_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  SELECT count(*) INTO n_before FROM public.notifications;

  v_second := public.start_kithly_conversation('something else entirely');

  SELECT count(*) INTO n_after FROM public.notifications;

  IF v_second <> v_first THEN
    RAISE EXCEPTION 'FAIL: a second thread was opened';
  END IF;
  -- The point of reuse is the history staying in one place; it would be
  -- undone if every tap also pinged the desk again.
  IF n_after <> n_before THEN
    RAISE EXCEPTION 'FAIL: rejoining raised % extra notifications', n_after - n_before;
  END IF;
  RAISE NOTICE 'PASS: rejoins the open thread, and stays quiet doing it';
END $$;

\echo '--- 4. a closed thread is not reopened behind the desk''s back ---'
DO $$
DECLARE v_old uuid; v_new uuid;
BEGIN
  PERFORM set_config('test.uid', 'bbbbbbbb-0000-0000-0000-000000000001', true);

  SELECT id INTO v_old FROM public.conversations
  WHERE buyer_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  UPDATE public.conversations SET is_closed = true WHERE id = v_old;

  v_new := public.start_kithly_conversation('a new question');

  IF v_new = v_old THEN
    RAISE EXCEPTION 'FAIL: a closed thread was reused';
  END IF;
  RAISE NOTICE 'PASS: a settled request stays settled; a new ask opens a new thread';
END $$;

\echo '--- 5. a blank subject is stored as null, not as an empty string ---'
DO $$
DECLARE v_id uuid; v_subject text;
BEGIN
  PERFORM set_config('test.uid', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  v_id := public.start_kithly_conversation('   ');

  SELECT subject INTO v_subject FROM public.conversations WHERE id = v_id;
  IF v_subject IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: blank subject stored as %', quote_literal(v_subject);
  END IF;
  RAISE NOTICE 'PASS: an empty box is an absent subject, and reads as one';
END $$;

\echo '--- 6. nobody signed in, nobody served ---'
DO $$
BEGIN
  PERFORM set_config('test.uid', '', true);
  BEGIN
    PERFORM public.start_kithly_conversation('anonymous ask');
    RAISE EXCEPTION 'FAIL: an unauthenticated caller opened a thread';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Not authenticated' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: unauthenticated callers are refused';
END $$;

\echo '--- 7. one buyer cannot read another buyer''s desk ---'
DO $$
DECLARE mine integer; theirs integer;
BEGIN
  SET LOCAL ROLE authenticated;

  PERFORM set_config('test.uid', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  SELECT count(*) INTO mine FROM public.conversations
  WHERE buyer_id = 'bbbbbbbb-0000-0000-0000-000000000001';

  SELECT count(*) INTO theirs FROM public.conversations
  WHERE buyer_id = 'bbbbbbbb-0000-0000-0000-000000000002';

  IF mine = 0 THEN
    RAISE EXCEPTION 'FAIL: a buyer cannot see their own thread';
  END IF;
  IF theirs <> 0 THEN
    RAISE EXCEPTION 'FAIL: % of another buyer''s threads were visible', theirs;
  END IF;
  RAISE NOTICE 'PASS: conversations_select scopes the desk to its owner';
END $$;
RESET ROLE;
