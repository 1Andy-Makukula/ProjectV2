\set ON_ERROR_STOP on
\pset pager off

-- =============================================================================
-- The buyer's service fee, and where it ends up
--
-- WHY THIS SUITE EXISTS SEPARATELY
-- --------------------------------
-- assert_escrow_lifecycle builds its order with total_amount == the sum of the
-- item prices. That is not what checkout writes: `checkout_init_atomic` sets
-- total_amount = items_subtotal + platform_fee, and the escrow funding leg
-- credits the sender with the gross.
--
-- Because the fixture had no fee, the suite could not see that redemption never
-- moved the fee out of SENDER_LIABILITY -- a fully collected order left the fee
-- in the segregated account labelled as money owed to a sender who was owed
-- nothing, and the master invariant balanced the whole time.
--
-- So every fixture here carries a real buyer fee. That is the entire point: a
-- money test whose fixture is simpler than production tests the fixture.
-- =============================================================================

TRUNCATE public.ledger_entries;
DELETE FROM public.refund_requests;
DELETE FROM public.payout_instructions;
-- Earlier suites in the run confirm a sweep for today, and
-- fee_sweeps_one_per_day_idx correctly refuses a second one. Clearing them
-- keeps assertion 2 about the escrow arithmetic rather than about suite order.
DELETE FROM public.fee_sweeps;

DELETE FROM public.users WHERE id IN (
  'bfee0000-0000-0000-0000-0000000000b1',
  'bfee0000-0000-0000-0000-0000000000c1');
INSERT INTO public.users (id, role) VALUES
  ('bfee0000-0000-0000-0000-0000000000b1', 'sender'),
  ('bfee0000-0000-0000-0000-0000000000c1', 'merchant');

DELETE FROM public.shops WHERE id = 'bfee0000-0000-0000-0000-000000000001';
INSERT INTO public.shops (id, owner_id, name, is_active) VALUES
  ('bfee0000-0000-0000-0000-000000000001', 'bfee0000-0000-0000-0000-0000000000c1', 'Buyer Fee Shop', true);
INSERT INTO public.merchant_shops (user_id, shop_id) VALUES
  ('bfee0000-0000-0000-0000-0000000000c1', 'bfee0000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO public.merchant_payout_destinations
  (shop_id, rail, account_identifier, account_name, verification_status, verification_method, verified_at)
VALUES ('bfee0000-0000-0000-0000-000000000001', 'airtel_money', '+260977222333',
        'Buyer Fee Shop', 'verified', 'airtel_name_lookup', now());

UPDATE public.platform_settings SET merchant_fee_percent = 2.00 WHERE id = 1;
UPDATE public.payment_rails SET is_available = true, manually_disabled = false;

\echo '--- 1. a fully collected order owes the sender nothing at all ---'
DO $$
DECLARE v_liability bigint; v_fees bigint; v_payable bigint;
BEGIN
  -- K1,000 of items, 8% buyer fee -> the buyer is charged K1,080.
  -- Amounts are ngwee: this schema stores minor units despite the _zmw names.
  INSERT INTO public.transactions
    (transaction_id, buyer_id, gateway_tx_ref, gateway_reference, total_amount,
     currency, status, platform_fee, items_subtotal)
  VALUES ('bfee0000-0000-0000-0000-00000000f001', 'bfee0000-0000-0000-0000-0000000000b1',
          'kithly-ref-1', '9911223344', 108000, 'ZMW', 'SUCCESS', 8000, 100000);

  INSERT INTO public.shop_orders
    (shop_order_id, transaction_id, shop_id, claim_code, claim_status, subtotal, expires_at)
  VALUES ('bfee0000-0000-0000-0000-00000000e001', 'bfee0000-0000-0000-0000-00000000f001',
          'bfee0000-0000-0000-0000-000000000001', 'BFEE0001', 'PENDING', 100000,
          now() + interval '14 days');

  INSERT INTO public.items (id, shop_id, name, price_zmw, is_available)
  VALUES ('bfee0000-0000-0000-0000-0000000000a1', 'bfee0000-0000-0000-0000-000000000001',
          'Fee item', 100000, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.order_items
    (order_item_id, shop_order_id, item_id, allocated_price, fulfillment_status)
  VALUES ('bfee0000-0000-0000-0000-00000000d001', 'bfee0000-0000-0000-0000-00000000e001',
          'bfee0000-0000-0000-0000-0000000000a1', 100000, 'PENDING');

  PERFORM public.escrow_record_funding('bfee0000-0000-0000-0000-00000000f001', 'flw-bfee-1');

  IF public.ledger_account_balance('SENDER_LIABILITY', 'bfee0000-0000-0000-0000-0000000000b1') <> 108000 THEN
    RAISE EXCEPTION 'FAIL: funding credited % ngwee, expected the gross 108000',
      public.ledger_account_balance('SENDER_LIABILITY', 'bfee0000-0000-0000-0000-0000000000b1');
  END IF;

  PERFORM public.escrow_redeem_items('BFEE0001',
    ARRAY['bfee0000-0000-0000-0000-00000000d001']::uuid[], '{}'::uuid[],
    'bfee0000-0000-0000-0000-0000000000c1');

  v_liability := public.ledger_account_balance('SENDER_LIABILITY', 'bfee0000-0000-0000-0000-0000000000b1');
  v_fees      := public.ledger_account_balance('FEE_ACCRUED');
  v_payable   := public.ledger_account_balance('MERCHANT_PAYABLE', 'bfee0000-0000-0000-0000-000000000001');

  -- THE ASSERTION THIS SUITE EXISTS FOR.
  IF v_liability <> 0 THEN
    RAISE EXCEPTION
      'FAIL: % ngwee still owed to a sender whose order was collected in full -- the buyer fee is stranded again',
      v_liability;
  END IF;

  -- K20 merchant fee + K80 buyer fee.
  IF v_fees <> 10000 THEN
    RAISE EXCEPTION 'FAIL: fees accrued % ngwee, expected 10000 (2000 merchant + 8000 buyer)', v_fees;
  END IF;
  IF v_payable <> 98000 THEN
    RAISE EXCEPTION 'FAIL: merchant payable is % ngwee, expected 98000', v_payable;
  END IF;

  PERFORM public.assert_ledger_balanced();
  RAISE NOTICE 'PASS: the fee is earned at collection, and the sender is owed nothing';
END $$;

\echo '--- 2. the segregated account keeps no KithLy money once fees are swept ---'
DO $$
DECLARE v_sweep jsonb; v_id uuid; v_client bigint;
BEGIN
  -- Pay the merchant out, then sweep. Principle 2: the client funds account
  -- holds customer money ONLY. After everything settles it must be empty --
  -- which is impossible if any KithLy revenue is misfiled as a liability.
  UPDATE public.payout_instructions SET status = 'CLAIMED'
  WHERE shop_id = 'bfee0000-0000-0000-0000-000000000001';

  PERFORM public.complete_payout(id, 'airtel-bfee-1')
  FROM public.payout_instructions
  WHERE shop_id = 'bfee0000-0000-0000-0000-000000000001' AND status = 'CLAIMED';

  v_sweep := public.propose_fee_sweep(current_date);
  v_id := (v_sweep->>'sweep_id')::uuid;

  INSERT INTO public.users (id, role) VALUES ('bfee0000-0000-0000-0000-0000000000a9', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = 'admin';

  PERFORM public.confirm_fee_sweep(v_id, 'BANK-BFEE-1', 'bfee0000-0000-0000-0000-0000000000a9');

  v_client := public.ledger_account_balance('CLIENT_FUNDS');

  IF v_client <> 0 THEN
    RAISE EXCEPTION
      'FAIL: % ngwee left in the client funds account after everything settled -- that is KithLy money in a customer account',
      v_client;
  END IF;

  PERFORM public.assert_ledger_balanced();
  RAISE NOTICE 'PASS: paid out and swept, the segregated account lands on exactly zero';
END $$;

\echo '--- 3. fee shares sum to the fee exactly, however the basket splits ---'
DO $$
DECLARE
  v_prices integer[];
  v_fee integer;
  v_tx uuid; v_so uuid; v_item uuid;
  v_total_shares bigint; v_expected bigint;
  v_case integer; v_i integer; v_oi uuid;
BEGIN
  INSERT INTO public.items (id, shop_id, name, price_zmw, is_available)
  VALUES ('bfee0000-0000-0000-0000-0000000000a2', 'bfee0000-0000-0000-0000-000000000001',
          'Split item', 1, true)
  ON CONFLICT (id) DO NOTHING;
  v_item := 'bfee0000-0000-0000-0000-0000000000a2';

  -- Deliberately awkward splits: threes that never divide cleanly, a single
  -- ngwee line, and wildly unequal amounts. If the allocation loses a ngwee it
  -- will lose it on one of these.
  FOR v_case IN 1..5 LOOP
    v_prices := CASE v_case
      WHEN 1 THEN ARRAY[1, 1, 1]
      WHEN 2 THEN ARRAY[333, 333, 334]
      WHEN 3 THEN ARRAY[1, 9999]
      WHEN 4 THEN ARRAY[7, 7, 7, 7, 7, 7, 7]
      ELSE        ARRAY[100, 200, 300, 400, 500, 600, 700]
    END;
    v_fee := GREATEST(1, (SELECT SUM(p) FROM unnest(v_prices) p) * 8 / 100);

    v_tx := gen_random_uuid(); v_so := gen_random_uuid();

    INSERT INTO public.transactions
      (transaction_id, buyer_id, gateway_tx_ref, total_amount, currency, status,
       platform_fee, items_subtotal)
    VALUES (v_tx, 'bfee0000-0000-0000-0000-0000000000b1', 'split-' || v_case,
            (SELECT SUM(p) FROM unnest(v_prices) p) + v_fee, 'ZMW', 'SUCCESS',
            v_fee, (SELECT SUM(p) FROM unnest(v_prices) p));

    INSERT INTO public.shop_orders
      (shop_order_id, transaction_id, shop_id, claim_code, claim_status, subtotal)
    VALUES (v_so, v_tx, 'bfee0000-0000-0000-0000-000000000001',
            'SPLIT' || v_case::text, 'PENDING',
            (SELECT SUM(p) FROM unnest(v_prices) p));

    FOR v_i IN 1..array_length(v_prices, 1) LOOP
      INSERT INTO public.order_items
        (order_item_id, shop_order_id, item_id, allocated_price, fulfillment_status)
      VALUES (gen_random_uuid(), v_so, v_item, v_prices[v_i], 'PENDING');
    END LOOP;

    SELECT COALESCE(SUM(public.order_item_fee_share_ngwee(oi.order_item_id)), 0)
    INTO v_total_shares
    FROM public.order_items oi WHERE oi.shop_order_id = v_so;

    v_expected := v_fee::bigint;

    IF v_total_shares <> v_expected THEN
      RAISE EXCEPTION
        'FAIL: case % -- shares sum to % ngwee but the fee is % ngwee (a ngwee would be stranded)',
        v_case, v_total_shares, v_expected;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: 5 awkward splits allocate the fee to the exact ngwee';
END $$;

\echo '--- 4. an item''s share does not move between redemption and expiry ---'
DO $$
DECLARE v_oi uuid; v_first bigint; v_second bigint;
BEGIN
  SELECT oi.order_item_id INTO v_oi
  FROM public.order_items oi
  JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
  WHERE so.claim_code = 'SPLIT5'
  ORDER BY oi.order_item_id
  LIMIT 1;

  v_first := public.order_item_fee_share_ngwee(v_oi);

  -- Collecting other lines on the same order must not re-weight this one: the
  -- two paths ask at different times and have to get the same answer.
  UPDATE public.order_items SET fulfillment_status = 'COLLECTED'
  WHERE order_item_id <> v_oi
    AND shop_order_id = (SELECT shop_order_id FROM public.order_items WHERE order_item_id = v_oi);

  v_second := public.order_item_fee_share_ngwee(v_oi);

  IF v_first <> v_second THEN
    RAISE EXCEPTION 'FAIL: share moved from % to % as siblings were collected', v_first, v_second;
  END IF;
  RAISE NOTICE 'PASS: a line''s fee share is stable across the order''s lifetime';
END $$;

\echo '--- 5. expiry returns the service fee as well as the goods ---'
DO $$
DECLARE v_refund RECORD;
BEGIN
  INSERT INTO public.transactions
    (transaction_id, buyer_id, gateway_tx_ref, gateway_reference, total_amount,
     currency, status, platform_fee, items_subtotal)
  VALUES ('bfee0000-0000-0000-0000-00000000f002', 'bfee0000-0000-0000-0000-0000000000b1',
          'kithly-ref-2', '9955667788', 54000, 'ZMW', 'SUCCESS', 4000, 50000);

  INSERT INTO public.shop_orders
    (shop_order_id, transaction_id, shop_id, claim_code, claim_status, subtotal, expires_at)
  VALUES ('bfee0000-0000-0000-0000-00000000e002', 'bfee0000-0000-0000-0000-00000000f002',
          'bfee0000-0000-0000-0000-000000000001', 'BFEE0002', 'PENDING', 50000,
          now() - interval '1 day');

  INSERT INTO public.order_items
    (order_item_id, shop_order_id, item_id, allocated_price, fulfillment_status)
  VALUES ('bfee0000-0000-0000-0000-00000000d002', 'bfee0000-0000-0000-0000-00000000e002',
          'bfee0000-0000-0000-0000-0000000000a1', 50000, 'PENDING');

  PERFORM public.escrow_record_funding('bfee0000-0000-0000-0000-00000000f002', 'flw-bfee-2');
  PERFORM public.escrow_process_expiries(50);

  SELECT * INTO v_refund FROM public.refund_requests
  WHERE order_item_id = 'bfee0000-0000-0000-0000-00000000d002';

  IF v_refund IS NULL THEN RAISE EXCEPTION 'FAIL: expiry created no refund'; END IF;

  -- K500 of goods plus the K40 fee. The service did not happen; charging for
  -- it would be the same thing §7 refuses to do with merchant compensation.
  IF v_refund.amount_ngwee <> 54000 THEN
    RAISE EXCEPTION 'FAIL: refund is % ngwee, expected the full 54000 including the fee',
      v_refund.amount_ngwee;
  END IF;

  IF public.ledger_account_balance('SENDER_LIABILITY', 'bfee0000-0000-0000-0000-0000000000b1')
     < 54000 THEN
    RAISE EXCEPTION 'FAIL: the liability no longer covers the refund we promised';
  END IF;

  RAISE NOTICE 'PASS: an expired gift refunds the goods and the service fee';
END $$;

\echo '--- 6. a refund is addressed to the gateway''s charge id, not ours ---'
DO $$
DECLARE v_ref text;
BEGIN
  SELECT original_ref INTO v_ref FROM public.refund_requests
  WHERE order_item_id = 'bfee0000-0000-0000-0000-00000000d002';

  -- gateway_tx_ref is the reference KithLy generates and sends TO Flutterwave.
  -- gateway_reference is Flutterwave's own charge id, read back out of their
  -- response. A refund issued against the former is addressed to an id they
  -- have never heard of.
  IF v_ref = 'kithly-ref-2' THEN
    RAISE EXCEPTION 'FAIL: the refund is addressed to our own tx_ref -- Flutterwave will reject it';
  END IF;
  IF v_ref IS DISTINCT FROM '9955667788' THEN
    RAISE EXCEPTION 'FAIL: refund target is %, expected the gateway charge id 9955667788', v_ref;
  END IF;

  RAISE NOTICE 'PASS: refunds are addressed to the gateway charge id';
END $$;

TRUNCATE public.ledger_entries;
UPDATE public.platform_settings SET escrow_mode = 'dual_write' WHERE id = 1;

\echo '--- 7. a kwacha refund is issued against the charge, in kwacha ---'
DO $$
DECLARE v_refund uuid; v_ins jsonb;
BEGIN
  SELECT id INTO v_refund FROM public.refund_requests
  WHERE order_item_id = 'bfee0000-0000-0000-0000-00000000d002';

  v_ins := public.refund_charge_instruction(v_refund);

  IF NOT (v_ins->>'ok')::boolean THEN
    RAISE EXCEPTION 'FAIL: no instruction could be built: %', v_ins->>'reason';
  END IF;
  IF v_ins->>'currency' <> 'ZMW' THEN
    RAISE EXCEPTION 'FAIL: a domestic refund was denominated in %', v_ins->>'currency';
  END IF;
  IF v_ins->>'gateway_charge_id' <> '9955667788' THEN
    RAISE EXCEPTION 'FAIL: instruction targets %, not the gateway charge id', v_ins->>'gateway_charge_id';
  END IF;
  -- K540 refunded out of a K540 charge: the whole thing.
  IF (v_ins->>'amount_minor')::bigint <> 54000 THEN
    RAISE EXCEPTION 'FAIL: amount is % ngwee, expected 54000', v_ins->>'amount_minor';
  END IF;
  IF v_ins->>'amount_major' <> '540.00' THEN
    RAISE EXCEPTION 'FAIL: wire amount is %, expected 540.00 major units', v_ins->>'amount_major';
  END IF;
  IF (v_ins->>'is_foreign')::boolean THEN
    RAISE EXCEPTION 'FAIL: a kwacha charge was reported as foreign';
  END IF;

  RAISE NOTICE 'PASS: domestic refunds go back in kwacha, against the right charge';
END $$;

\echo '--- 8. a pound charge refunds in pounds, as a share of what was billed ---'
DO $$
DECLARE v_refund uuid; v_ins jsonb; v_oi uuid := 'bfee0000-0000-0000-0000-00000000d003';
BEGIN
  -- A sender in London: billed £100.00 for a K1,080 basket (K1,000 of items
  -- plus the 8% fee). charge_currency/charge_amount_minor carry the pounds;
  -- total_amount stays kwacha, which is what actually settles here.
  INSERT INTO public.transactions
    (transaction_id, buyer_id, gateway_tx_ref, gateway_reference, total_amount,
     currency, status, platform_fee, items_subtotal,
     charge_currency, charge_amount_minor)
  VALUES ('bfee0000-0000-0000-0000-00000000f003', 'bfee0000-0000-0000-0000-0000000000b1',
          'kithly-ref-3', '9977001122', 108000, 'ZMW', 'SUCCESS', 8000, 100000,
          'GBP', 10000);

  INSERT INTO public.shop_orders
    (shop_order_id, transaction_id, shop_id, claim_code, claim_status, subtotal, expires_at)
  VALUES ('bfee0000-0000-0000-0000-00000000e003', 'bfee0000-0000-0000-0000-00000000f003',
          'bfee0000-0000-0000-0000-000000000001', 'BFEE0003', 'PENDING', 100000,
          now() - interval '1 day');

  INSERT INTO public.order_items
    (order_item_id, shop_order_id, item_id, allocated_price, fulfillment_status)
  VALUES (v_oi, 'bfee0000-0000-0000-0000-00000000e003',
          'bfee0000-0000-0000-0000-0000000000a1', 100000, 'PENDING');

  PERFORM public.escrow_record_funding('bfee0000-0000-0000-0000-00000000f003', 'flw-bfee-3');
  PERFORM public.escrow_process_expiries(50);

  SELECT id INTO v_refund FROM public.refund_requests WHERE order_item_id = v_oi;
  IF v_refund IS NULL THEN RAISE EXCEPTION 'FAIL: the expired pound order created no refund'; END IF;

  v_ins := public.refund_charge_instruction(v_refund);

  IF NOT (v_ins->>'ok')::boolean THEN
    RAISE EXCEPTION 'FAIL: no instruction for a foreign charge: %', v_ins->>'reason';
  END IF;
  IF v_ins->>'currency' <> 'GBP' THEN
    RAISE EXCEPTION 'FAIL: a pound charge refunds in %, which is not what they paid', v_ins->>'currency';
  END IF;
  -- The whole basket expired, so the whole charge comes back: 10000 pence.
  -- Critically this is a proportion of what was BILLED, not a reconversion of
  -- the kwacha -- so no exchange rate was consulted and none can have moved.
  IF (v_ins->>'amount_minor')::bigint <> 10000 THEN
    RAISE EXCEPTION 'FAIL: refund is % pence, expected the full 10000', v_ins->>'amount_minor';
  END IF;
  IF v_ins->>'amount_major' <> '100.00' THEN
    RAISE EXCEPTION 'FAIL: wire amount is %, expected 100.00', v_ins->>'amount_major';
  END IF;
  IF NOT (v_ins->>'is_foreign')::boolean THEN
    RAISE EXCEPTION 'FAIL: a GBP charge was not flagged foreign';
  END IF;

  RAISE NOTICE 'PASS: a London sender gets pounds back, at the rate they were billed';
END $$;

\echo '--- 9. partial refunds can never sum past the original charge ---'
DO $$
DECLARE v_refund uuid; v_ins jsonb;
BEGIN
  -- The pound charge above is now fully refunded. A second refund against the
  -- same charge -- a late partial, a duplicate -- must be refused outright.
  UPDATE public.refund_requests SET status = 'COMPLETED', completed_at = now(),
         ledger_pair_id = gen_random_uuid()
  WHERE order_item_id = 'bfee0000-0000-0000-0000-00000000d003';

  INSERT INTO public.refund_requests
    (transaction_id, shop_order_id, buyer_id, amount_ngwee, reason,
     original_ref, idempotency_key)
  VALUES ('bfee0000-0000-0000-0000-00000000f003', 'bfee0000-0000-0000-0000-00000000e003',
          'bfee0000-0000-0000-0000-0000000000b1', 5000, 'ADMIN',
          '9977001122', 'overdraw-attempt')
  RETURNING id INTO v_refund;

  v_ins := public.refund_charge_instruction(v_refund);

  IF (v_ins->>'ok')::boolean THEN
    RAISE EXCEPTION
      'FAIL: a second refund was authorised against a charge already refunded in full (% %)',
      v_ins->>'amount_major', v_ins->>'currency';
  END IF;
  IF v_ins->>'reason' <> 'FULLY_REFUNDED' THEN
    RAISE EXCEPTION 'FAIL: refused for the wrong reason: %', v_ins->>'reason';
  END IF;

  RAISE NOTICE 'PASS: the gateway can never be asked to refund more than it took';
END $$;

\echo '--- 10. a charge with no gateway id is refused, not guessed at ---'
DO $$
DECLARE v_refund uuid; v_ins jsonb;
BEGIN
  INSERT INTO public.transactions
    (transaction_id, buyer_id, gateway_tx_ref, total_amount, currency, status,
     platform_fee, items_subtotal)
  VALUES ('bfee0000-0000-0000-0000-00000000f004', 'bfee0000-0000-0000-0000-0000000000b1',
          'kithly-ref-4', 20000, 'ZMW', 'SUCCESS', 0, 20000);

  INSERT INTO public.refund_requests
    (transaction_id, buyer_id, amount_ngwee, reason, idempotency_key)
  VALUES ('bfee0000-0000-0000-0000-00000000f004', 'bfee0000-0000-0000-0000-0000000000b1',
          20000, 'ADMIN', 'no-gateway-id')
  RETURNING id INTO v_refund;

  v_ins := public.refund_charge_instruction(v_refund);

  IF (v_ins->>'ok')::boolean THEN
    RAISE EXCEPTION 'FAIL: a refund was addressed to a transaction with no gateway charge id';
  END IF;
  IF v_ins->>'reason' <> 'NO_GATEWAY_REFERENCE' THEN
    RAISE EXCEPTION 'FAIL: refused for the wrong reason: %', v_ins->>'reason';
  END IF;

  RAISE NOTICE 'PASS: an unaddressable refund stops rather than improvising';
END $$;
