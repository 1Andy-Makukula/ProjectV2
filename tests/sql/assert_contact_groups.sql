\set ON_ERROR_STOP on
\pset pager off

-- Self-cleaning, so the file can be run repeatedly against the same database.
-- Cascades from users reach contacts, groups, memberships and occasions.
DELETE FROM public.notifications;
DELETE FROM public.users WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

-- Two owners, so cross-owner leakage has something to leak to.
INSERT INTO public.users (id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'sender'),
  ('22222222-2222-2222-2222-222222222222', 'sender')
ON CONFLICT DO NOTHING;

INSERT INTO public.contacts (id, owner_user_id, name, phone) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mercy',  '+260970000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Chanda', '+260970000002'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Intruder','+260970000003')
ON CONFLICT DO NOTHING;

INSERT INTO public.contact_groups (id, owner_user_id, name) VALUES
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'The Banda household')
ON CONFLICT DO NOTHING;

\echo '--- 1. membership integrity is structural ---'
DO $$
DECLARE failures text[] := '{}';
BEGIN
  -- same owner: fine
  INSERT INTO public.contact_group_members (group_id, contact_id, owner_user_id)
  VALUES ('cccccccc-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111');

  -- another owner's contact into my group: must be impossible
  BEGIN
    INSERT INTO public.contact_group_members (group_id, contact_id, owner_user_id)
    VALUES ('cccccccc-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111');
    failures := failures || 'cross-owner membership was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  -- claiming the other owner's id does not help: the group FK then fails
  BEGIN
    INSERT INTO public.contact_group_members (group_id, contact_id, owner_user_id)
    VALUES ('cccccccc-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222');
    failures := failures || 'cross-owner membership via spoofed owner was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: cross-owner membership impossible in both directions';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 2. an occasion has exactly one subject ---'
DO $$
DECLARE failures text[] := '{}';
BEGIN
  -- neither
  BEGIN
    INSERT INTO public.contact_occasions (kind, recurrence, month, day)
    VALUES ('birthday', 'annual', 5, 10);
    failures := failures || 'occasion with no subject was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- both
  BEGIN
    INSERT INTO public.contact_occasions (contact_id, group_id, kind, recurrence, month, day)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
            'cccccccc-0000-0000-0000-000000000001', 'birthday', 'annual', 5, 10);
    failures := failures || 'occasion with two subjects was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- group only: the new case, must work
  INSERT INTO public.contact_occasions (group_id, kind, recurrence, day)
  VALUES ('cccccccc-0000-0000-0000-000000000001', 'groceries', 'monthly', 25);

  -- contact only: the existing case, must still work
  INSERT INTO public.contact_occasions (contact_id, kind, recurrence, month, day)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'birthday', 'annual', 9, 19);

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: XOR holds, both valid shapes accepted';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 3. RLS reaches group occasions, and only the owner ---'
DO $$
DECLARE n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

  -- Both counts matter. The group count alone would pass even with RLS
  -- switched off entirely, since there is only one group occasion in the
  -- fixture -- a vacuous pass is worse than a failure.
  SELECT count(*) INTO n FROM public.contact_occasions WHERE group_id IS NOT NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: owner sees % group occasions, expected 1 (the old policy denied these)', n;
  END IF;

  SELECT count(*) INTO n FROM public.contact_occasions;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: owner sees % occasions in total, expected 2', n;
  END IF;
  RAISE NOTICE 'PASS: owner reads their group occasion and their contact occasion';

  PERFORM set_config('test.uid', '22222222-2222-2222-2222-222222222222', true);
  SELECT count(*) INTO n FROM public.contact_occasions;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: another user sees % occasions', n;
  END IF;
  RAISE NOTICE 'PASS: another user sees nothing';

  RESET ROLE;
END $$;

\echo '--- 4. REGRESSION: the reminder job must not drop group occasions ---'
-- The grocery run is monthly on the 25th. Pinning today to the 18th puts it
-- exactly seven days out, which is one of the two windows the job fires in.
DO $$
DECLARE
  sent integer;
  group_notes integer;
BEGIN
  DELETE FROM public.notifications;
  UPDATE public.contact_occasions SET last_reminded_on = NULL;

  sent := public.dispatch_occasion_reminders('2026-09-18'::date);

  SELECT count(*) INTO group_notes
  FROM public.notifications
  WHERE message LIKE 'The Banda household%';

  IF group_notes <> 1 THEN
    RAISE EXCEPTION
      'FAIL: group occasion produced % reminders, expected 1. The INNER JOIN is back.',
      group_notes;
  END IF;
  RAISE NOTICE 'PASS: group occasion reminded (% total sent)', sent;
END $$;

SELECT message FROM public.notifications ORDER BY message;

\echo '--- 5. contact occasions still remind, unchanged ---'
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.notifications;
  UPDATE public.contact_occasions SET last_reminded_on = NULL;

  PERFORM public.dispatch_occasion_reminders('2026-09-12'::date);

  SELECT count(*) INTO n FROM public.notifications WHERE message LIKE 'Mercy%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: Mercy''s birthday a week out produced % reminders, expected 1', n;
  END IF;
  RAISE NOTICE 'PASS: contact occasion unaffected by the change';
END $$;

\echo '--- 6. running the job twice in a day sends nothing the second time ---'
DO $$
DECLARE before_n integer; after_n integer;
BEGIN
  SELECT count(*) INTO before_n FROM public.notifications;
  PERFORM public.dispatch_occasion_reminders('2026-09-12'::date);
  SELECT count(*) INTO after_n FROM public.notifications;

  IF after_n <> before_n THEN
    RAISE EXCEPTION 'FAIL: re-running the job wrote % extra reminders', after_n - before_n;
  END IF;
  RAISE NOTICE 'PASS: last_reminded_on still guards repeats';
END $$;
