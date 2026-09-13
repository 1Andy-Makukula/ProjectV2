\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.notifications;
DELETE FROM public.users WHERE id = '88888888-8888-8888-8888-888888888888';
DELETE FROM public.shops WHERE id = 'c9c9c9c9-0000-0000-0000-000000000001';

INSERT INTO public.users (id, role) VALUES
  ('88888888-8888-8888-8888-888888888888', 'sender');
INSERT INTO public.shops (id, name) VALUES
  ('c9c9c9c9-0000-0000-0000-000000000001', 'Mama Africa');

INSERT INTO public.contacts (id, owner_user_id, name, phone, relationship, relationship_tier) VALUES
  ('d9d9d9d9-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
   'Mercy', '+260970000011', 'my sister', 'immediate_family');

\echo '--- 1. the free-text relationship survives the tier ---'
DO $$
DECLARE r text; t text;
BEGIN
  SELECT relationship, relationship_tier INTO r, t
  FROM public.contacts WHERE id = 'd9d9d9d9-0000-0000-0000-000000000001';
  IF r <> 'my sister' THEN RAISE EXCEPTION 'FAIL: free text lost, got %', r; END IF;
  IF t <> 'immediate_family' THEN RAISE EXCEPTION 'FAIL: tier wrong, got %', t; END IF;

  BEGIN
    UPDATE public.contacts SET relationship_tier = 'bestie'
     WHERE id = 'd9d9d9d9-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL: an unknown tier was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  RAISE NOTICE 'PASS: both halves kept, tier is closed';
END $$;

\echo '--- 2. a wedding is announced six weeks out; a grocery run is not ---'
DO $$
DECLARE wedding_notes integer; grocery_notes integer;
BEGIN
  DELETE FROM public.notifications;
  DELETE FROM public.contact_occasions WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001';

  -- Both on the 25th of October 2026. Today is pinned 42 days earlier.
  INSERT INTO public.contact_occasions (contact_id, kind, recurrence, month, day)
  VALUES ('d9d9d9d9-0000-0000-0000-000000000001', 'wedding', 'annual', 10, 25);
  INSERT INTO public.contact_occasions (contact_id, kind, recurrence, day)
  VALUES ('d9d9d9d9-0000-0000-0000-000000000001', 'groceries', 'monthly', 25);

  PERFORM public.dispatch_occasion_reminders('2026-09-13'::date);

  SELECT count(*) INTO wedding_notes FROM public.notifications WHERE message LIKE 'Mercy%wedding%';
  SELECT count(*) INTO grocery_notes FROM public.notifications WHERE message LIKE 'Mercy%grocery%';

  IF wedding_notes <> 1 THEN
    RAISE EXCEPTION 'FAIL: wedding 42 days out produced % reminders, expected 1', wedding_notes;
  END IF;
  IF grocery_notes <> 0 THEN
    RAISE EXCEPTION 'FAIL: a grocery run was announced 12 days early';
  END IF;
  RAISE NOTICE 'PASS: lead times are per kind, not global';
END $$;

\echo '--- 3. the grocery run is announced two days out ---'
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.notifications;
  UPDATE public.contact_occasions SET last_reminded_on = NULL
   WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001';

  PERFORM public.dispatch_occasion_reminders('2026-09-23'::date);

  SELECT count(*) INTO n FROM public.notifications WHERE message LIKE 'Mercy%grocery%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: grocery run 2 days out produced % reminders', n; END IF;
  RAISE NOTICE 'PASS: short-lead occasions fire on their own schedule';
END $$;

\echo '--- 4. a missed window is not fired late ---'
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.notifications;
  UPDATE public.contact_occasions SET last_reminded_on = NULL
   WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001';

  -- 41 days before the wedding: one day past the 42-day window.
  PERFORM public.dispatch_occasion_reminders('2026-09-14'::date);

  SELECT count(*) INTO n FROM public.notifications WHERE message LIKE 'Mercy%wedding%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: a missed 42-day window fired at 41 and called itself six weeks';
  END IF;
  RAISE NOTICE 'PASS: windows match exactly, no catching up';
END $$;

\echo '--- 5. a per-occasion override beats the kind default ---'
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.notifications;
  UPDATE public.contact_occasions SET last_reminded_on = NULL, lead_days = ARRAY[60, 0]
   WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001' AND kind = 'wedding';

  PERFORM public.dispatch_occasion_reminders('2026-08-26'::date);

  SELECT count(*) INTO n FROM public.notifications WHERE message LIKE 'Mercy%wedding%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: override of 60 days produced % reminders', n; END IF;
  RAISE NOTICE 'PASS: somebody who wants two months warning gets it';
END $$;

\echo '--- 6. reminders carry paths, and a group reminder points at the group ---'
DO $$
DECLARE acts jsonb; kinds text;
BEGIN
  DELETE FROM public.notifications;
  UPDATE public.contact_occasions SET last_reminded_on = NULL, lead_days = NULL
   WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001';

  PERFORM public.dispatch_occasion_reminders('2026-09-23'::date);

  SELECT actions INTO acts FROM public.notifications WHERE message LIKE 'Mercy%grocery%' LIMIT 1;
  IF acts IS NULL OR jsonb_array_length(acts) <> 2 THEN
    RAISE EXCEPTION 'FAIL: reminder arrived with no actions';
  END IF;

  SELECT string_agg(a ->> 'type', ',' ORDER BY a ->> 'type')
    INTO kinds FROM jsonb_array_elements(acts) a;
  IF kinds <> 'browse_for_occasion,open_contact' THEN
    RAISE EXCEPTION 'FAIL: unexpected action types: %', kinds;
  END IF;
  RAISE NOTICE 'PASS: reminders offer % paths (%)', jsonb_array_length(acts), kinds;
END $$;

\echo '--- 7. observed preferences come from collected orders only ---'
DO $$
DECLARE n integer; ev integer; src text;
BEGIN
  DELETE FROM public.contact_preferences WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001';

  INSERT INTO public.shop_orders (shop_id, recipient_phone, claim_status) VALUES
    ('c9c9c9c9-0000-0000-0000-000000000001', '+260970000011', 'REDEEMED'),
    ('c9c9c9c9-0000-0000-0000-000000000001', '+260970000011', 'REDEEMED'),
    -- never collected: says something about the sender, not the recipient
    ('c9c9c9c9-0000-0000-0000-000000000001', '+260970000011', 'EXPIRED');

  n := public.refresh_observed_preferences('d9d9d9d9-0000-0000-0000-000000000001');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 observed preference, got %', n; END IF;

  SELECT evidence_count, source INTO ev, src
  FROM public.contact_preferences
  WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001' AND kind = 'favourite_shop';

  IF ev <> 2 THEN RAISE EXCEPTION 'FAIL: counted % orders, expected 2 (the expired one must not count)', ev; END IF;
  IF src <> 'observed' THEN RAISE EXCEPTION 'FAIL: source is %', src; END IF;
  RAISE NOTICE 'PASS: observed from % collected orders, uncollected ignored', ev;
END $$;

\echo '--- 8. a refresh never destroys what someone declared ---'
DO $$
DECLARE declared integer; observed integer;
BEGIN
  INSERT INTO public.contact_preferences (contact_id, owner_user_id, kind, value)
  VALUES ('d9d9d9d9-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
          'dietary', 'no pork');

  PERFORM public.refresh_observed_preferences('d9d9d9d9-0000-0000-0000-000000000001');

  SELECT count(*) INTO declared FROM public.contact_preferences
   WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001' AND source = 'declared';
  SELECT count(*) INTO observed FROM public.contact_preferences
   WHERE contact_id = 'd9d9d9d9-0000-0000-0000-000000000001' AND source = 'observed';

  IF declared <> 1 THEN RAISE EXCEPTION 'FAIL: a refresh destroyed a declared preference'; END IF;
  IF observed <> 1 THEN RAISE EXCEPTION 'FAIL: observed rows not rewritten, got %', observed; END IF;
  RAISE NOTICE 'PASS: declared kept, observed rewritten';
END $$;

\echo '--- 9. a declared preference cannot claim evidence ---'
DO $$
DECLARE failures text[] := '{}';
BEGIN
  BEGIN
    INSERT INTO public.contact_preferences (contact_id, owner_user_id, kind, value, evidence_count)
    VALUES ('d9d9d9d9-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
            'likes', 'yellow roses', 7);
    failures := failures || 'a declared preference carried evidence';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.contact_preferences (contact_id, owner_user_id, kind, value)
    VALUES ('d9d9d9d9-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
            'favourite_shop', 'Nowhere');
    failures := failures || 'a shop preference with no shop was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: declared rows cannot fake evidence';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 10. a preference cannot be attached to another owner''s contact ---'
DO $$
BEGIN
  BEGIN
    INSERT INTO public.contact_preferences (contact_id, owner_user_id, kind, value)
    VALUES ('d9d9d9d9-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'note', 'stolen');
    RAISE EXCEPTION 'FAIL: a preference was attached across owners';
  EXCEPTION
    WHEN foreign_key_violation THEN RAISE NOTICE 'PASS: cross-owner preference impossible';
  END;
END $$;
