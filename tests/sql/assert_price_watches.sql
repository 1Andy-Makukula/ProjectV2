\set ON_ERROR_STOP on
\pset pager off

-- NOTE ON FIXTURES
-- item_price_events is append-only, so this file cannot clear it between
-- assertions the way the other suites clear their tables. Every assertion is
-- therefore scoped to its own item and counts only that item's events. Deleting
-- the users and shop cascades the items away, which takes their events with
-- them -- that is the one legitimate way rows leave this table.
DELETE FROM public.notifications;
DELETE FROM public.price_watches WHERE user_id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.users WHERE id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.shops WHERE id = 'a1a1a1a1-0000-0000-0000-000000000001';

INSERT INTO public.users (id, role) VALUES
  ('77777777-7777-7777-7777-777777777777', 'sender');
INSERT INTO public.shops (id, name) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'Mama Africa');

-- One item per assertion, so counts never collide.
INSERT INTO public.items (id, shop_id, name, price_zmw, is_available) VALUES
  ('b1b1b1b1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'Chocolate cake', 20000, true),
  ('b1b1b1b1-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000001', 'Scones',          5000, true),
  ('b1b1b1b1-0000-0000-0000-000000000003', 'a1a1a1a1-0000-0000-0000-000000000001', 'Maheu',           3000, true),
  ('b1b1b1b1-0000-0000-0000-000000000004', 'a1a1a1a1-0000-0000-0000-000000000001', 'Fritters',        4000, true),
  ('b1b1b1b1-0000-0000-0000-000000000005', 'a1a1a1a1-0000-0000-0000-000000000001', 'Bread',           2000, true);

\echo '--- 1. only real price movement is logged ---'
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.items SET name = 'Chocolate cake (large)'
  WHERE id = 'b1b1b1b1-0000-0000-0000-000000000001';

  SELECT count(*) INTO n FROM public.item_price_events
  WHERE item_id = 'b1b1b1b1-0000-0000-0000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: a non-price edit wrote % price events', n; END IF;

  UPDATE public.items SET price_zmw = 15000, is_discounted = true, original_price_zmw = 20000
  WHERE id = 'b1b1b1b1-0000-0000-0000-000000000001';

  SELECT count(*) INTO n FROM public.item_price_events
  WHERE item_id = 'b1b1b1b1-0000-0000-0000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: a price cut wrote % events, expected 1', n; END IF;
  RAISE NOTICE 'PASS: non-price edits ignored, a real cut recorded';
END $$;

\echo '--- 2. a discount label with no price movement is not a drop ---'
DO $$
DECLARE events integer; drops integer;
BEGIN
  -- The cynical move: flip the flag, invent a former price, charge the same.
  UPDATE public.items SET is_discounted = true, original_price_zmw = 9000
  WHERE id = 'b1b1b1b1-0000-0000-0000-000000000002';

  SELECT count(*) INTO events FROM public.item_price_events
   WHERE item_id = 'b1b1b1b1-0000-0000-0000-000000000002';
  SELECT count(*) INTO drops FROM public.item_price_events
   WHERE item_id = 'b1b1b1b1-0000-0000-0000-000000000002' AND is_drop;

  IF events <> 1 THEN RAISE EXCEPTION 'FAIL: the flag flip should still be recorded, got %', events; END IF;
  IF drops <> 0 THEN
    RAISE EXCEPTION 'FAIL: a label change counted as a drop -- watchers alerted about nothing';
  END IF;
  RAISE NOTICE 'PASS: recorded, but not treated as a drop';
END $$;

\echo '--- 3. the price log cannot be rewritten ---'
DO $$
DECLARE failures text[] := '{}';
BEGIN
  BEGIN
    UPDATE public.item_price_events SET new_price_zmw = 1
     WHERE item_id = 'b1b1b1b1-0000-0000-0000-000000000001';
    failures := failures || 'UPDATE permitted';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.item_price_events
     WHERE item_id = 'b1b1b1b1-0000-0000-0000-000000000001';
    failures := failures || 'DELETE permitted';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: price history is append-only';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;

\echo '--- 4. an item watch alerts on a drop, once ---'
DO $$
DECLARE notes integer; acts jsonb;
BEGIN
  DELETE FROM public.notifications;

  INSERT INTO public.price_watches (user_id, item_id)
  VALUES ('77777777-7777-7777-7777-777777777777', 'b1b1b1b1-0000-0000-0000-000000000003');

  UPDATE public.items SET price_zmw = 2000 WHERE id = 'b1b1b1b1-0000-0000-0000-000000000003';

  PERFORM public.dispatch_price_alerts(current_date);
  SELECT count(*) INTO notes FROM public.notifications WHERE type = 'price_drop';
  IF notes <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 alert, got %', notes; END IF;

  SELECT actions INTO acts FROM public.notifications WHERE type = 'price_drop' LIMIT 1;
  IF acts IS NULL OR jsonb_array_length(acts) <> 2 THEN
    RAISE EXCEPTION 'FAIL: alert carried no usable actions';
  END IF;

  -- Same day again must not ping twice.
  UPDATE public.items SET price_zmw = 1800 WHERE id = 'b1b1b1b1-0000-0000-0000-000000000003';
  PERFORM public.dispatch_price_alerts(current_date);
  SELECT count(*) INTO notes FROM public.notifications WHERE type = 'price_drop';
  IF notes <> 1 THEN RAISE EXCEPTION 'FAIL: re-running alerted again (% total)', notes; END IF;

  RAISE NOTICE 'PASS: alerted once, with % actions attached', jsonb_array_length(acts);
END $$;

\echo '--- 5. a target price suppresses a drop that has not gone far enough ---'
DO $$
DECLARE notes integer;
BEGIN
  DELETE FROM public.notifications;

  INSERT INTO public.price_watches (user_id, item_id, target_zmw)
  VALUES ('77777777-7777-7777-7777-777777777777', 'b1b1b1b1-0000-0000-0000-000000000004', 2000);

  UPDATE public.items SET price_zmw = 3500 WHERE id = 'b1b1b1b1-0000-0000-0000-000000000004';
  PERFORM public.dispatch_price_alerts(current_date);
  SELECT count(*) INTO notes FROM public.notifications WHERE type = 'price_drop';
  IF notes <> 0 THEN RAISE EXCEPTION 'FAIL: alerted above the target price'; END IF;

  UPDATE public.items SET price_zmw = 1500 WHERE id = 'b1b1b1b1-0000-0000-0000-000000000004';
  PERFORM public.dispatch_price_alerts(current_date);
  SELECT count(*) INTO notes FROM public.notifications WHERE type = 'price_drop';
  IF notes <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 alert once the target was met, got %', notes; END IF;

  RAISE NOTICE 'PASS: target honoured in both directions';
END $$;

\echo '--- 6. a shop watch covers items the shopper has never seen ---'
DO $$
DECLARE notes integer;
BEGIN
  DELETE FROM public.notifications;
  DELETE FROM public.price_watches WHERE user_id = '77777777-7777-7777-7777-777777777777';

  INSERT INTO public.price_watches (user_id, shop_id)
  VALUES ('77777777-7777-7777-7777-777777777777', 'a1a1a1a1-0000-0000-0000-000000000001');

  UPDATE public.items SET price_zmw = 1200 WHERE id = 'b1b1b1b1-0000-0000-0000-000000000005';
  PERFORM public.dispatch_price_alerts(current_date);

  SELECT count(*) INTO notes FROM public.notifications WHERE type = 'price_drop';
  IF notes <> 1 THEN RAISE EXCEPTION 'FAIL: shop watch produced % alerts, expected 1', notes; END IF;
  RAISE NOTICE 'PASS: shop-wide watch alerted';
END $$;

\echo '--- 7. an unavailable item never alerts ---'
DO $$
DECLARE notes integer;
BEGIN
  DELETE FROM public.notifications;
  -- Isolated to one item and one watch. A shop watch left in place would
  -- legitimately alert about the other items dropped earlier in this suite,
  -- and counting every price_drop would then accuse the job of a bug it does
  -- not have.
  DELETE FROM public.price_watches WHERE user_id = '77777777-7777-7777-7777-777777777777';

  UPDATE public.items SET is_available = false WHERE id = 'b1b1b1b1-0000-0000-0000-000000000005';
  INSERT INTO public.price_watches (user_id, item_id)
  VALUES ('77777777-7777-7777-7777-777777777777', 'b1b1b1b1-0000-0000-0000-000000000005');

  UPDATE public.items SET price_zmw = 600 WHERE id = 'b1b1b1b1-0000-0000-0000-000000000005';
  PERFORM public.dispatch_price_alerts(current_date);

  SELECT count(*) INTO notes FROM public.notifications
   WHERE type = 'price_drop'
     AND reference_id = 'b1b1b1b1-0000-0000-0000-000000000005';
  IF notes <> 0 THEN RAISE EXCEPTION 'FAIL: alerted about a sold-out item'; END IF;
  RAISE NOTICE 'PASS: sold-out items do not alert';
END $$;

\echo '--- 8. a fake discount is visible; an evidenced one is not accused ---'
DO $$
DECLARE flagged integer;
BEGIN
  -- Scones were never listed above 5000, yet claim a former price of 9000.
  UPDATE public.items SET price_zmw = 2500
   WHERE id = 'b1b1b1b1-0000-0000-0000-000000000002';

  SELECT count(*) INTO flagged FROM public.unevidenced_discounts
   WHERE item_id = 'b1b1b1b1-0000-0000-0000-000000000002';
  IF flagged <> 1 THEN RAISE EXCEPTION 'FAIL: an invented former price was not flagged'; END IF;

  -- The cake really was listed at 20000 earlier in this suite.
  SELECT count(*) INTO flagged FROM public.unevidenced_discounts
   WHERE item_id = 'b1b1b1b1-0000-0000-0000-000000000001';
  IF flagged <> 0 THEN RAISE EXCEPTION 'FAIL: a genuine discount was accused'; END IF;

  RAISE NOTICE 'PASS: invented discount flagged, genuine one left alone';
END $$;

\echo '--- 9. notification actions must name themselves ---'
DO $$
DECLARE failures text[] := '{}';
BEGIN
  BEGIN
    INSERT INTO public.notifications (user_id, message, type, actions)
    VALUES ('77777777-7777-7777-7777-777777777777', 'x', 'test', '[{"label":"Go"}]'::jsonb);
    failures := failures || 'an action with no type was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.notifications (user_id, message, type, actions)
    VALUES ('77777777-7777-7777-7777-777777777777', 'x', 'test', '[{"type":"open_item"}]'::jsonb);
    failures := failures || 'an action with no label was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.notifications (user_id, message, type, actions)
    VALUES ('77777777-7777-7777-7777-777777777777', 'x', 'test', '{"type":"open_item"}'::jsonb);
    failures := failures || 'a non-array actions payload was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.notifications (user_id, message, type, actions)
    VALUES ('77777777-7777-7777-7777-777777777777', 'x', 'test',
            '[{"type":"a","label":"1"},{"type":"b","label":"2"},{"type":"c","label":"3"},{"type":"d","label":"4"}]'::jsonb);
    failures := failures || 'four actions were accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- A plain message with no actions is still valid, and must stay so: every
  -- notification written before this migration has none.
  INSERT INTO public.notifications (user_id, message, type)
  VALUES ('77777777-7777-7777-7777-777777777777', 'plain', 'test');

  IF array_length(failures, 1) IS NULL THEN
    RAISE NOTICE 'PASS: action shape enforced, plain messages still allowed';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, '; ');
  END IF;
END $$;
