\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.users WHERE id = 'ffff6666-0000-0000-0000-000000000001';
DELETE FROM public.shops WHERE id IN (
  '1a1a1a1a-0000-0000-0000-000000000001',
  '1a1a1a1a-0000-0000-0000-000000000002'
);
DELETE FROM public.categories WHERE slug IN ('cmp-cake', 'cmp-sweets', 'cmp-drinks', 'cmp-tools');

INSERT INTO public.users (id, role) VALUES
  ('ffff6666-0000-0000-0000-000000000001', 'sender');

INSERT INTO public.shops (id, name, is_active) VALUES
  ('1a1a1a1a-0000-0000-0000-000000000001', 'Bundle Shop', true),
  ('1a1a1a1a-0000-0000-0000-000000000002', 'Other Shop', true);

INSERT INTO public.categories (id, name, slug) VALUES
  ('2b2b2b2b-0000-0000-0000-000000000001', 'Cake',   'cmp-cake'),
  ('2b2b2b2b-0000-0000-0000-000000000002', 'Sweets', 'cmp-sweets'),
  ('2b2b2b2b-0000-0000-0000-000000000003', 'Drinks', 'cmp-drinks'),
  ('2b2b2b2b-0000-0000-0000-000000000004', 'Tools',  'cmp-tools');

-- Cake goes strongly with sweets, less with drinks, not at all with tools.
INSERT INTO kithly_reco.complements (from_category_id, to_category_id, strength) VALUES
  ('2b2b2b2b-0000-0000-0000-000000000001', '2b2b2b2b-0000-0000-0000-000000000002', 0.80),
  ('2b2b2b2b-0000-0000-0000-000000000001', '2b2b2b2b-0000-0000-0000-000000000003', 0.50)
ON CONFLICT DO NOTHING;

INSERT INTO public.items (id, shop_id, category_id, name, price_zmw, is_available) VALUES
  ('3c3c3c3c-0000-0000-0000-000000000001', '1a1a1a1a-0000-0000-0000-000000000001', '2b2b2b2b-0000-0000-0000-000000000001', 'Chocolate cake', 20000, true),
  ('3c3c3c3c-0000-0000-0000-000000000002', '1a1a1a1a-0000-0000-0000-000000000001', '2b2b2b2b-0000-0000-0000-000000000002', 'Sweets box',      6000, true),
  ('3c3c3c3c-0000-0000-0000-000000000003', '1a1a1a1a-0000-0000-0000-000000000001', '2b2b2b2b-0000-0000-0000-000000000003', 'Maheu',           3000, true),
  ('3c3c3c3c-0000-0000-0000-000000000004', '1a1a1a1a-0000-0000-0000-000000000001', '2b2b2b2b-0000-0000-0000-000000000004', 'Spanner set',    15000, true),
  -- A second cake: the greedy trap. Without the one-per-category rule the
  -- bundle would be two cakes and nothing else.
  ('3c3c3c3c-0000-0000-0000-000000000005', '1a1a1a1a-0000-0000-0000-000000000001', '2b2b2b2b-0000-0000-0000-000000000001', 'Vanilla cake',   18000, true),
  -- Belongs to another shop entirely.
  ('3c3c3c3c-0000-0000-0000-000000000009', '1a1a1a1a-0000-0000-0000-000000000002', '2b2b2b2b-0000-0000-0000-000000000002', 'Rival sweets',    2000, true);

\echo '--- 1. a bundle never leaves the shop it started in ---'
DO $$
DECLARE stray integer;
BEGIN
  SELECT count(*) INTO stray
  FROM kithly_reco.compose_bundle(
         '1a1a1a1a-0000-0000-0000-000000000001', 40000,
         '2b2b2b2b-0000-0000-0000-000000000001', 4) b
  JOIN public.items i ON i.id = b.item_id
  WHERE i.shop_id <> '1a1a1a1a-0000-0000-0000-000000000001';

  IF stray > 0 THEN
    RAISE EXCEPTION 'FAIL: % items came from another shop -- a bundle is collected, not delivered', stray;
  END IF;
  RAISE NOTICE 'PASS: one shop, one journey';
END $$;

\echo '--- 2. it stays inside the budget ---'
DO $$
DECLARE total integer;
BEGIN
  SELECT COALESCE(sum(price_zmw), 0) INTO total
  FROM kithly_reco.compose_bundle(
         '1a1a1a1a-0000-0000-0000-000000000001', 30000,
         '2b2b2b2b-0000-0000-0000-000000000001', 4);

  IF total > 30000 THEN
    RAISE EXCEPTION 'FAIL: bundle came to %, over a budget of 30000', total;
  END IF;
  RAISE NOTICE 'PASS: % of a 300.00 budget', total;
END $$;

\echo '--- 3. THE GREEDY TRAP: never two of the same thing ---'
DO $$
DECLARE cakes integer;
BEGIN
  SELECT count(*) INTO cakes
  FROM kithly_reco.compose_bundle(
         '1a1a1a1a-0000-0000-0000-000000000001', 60000,
         '2b2b2b2b-0000-0000-0000-000000000001', 4) b
  JOIN public.items i ON i.id = b.item_id
  WHERE i.category_id = '2b2b2b2b-0000-0000-0000-000000000001';

  IF cakes > 1 THEN
    RAISE EXCEPTION 'FAIL: the bundle contains % cakes', cakes;
  END IF;
  RAISE NOTICE 'PASS: one item per category';
END $$;

\echo '--- 4. Lambda decides what joins the cake ---'
DO $$
DECLARE has_sweets boolean; has_tools boolean;
BEGIN
  SELECT
    bool_or(i.category_id = '2b2b2b2b-0000-0000-0000-000000000002'),
    bool_or(i.category_id = '2b2b2b2b-0000-0000-0000-000000000004')
  INTO has_sweets, has_tools
  FROM kithly_reco.compose_bundle(
         '1a1a1a1a-0000-0000-0000-000000000001', 30000,
         '2b2b2b2b-0000-0000-0000-000000000001', 3) b
  JOIN public.items i ON i.id = b.item_id;

  IF NOT has_sweets THEN
    RAISE EXCEPTION 'FAIL: sweets belong with cake at 0.80 and were left out';
  END IF;
  IF has_tools THEN
    RAISE EXCEPTION 'FAIL: a spanner set was put in a cake bundle';
  END IF;
  RAISE NOTICE 'PASS: complements in, unrelated out';
END $$;

\echo '--- 5. a bundle has a shape ---'
DO $$
DECLARE roles text;
BEGIN
  SELECT string_agg(DISTINCT role, ',' ORDER BY role) INTO roles
  FROM kithly_reco.compose_bundle(
         '1a1a1a1a-0000-0000-0000-000000000001', 40000,
         '2b2b2b2b-0000-0000-0000-000000000001', 4);

  IF roles NOT LIKE '%centrepiece%' OR roles NOT LIKE '%extra%' THEN
    RAISE EXCEPTION 'FAIL: no shape -- roles were (%)', roles;
  END IF;
  RAISE NOTICE 'PASS: roles are (%)', roles;
END $$;

\echo '--- 6. one item is not a bundle ---'
DO $$
DECLARE n integer;
BEGIN
  -- Only the cheapest thing fits, so there is nothing to compose.
  SELECT count(*) INTO n FROM kithly_reco.compose_bundle(
    '1a1a1a1a-0000-0000-0000-000000000001', 3500,
    '2b2b2b2b-0000-0000-0000-000000000001', 4);

  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: returned a "bundle" of % item(s)', n;
  END IF;
  RAISE NOTICE 'PASS: refuses to call one item a bundle';
END $$;

\echo '--- 7. unavailable and quote-only stock is never composed ---'
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.items SET is_available = false
   WHERE id = '3c3c3c3c-0000-0000-0000-000000000002';
  UPDATE public.items SET is_quote_only = true
   WHERE id = '3c3c3c3c-0000-0000-0000-000000000003';

  SELECT count(*) INTO n
  FROM kithly_reco.compose_bundle(
         '1a1a1a1a-0000-0000-0000-000000000001', 60000,
         '2b2b2b2b-0000-0000-0000-000000000001', 4) b
  WHERE b.item_id IN ('3c3c3c3c-0000-0000-0000-000000000002',
                      '3c3c3c3c-0000-0000-0000-000000000003');

  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL: composed % items that cannot be bought', n;
  END IF;
  RAISE NOTICE 'PASS: only sellable stock';

  UPDATE public.items SET is_available = true
   WHERE id = '3c3c3c3c-0000-0000-0000-000000000002';
  UPDATE public.items SET is_quote_only = false
   WHERE id = '3c3c3c3c-0000-0000-0000-000000000003';
END $$;

\echo '--- 8. a dismissal is recorded, because that is the point ---'
DO $$
DECLARE p uuid; dismissals integer; st text;
BEGIN
  DELETE FROM kithly_reco.signals WHERE user_id = 'ffff6666-0000-0000-0000-000000000001';

  INSERT INTO kithly_reco.proposals
    (user_id, kind, surface, item_ids, total_zmw, reason_code, reason_text)
  VALUES ('ffff6666-0000-0000-0000-000000000001', 'bundle', 'storefront',
          ARRAY['3c3c3c3c-0000-0000-0000-000000000001'::uuid,
                '3c3c3c3c-0000-0000-0000-000000000002'::uuid],
          26000, 'complement', 'Sweets go well with that cake')
  RETURNING id INTO p;

  PERFORM kithly_reco.respond_to_proposal(p, false);

  SELECT status INTO st FROM kithly_reco.proposals WHERE id = p;
  IF st <> 'dismissed' THEN RAISE EXCEPTION 'FAIL: status is %', st; END IF;

  SELECT count(*) INTO dismissals FROM kithly_reco.signals
   WHERE user_id = 'ffff6666-0000-0000-0000-000000000001' AND action = 'dismiss';
  IF dismissals <> 2 THEN
    RAISE EXCEPTION 'FAIL: % dismiss signals for a 2-item proposal, expected 2', dismissals;
  END IF;
  RAISE NOTICE 'PASS: dismissal recorded against every item in it';
END $$;

\echo '--- 9. answering twice does not double-count ---'
DO $$
DECLARE p uuid; n integer;
BEGIN
  DELETE FROM kithly_reco.signals WHERE user_id = 'ffff6666-0000-0000-0000-000000000001';

  INSERT INTO kithly_reco.proposals
    (user_id, kind, surface, item_ids, reason_code, reason_text)
  VALUES ('ffff6666-0000-0000-0000-000000000001', 'restock', 'list',
          ARRAY['3c3c3c3c-0000-0000-0000-000000000003'::uuid],
          'restock', 'You usually restock this about now')
  RETURNING id INTO p;

  PERFORM kithly_reco.respond_to_proposal(p, true);
  PERFORM kithly_reco.respond_to_proposal(p, false);

  SELECT count(*) INTO n FROM kithly_reco.signals
   WHERE user_id = 'ffff6666-0000-0000-0000-000000000001';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: % signals after answering twice, expected 1', n;
  END IF;

  IF (SELECT status FROM kithly_reco.proposals WHERE id = p) <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL: the second answer overwrote the first';
  END IF;
  RAISE NOTICE 'PASS: the first answer stands';
END $$;

\echo '--- 10. an ignored proposal lapses rather than vanishing ---'
DO $$
DECLARE p uuid; n integer; st text;
BEGIN
  INSERT INTO kithly_reco.proposals
    (user_id, kind, surface, item_ids, reason_code, reason_text, expires_at)
  VALUES ('ffff6666-0000-0000-0000-000000000001', 'occasion', 'rail',
          ARRAY['3c3c3c3c-0000-0000-0000-000000000001'::uuid],
          'occasion', 'Mercy''s graduation is in 9 days',
          now() - interval '1 day')
  RETURNING id INTO p;

  n := kithly_reco.expire_proposals();
  SELECT status INTO st FROM kithly_reco.proposals WHERE id = p;

  IF st IS NULL THEN
    RAISE EXCEPTION 'FAIL: an ignored proposal was deleted -- that is evidence too';
  END IF;
  IF st <> 'expired' THEN RAISE EXCEPTION 'FAIL: status is %', st; END IF;
  RAISE NOTICE 'PASS: lapsed, not deleted';
END $$;

\echo '--- 11. a client cannot fabricate a proposal ---'
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', 'ffff6666-0000-0000-0000-000000000001', true);

  BEGIN
    INSERT INTO kithly_reco.proposals
      (user_id, kind, surface, item_ids, reason_code, reason_text)
    VALUES ('ffff6666-0000-0000-0000-000000000001', 'bundle', 'storefront',
            ARRAY['3c3c3c3c-0000-0000-0000-000000000001'::uuid],
            'fake', 'I recommended this to myself');
    RAISE EXCEPTION 'FAIL: a client wrote its own proposal -- it could fabricate the ranker''s evidence';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: proposals come from the platform only';
  END;
  RESET ROLE;
END $$;

\echo '--- 12. signals are stamped by the server, not the client ---'
DO $$
DECLARE mine integer; theirs integer;
BEGIN
  DELETE FROM kithly_reco.signals;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', 'ffff6666-0000-0000-0000-000000000001', true);

  -- A client claiming to be somebody else. The claim must be ignored, not
  -- honoured -- poisoned signals become a poisoned ranker.
  PERFORM public.record_signals(jsonb_build_array(
    jsonb_build_object(
      'user_id', '99999999-9999-9999-9999-999999999999',
      'surface', 'storefront', 'action', 'tap',
      'subject_type', 'item', 'subject_id', '3c3c3c3c-0000-0000-0000-000000000001'
    )
  ));
  RESET ROLE;

  SELECT count(*) INTO mine FROM kithly_reco.signals
   WHERE user_id = 'ffff6666-0000-0000-0000-000000000001';
  SELECT count(*) INTO theirs FROM kithly_reco.signals
   WHERE user_id = '99999999-9999-9999-9999-999999999999';

  IF theirs > 0 THEN
    RAISE EXCEPTION 'FAIL: a client attributed % signals to another user', theirs;
  END IF;
  IF mine <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1 signal stamped with the caller, got %', mine;
  END IF;
  RAISE NOTICE 'PASS: the caller does not get to say who they are';
END $$;

\echo '--- 13. one malformed signal does not cost the good ones beside it ---'
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM kithly_reco.signals;

  PERFORM public.record_signals(jsonb_build_array(
    jsonb_build_object('surface','storefront','action','tap','subject_type','item',
                       'subject_id','3c3c3c3c-0000-0000-0000-000000000001'),
    -- an action this build has never heard of, from a newer client
    jsonb_build_object('surface','storefront','action','hovered','subject_type','item',
                       'subject_id','3c3c3c3c-0000-0000-0000-000000000002'),
    jsonb_build_object('surface','storefront','action','save','subject_type','item',
                       'subject_id','3c3c3c3c-0000-0000-0000-000000000003')
  ));

  SELECT count(*) INTO n FROM kithly_reco.signals;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected the 2 valid signals to survive, got %', n;
  END IF;
  RAISE NOTICE 'PASS: the batch survived a bad row';
END $$;

\echo '--- 14. dropping the recommender does not break the platform ---'
DO $$
BEGIN
  -- The rule Stage 1d set: kithly_reco can be dropped wholesale. This function
  -- is the one public reference to it, so it is the one that has to stay soft.
  IF to_regclass('kithly_reco.signals') IS NULL THEN
    RAISE EXCEPTION 'FAIL: the test cannot check this without the schema present';
  END IF;
  PERFORM public.record_signals('[]'::jsonb);
  PERFORM public.record_signals(NULL);
  RAISE NOTICE 'PASS: empty and null payloads are no-ops rather than errors';
END $$;
