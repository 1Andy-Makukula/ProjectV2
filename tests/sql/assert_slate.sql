\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.users WHERE id IN (
  '8b8b8b8b-0000-0000-0000-000000000001',
  '8b8b8b8b-0000-0000-0000-000000000002'
);
DELETE FROM public.shops WHERE id IN (
  '9c9c9c9c-0000-0000-0000-000000000001',
  '9c9c9c9c-0000-0000-0000-000000000002'
);
DELETE FROM public.categories WHERE slug IN ('slt-cake', 'slt-tools');

INSERT INTO public.users (id, role) VALUES
  ('8b8b8b8b-0000-0000-0000-000000000001', 'sender'),
  ('8b8b8b8b-0000-0000-0000-000000000002', 'admin');

INSERT INTO public.shops (id, name, is_active) VALUES
  ('9c9c9c9c-0000-0000-0000-000000000001', 'Slate Shop', true),
  ('9c9c9c9c-0000-0000-0000-000000000002', 'Second Shop', true);

INSERT INTO public.categories (id, name, slug) VALUES
  ('adadadad-0000-0000-0000-000000000001', 'Slate Cake',  'slt-cake'),
  ('adadadad-0000-0000-0000-000000000002', 'Slate Tools', 'slt-tools');

-- Cake suits a birthday. Tools do not.
INSERT INTO kithly_reco.kind_category (occasion_kind, category_id, strength) VALUES
  ('birthday', 'adadadad-0000-0000-0000-000000000001', 0.95)
ON CONFLICT DO NOTHING;

INSERT INTO public.items (id, shop_id, category_id, name, price_zmw, is_available) VALUES
  ('bebebebe-0000-0000-0000-000000000001', '9c9c9c9c-0000-0000-0000-000000000001', 'adadadad-0000-0000-0000-000000000001', 'Birthday cake', 20000, true),
  ('bebebebe-0000-0000-0000-000000000002', '9c9c9c9c-0000-0000-0000-000000000001', 'adadadad-0000-0000-0000-000000000002', 'Hammer',        15000, true),
  ('bebebebe-0000-0000-0000-000000000003', '9c9c9c9c-0000-0000-0000-000000000001', 'adadadad-0000-0000-0000-000000000001', 'Second cake',   18000, true),
  ('bebebebe-0000-0000-0000-000000000004', '9c9c9c9c-0000-0000-0000-000000000001', 'adadadad-0000-0000-0000-000000000001', 'Third cake',    17000, true),
  ('bebebebe-0000-0000-0000-000000000005', '9c9c9c9c-0000-0000-0000-000000000002', 'adadadad-0000-0000-0000-000000000001', 'Rival cake',    19000, true);

-- Mercy, a sister, with a birthday exactly seven days away.
INSERT INTO public.contacts (id, owner_user_id, name, phone, relationship_tier) VALUES
  ('cfcfcfcf-0000-0000-0000-000000000001', '8b8b8b8b-0000-0000-0000-000000000001',
   'Mercy', '+260970001234', 'immediate_family');

INSERT INTO public.contact_occasions (contact_id, kind, recurrence, month, day)
VALUES ('cfcfcfcf-0000-0000-0000-000000000001', 'birthday', 'annual',
        EXTRACT(MONTH FROM current_date + 7)::smallint,
        EXTRACT(DAY   FROM current_date + 7)::smallint);

\echo '--- 1. THE KILL SWITCH: off means nothing, not "mostly nothing" ---'
DO $$
DECLARE n integer;
BEGIN
  UPDATE kithly_reco.weights SET enabled = false WHERE id;
  SELECT count(*) INTO n FROM kithly_reco.slate('8b8b8b8b-0000-0000-0000-000000000001', 'storefront', 12);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: the ranker returned % rows while disabled', n;
  END IF;
  RAISE NOTICE 'PASS: disabled means silent, so every call site falls back';
END $$;

\echo '--- 2. urgency is a GAUSSIAN, not a ramp ---'
DO $$
DECLARE at_peak numeric; day_before numeric; far_out numeric; missed numeric;
BEGIN
  at_peak    := kithly_reco.urgency(7, 7, 5.0);
  day_before := kithly_reco.urgency(1, 7, 5.0);
  far_out    := kithly_reco.urgency(45, 7, 5.0);
  missed     := kithly_reco.urgency(-3, 7, 5.0);

  IF at_peak < 0.99 THEN RAISE EXCEPTION 'FAIL: the peak is not at the peak (%)', at_peak; END IF;

  -- The whole point. Tomorrow is LESS urgent than next week, because there is
  -- nothing left to do about tomorrow. A ramp would have this backwards.
  IF day_before >= at_peak THEN
    RAISE EXCEPTION 'FAIL: one day out scored % against % at seven -- this has been turned into a ramp',
      day_before, at_peak;
  END IF;

  IF far_out > 0.01 THEN RAISE EXCEPTION 'FAIL: 45 days out still scores %', far_out; END IF;
  IF missed <> 0 THEN
    RAISE EXCEPTION 'FAIL: a date that has gone scores % -- an occasion is not more urgent for being missed', missed;
  END IF;
  RAISE NOTICE 'PASS: peak=%, tomorrow=%, 45 days=%, missed=%', at_peak, day_before, far_out, missed;
END $$;

\echo '--- 3. the obligation term puts the right thing first, with a reason ---'
DO $$
DECLARE top_item uuid; code text; txt text;
BEGIN
  UPDATE kithly_reco.weights SET enabled = true WHERE id;

  SELECT item_id, reason_code, reason_text INTO top_item, code, txt
  FROM kithly_reco.slate('8b8b8b8b-0000-0000-0000-000000000001', 'storefront', 12)
  LIMIT 1;

  IF code <> 'obligation' THEN
    RAISE EXCEPTION 'FAIL: top reason is % -- a birthday a week away should win', code;
  END IF;
  IF txt NOT LIKE '%Mercy%' THEN
    RAISE EXCEPTION 'FAIL: the reason does not name who it is about: %', txt;
  END IF;
  IF txt NOT LIKE '%7 days%' THEN
    RAISE EXCEPTION 'FAIL: the reason does not say when: %', txt;
  END IF;
  RAISE NOTICE 'PASS: "%"', txt;
END $$;

\echo '--- 4. a hammer is not a birthday present ---'
DO $$
DECLARE cake_rank integer; hammer_rank integer;
BEGIN
  WITH ranked AS (
    SELECT sl.item_id AS id, row_number() OVER (ORDER BY sl.score DESC) AS rn
    FROM kithly_reco.slate('8b8b8b8b-0000-0000-0000-000000000001', 'storefront', 12) sl
  )
  -- The best-placed cake, not one nominated cake.
  --
  -- Three of the four cakes live in Slate Shop and max_per_shop is 2, so the
  -- diversity cap always evicts one of them -- and which one depends on score
  -- ordering between three near-identical items, which moves run to run. Naming
  -- a single cake here made this assertion fail roughly one run in four for a
  -- reason that has nothing to do with what it is testing.
  --
  -- What it is testing is that kappa puts cake above hammer for a birthday.
  -- That is exactly what MIN over the cakes asks. The per-shop cap has its own
  -- assertion immediately below.
  SELECT
    (SELECT min(rn) FROM ranked WHERE id IN (
       'bebebebe-0000-0000-0000-000000000001',
       'bebebebe-0000-0000-0000-000000000003',
       'bebebebe-0000-0000-0000-000000000004',
       'bebebebe-0000-0000-0000-000000000005')),
    (SELECT rn FROM ranked WHERE id = 'bebebebe-0000-0000-0000-000000000002')
  INTO cake_rank, hammer_rank;

  IF cake_rank IS NULL THEN RAISE EXCEPTION 'FAIL: no cake appeared at all'; END IF;
  IF hammer_rank IS NOT NULL AND hammer_rank < cake_rank THEN
    RAISE EXCEPTION 'FAIL: a hammer outranked a cake for a birthday (% vs %)', hammer_rank, cake_rank;
  END IF;
  RAISE NOTICE 'PASS: kappa decides what suits the occasion';
END $$;

\echo '--- 5. one shop cannot take the whole storefront ---'
DO $$
DECLARE most integer; cap integer;
BEGIN
  SELECT max_per_shop INTO cap FROM kithly_reco.weights WHERE id;

  SELECT max(c) INTO most FROM (
    SELECT count(*) AS c
    FROM kithly_reco.slate('8b8b8b8b-0000-0000-0000-000000000001', 'storefront', 12) s
    JOIN public.items i ON i.id = s.item_id
    GROUP BY i.shop_id
  ) x;

  IF most > cap THEN
    RAISE EXCEPTION 'FAIL: one shop took % of the slate, cap is % -- this matters MORE at low supply', most, cap;
  END IF;
  RAISE NOTICE 'PASS: at most % per shop', most;
END $$;

\echo '--- 6. nothing unbuyable is ever ranked ---'
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.items SET is_available = false WHERE id = 'bebebebe-0000-0000-0000-000000000001';
  UPDATE public.items SET is_quote_only = true WHERE id = 'bebebebe-0000-0000-0000-000000000003';

  SELECT count(*) INTO n
  FROM kithly_reco.slate('8b8b8b8b-0000-0000-0000-000000000001', 'storefront', 12)
  WHERE item_id IN ('bebebebe-0000-0000-0000-000000000001', 'bebebebe-0000-0000-0000-000000000003');

  IF n > 0 THEN RAISE EXCEPTION 'FAIL: ranked % items that cannot be bought', n; END IF;
  RAISE NOTICE 'PASS: only sellable stock is ranked';

  UPDATE public.items SET is_available = true  WHERE id = 'bebebebe-0000-0000-0000-000000000001';
  UPDATE public.items SET is_quote_only = false WHERE id = 'bebebebe-0000-0000-0000-000000000003';
END $$;

\echo '--- 7. a stranger''s occasions never leak into your slate ---'
DO $$
DECLARE code text;
BEGIN
  -- User two has no contacts at all, so nothing they see may be explained by
  -- somebody else's birthday.
  SELECT reason_code INTO code
  FROM kithly_reco.slate('8b8b8b8b-0000-0000-0000-000000000002', 'storefront', 12)
  WHERE reason_code = 'obligation'
  LIMIT 1;

  IF code IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: another user''s occasions reached this slate';
  END IF;
  RAISE NOTICE 'PASS: obligations are personal';
END $$;

\echo '--- 8. shown and ignored sinks ---'
DO $$
DECLARE before_rank integer; after_rank integer;
BEGIN
  DELETE FROM kithly_reco.signals WHERE user_id = '8b8b8b8b-0000-0000-0000-000000000001';

  WITH r AS (SELECT sl.item_id AS id, row_number() OVER (ORDER BY sl.score DESC) rn
             FROM kithly_reco.slate('8b8b8b8b-0000-0000-0000-000000000001','storefront',12) sl)
  SELECT rn INTO before_rank FROM r WHERE id = 'bebebebe-0000-0000-0000-000000000004';

  -- Shown twenty times, never once acted on.
  INSERT INTO kithly_reco.signals (user_id, surface, action, subject_type, subject_id)
  SELECT '8b8b8b8b-0000-0000-0000-000000000001', 'storefront', 'impression', 'item',
         'bebebebe-0000-0000-0000-000000000004'
  FROM generate_series(1, 20);

  WITH r AS (SELECT sl.item_id AS id, row_number() OVER (ORDER BY sl.score DESC) rn
             FROM kithly_reco.slate('8b8b8b8b-0000-0000-0000-000000000001','storefront',12) sl)
  SELECT rn INTO after_rank FROM r WHERE id = 'bebebebe-0000-0000-0000-000000000004';

  IF before_rank IS NOT NULL AND after_rank IS NOT NULL AND after_rank < before_rank THEN
    RAISE EXCEPTION 'FAIL: an item shown 20 times and ignored rose from % to % -- the slate will calcify',
      before_rank, after_rank;
  END IF;
  RAISE NOTICE 'PASS: fatigue applies (% -> %)', before_rank, COALESCE(after_rank::text, 'dropped');
END $$;

\echo '--- 9. the dials are one row, and only an admin turns them ---'
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM kithly_reco.weights;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: % weight rows -- one will eventually be the wrong one', n; END IF;

  BEGIN
    INSERT INTO kithly_reco.weights (id, enabled) VALUES (false, true);
    RAISE EXCEPTION 'FAIL: a second weights row was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', '8b8b8b8b-0000-0000-0000-000000000001', true);
  BEGIN
    UPDATE kithly_reco.weights SET enabled = false WHERE id;
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: an ordinary user retuned the ranker';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  RAISE NOTICE 'PASS: one row, admin only';
END $$;

\echo '--- 10. it ships OFF ---'
DO $$
BEGIN
  -- A ranker that switches itself on at deploy time is a ranker nobody chose
  -- to trust. This asserts the shipped default rather than the current state.
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'kithly_reco' AND table_name = 'weights'
        AND column_name = 'enabled') NOT LIKE '%false%' THEN
    RAISE EXCEPTION 'FAIL: the recommender defaults to on';
  END IF;
  RAISE NOTICE 'PASS: enabled defaults to false';

  -- Leave it off for whatever runs next.
  UPDATE kithly_reco.weights SET enabled = false WHERE id;
END $$;
