\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.users WHERE id = '4d4d4d4d-0000-0000-0000-000000000001';
DELETE FROM public.shops WHERE id = '5e5e5e5e-0000-0000-0000-000000000001';

INSERT INTO public.users (id, role) VALUES
  ('4d4d4d4d-0000-0000-0000-000000000001', 'sender');
INSERT INTO public.shops (id, name, is_active) VALUES
  ('5e5e5e5e-0000-0000-0000-000000000001', 'Sweep Shop', true);
INSERT INTO public.items (id, shop_id, name, price_zmw, is_available) VALUES
  ('6f6f6f6f-0000-0000-0000-000000000001', '5e5e5e5e-0000-0000-0000-000000000001', 'Maize meal', 9000, true),
  ('6f6f6f6f-0000-0000-0000-000000000002', '5e5e5e5e-0000-0000-0000-000000000001', 'Cooking oil', 5000, true);

-- One buyer, one transaction, many collected orders over time.
INSERT INTO public.transactions (transaction_id, buyer_id) VALUES
  ('7a7a7a7a-0000-0000-0000-000000000001', '4d4d4d4d-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

/* Records one collected purchase of an item, on a given day. */
CREATE OR REPLACE FUNCTION pg_temp.bought(p_item uuid, p_on date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_order uuid;
BEGIN
  INSERT INTO public.shop_orders (shop_id, claim_status, fulfilled_at, transaction_id)
  VALUES ('5e5e5e5e-0000-0000-0000-000000000001', 'REDEEMED', p_on::timestamptz,
          '7a7a7a7a-0000-0000-0000-000000000001')
  RETURNING shop_order_id INTO v_order;
  INSERT INTO public.order_items (shop_order_id, item_id) VALUES (v_order, p_item);
END $$;

\echo '--- 1. two purchases is a coincidence, not a habit ---'
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM kithly_reco.proposals WHERE user_id = '4d4d4d4d-0000-0000-0000-000000000001';

  -- Bought twice, 20 days apart. Due in 3 days if this counted -- it must not.
  PERFORM pg_temp.bought('6f6f6f6f-0000-0000-0000-000000000001', current_date - 40);
  PERFORM pg_temp.bought('6f6f6f6f-0000-0000-0000-000000000001', current_date - 20);

  n := kithly_reco.sweep_restock_proposals(current_date, 3);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: proposed from two purchases -- that is a guess, not a rhythm';
  END IF;
  RAISE NOTICE 'PASS: two purchases proposes nothing';
END $$;

\echo '--- 2. three makes a rhythm, and it fires at the lead ---'
DO $$
DECLARE n integer; txt text;
BEGIN
  -- A third, so gaps are 20 and 20. Last bought today-20, so due today+0...
  -- with a 3-day lead the sweep should fire when due = today + 3, i.e. run it
  -- as though today were 3 days before the due date.
  PERFORM pg_temp.bought('6f6f6f6f-0000-0000-0000-000000000001', current_date);

  -- gaps are now 20 and 20; last bought today; due today+20.
  n := kithly_reco.sweep_restock_proposals(current_date + 17, 3);
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected 1 proposal at the lead, got %', n;
  END IF;

  SELECT reason_text INTO txt FROM kithly_reco.proposals
   WHERE user_id = '4d4d4d4d-0000-0000-0000-000000000001' AND status = 'proposed';
  IF txt NOT LIKE '%every 20 days%' THEN
    RAISE EXCEPTION 'FAIL: the reason does not state the rhythm: %', txt;
  END IF;
  RAISE NOTICE 'PASS: "%"', txt;
END $$;

\echo '--- 3. it does not ask twice while the first is unanswered ---'
DO $$
DECLARE n integer;
BEGIN
  n := kithly_reco.sweep_restock_proposals(current_date + 17, 3);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: proposed the same item again while one was open';
  END IF;
  RAISE NOTICE 'PASS: no nagging';
END $$;

\echo '--- 4. NO CATCHING UP: a missed day is not fired late ---'
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM kithly_reco.proposals WHERE user_id = '4d4d4d4d-0000-0000-0000-000000000001';

  -- A day either side of the window. Being told late that you have run out is
  -- worse than not being told, and being told early is noise.
  IF kithly_reco.sweep_restock_proposals(current_date + 16, 3) <> 0 THEN
    RAISE EXCEPTION 'FAIL: fired a day early';
  END IF;
  IF kithly_reco.sweep_restock_proposals(current_date + 18, 3) <> 0 THEN
    RAISE EXCEPTION 'FAIL: fired a day late and called it a warning';
  END IF;
  RAISE NOTICE 'PASS: the window is exact';
END $$;

\echo '--- 5. the median resists one odd gap ---'
DO $$
DECLARE txt text;
BEGIN
  DELETE FROM kithly_reco.proposals WHERE user_id = '4d4d4d4d-0000-0000-0000-000000000001';

  -- Four purchases of oil: gaps of 10, 10 and 100. The mean is 40 and would be
  -- wrong about this household; the median is 10 and is right.
  PERFORM pg_temp.bought('6f6f6f6f-0000-0000-0000-000000000002', current_date - 120);
  PERFORM pg_temp.bought('6f6f6f6f-0000-0000-0000-000000000002', current_date - 20);
  PERFORM pg_temp.bought('6f6f6f6f-0000-0000-0000-000000000002', current_date - 10);
  PERFORM pg_temp.bought('6f6f6f6f-0000-0000-0000-000000000002', current_date);

  PERFORM kithly_reco.sweep_restock_proposals(current_date + 7, 3);

  SELECT reason_text INTO txt FROM kithly_reco.proposals
   WHERE user_id = '4d4d4d4d-0000-0000-0000-000000000001'
     AND reason_text LIKE '%Cooking oil%';

  IF txt IS NULL THEN
    RAISE EXCEPTION 'FAIL: a 10-day rhythm with one outlier produced nothing';
  END IF;
  IF txt NOT LIKE '%every 10 days%' THEN
    RAISE EXCEPTION 'FAIL: the outlier skewed the rhythm: %', txt;
  END IF;
  RAISE NOTICE 'PASS: "%"', txt;
END $$;

\echo '--- 6. orders that were never collected do not form a rhythm ---'
DO $$
DECLARE n integer; v_order uuid;
BEGIN
  DELETE FROM kithly_reco.proposals WHERE user_id = '4d4d4d4d-0000-0000-0000-000000000001';
  DELETE FROM public.order_items WHERE item_id = '6f6f6f6f-0000-0000-0000-000000000002';

  -- Three orders placed and never picked up. That says something about the
  -- sender's week, not about what the household gets through.
  FOR i IN 1..3 LOOP
    INSERT INTO public.shop_orders (shop_id, claim_status, fulfilled_at, transaction_id)
    VALUES ('5e5e5e5e-0000-0000-0000-000000000001', 'EXPIRED', NULL,
            '7a7a7a7a-0000-0000-0000-000000000001')
    RETURNING shop_order_id INTO v_order;
    INSERT INTO public.order_items (shop_order_id, item_id)
    VALUES (v_order, '6f6f6f6f-0000-0000-0000-000000000002');
  END LOOP;

  n := kithly_reco.sweep_restock_proposals(current_date + 7, 3);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: built a rhythm from % uncollected orders', n;
  END IF;
  RAISE NOTICE 'PASS: only what was actually collected counts';
END $$;

\echo '--- 7. an unavailable item is not proposed ---'
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM kithly_reco.proposals WHERE user_id = '4d4d4d4d-0000-0000-0000-000000000001';
  UPDATE public.items SET is_available = false
   WHERE id = '6f6f6f6f-0000-0000-0000-000000000001';

  n := kithly_reco.sweep_restock_proposals(current_date + 17, 3);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: proposed something that cannot be bought';
  END IF;
  RAISE NOTICE 'PASS: nothing out of stock is proposed';

  UPDATE public.items SET is_available = true
   WHERE id = '6f6f6f6f-0000-0000-0000-000000000001';
END $$;
