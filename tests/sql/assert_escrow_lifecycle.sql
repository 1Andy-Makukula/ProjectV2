\set ON_ERROR_STOP on
\pset pager off

-- =============================================================================
-- The escrow lifecycle: funding, redemption, payout, expiry, reconciliation
--
-- Where assert_escrow_ledger tests the ledger as a mechanism, this tests what
-- the money actually does -- and, more importantly, what it refuses to do.
-- Most of these assertions are about failure paths, because the failure paths
-- are where a settlement system loses money.
-- =============================================================================

TRUNCATE public.ledger_entries;
DELETE FROM public.payout_instructions;
DELETE FROM public.refund_requests;
DELETE FROM public.merchant_payout_destinations;

DELETE FROM public.order_items  WHERE shop_order_id IN
  (SELECT shop_order_id FROM public.shop_orders WHERE claim_code LIKE 'ESCROW%');
DELETE FROM public.shop_orders  WHERE claim_code LIKE 'ESCROW%';
DELETE FROM public.transactions WHERE gateway_tx_ref LIKE 'escrow-test-%';
DELETE FROM public.items WHERE id IN (
  'e1e10000-0000-0000-0000-00000000000a',
  'e1e10000-0000-0000-0000-00000000000b');
DELETE FROM public.merchant_shops WHERE shop_id = 'e5c00000-0000-0000-0000-000000000001';
DELETE FROM public.shops WHERE id = 'e5c00000-0000-0000-0000-000000000001';
DELETE FROM public.users WHERE id IN (
  'e5c00000-0000-0000-0000-0000000000b1',
  'e5c00000-0000-0000-0000-0000000000c1',
  'e5c00000-0000-0000-0000-0000000000a1');

INSERT INTO public.users (id, role) VALUES
  ('e5c00000-0000-0000-0000-0000000000b1', 'sender'),
  ('e5c00000-0000-0000-0000-0000000000a1', 'admin');
INSERT INTO public.users (id, role) VALUES
  ('e5c00000-0000-0000-0000-0000000000c1', 'merchant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shops (id, owner_id, name, is_active) VALUES
  ('e5c00000-0000-0000-0000-000000000001', 'e5c00000-0000-0000-0000-0000000000c1', 'Escrow Test Shop', true);

INSERT INTO public.merchant_shops (user_id, shop_id) VALUES
  ('e5c00000-0000-0000-0000-0000000000c1', 'e5c00000-0000-0000-0000-000000000001');

-- One ordinary item, one the merchant prepares to order and has disclosed a
-- 30% compensation term on.
INSERT INTO public.items (id, shop_id, name, price_zmw, is_available, has_expiry) VALUES
  ('e1e10000-0000-0000-0000-00000000000a', 'e5c00000-0000-0000-0000-000000000001', 'Ordinary gift', 50000, true, true);
INSERT INTO public.items (id, shop_id, name, price_zmw, is_available, has_expiry,
                          compensation_eligible, compensation_percent, compensation_reason) VALUES
  ('e1e10000-0000-0000-0000-00000000000b', 'e5c00000-0000-0000-0000-000000000001', 'Made to order cake', 40000, true, true,
   true, 30, 'Baked to order the day before collection');

UPDATE public.platform_settings SET merchant_fee_percent = 2.00 WHERE id = 1;
UPDATE public.payment_rails SET is_available = true, manually_disabled = false,
       consecutive_failures = 0;

-- A funded gift: K900 across the two items. Amounts are ngwee -- this schema
-- stores minor units throughout, despite the _zmw column names.
INSERT INTO public.transactions (transaction_id, buyer_id, gateway_tx_ref, total_amount, currency, status)
VALUES ('e7000000-0000-0000-0000-000000000001', 'e5c00000-0000-0000-0000-0000000000b1',
        'escrow-test-001', 90000, 'ZMW', 'SUCCESS');

INSERT INTO public.shop_orders (shop_order_id, transaction_id, shop_id, claim_code, claim_status, subtotal, expires_at)
VALUES ('e5000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
        'e5c00000-0000-0000-0000-000000000001', 'ESCROW01', 'PENDING', 90000, now() + interval '14 days');

INSERT INTO public.order_items (order_item_id, shop_order_id, item_id, allocated_price, fulfillment_status)
VALUES ('01000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-000000000001',
        'e1e10000-0000-0000-0000-00000000000a', 50000, 'PENDING'),
       ('01000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-000000000001',
        'e1e10000-0000-0000-0000-00000000000b', 40000, 'PENDING');

\echo '--- 1. funding credits the sender in full: no fee is taken at the door ---'
DO $$
DECLARE v_res jsonb; v_sender bigint; v_fees bigint; v_client bigint;
BEGIN
  v_res := public.escrow_record_funding('e7000000-0000-0000-0000-000000000001', 'flw-escrow-001');

  v_sender := public.ledger_account_balance('SENDER_LIABILITY', 'e5c00000-0000-0000-0000-0000000000b1');
  v_fees   := public.ledger_account_balance('FEE_ACCRUED');
  v_client := public.ledger_account_balance('CLIENT_FUNDS');

  IF v_sender <> 90000 THEN
    RAISE EXCEPTION 'FAIL: funded K900 but the sender liability is % ngwee', v_sender;
  END IF;
  IF v_fees <> 0 THEN
    RAISE EXCEPTION 'FAIL: % ngwee of fee accrued at funding -- it must accrue at redemption', v_fees;
  END IF;
  IF v_client <> 90000 THEN
    RAISE EXCEPTION 'FAIL: client funds is % after a 90000 ngwee funding', v_client;
  END IF;

  -- The webhook, delivered twice.
  PERFORM public.escrow_record_funding('e7000000-0000-0000-0000-000000000001', 'flw-escrow-001');
  IF public.ledger_account_balance('SENDER_LIABILITY', 'e5c00000-0000-0000-0000-0000000000b1') <> 90000 THEN
    RAISE EXCEPTION 'FAIL: a redelivered webhook funded the sender twice';
  END IF;

  RAISE NOTICE 'PASS: the sender is owed every ngwee they paid, once';
END $$;

\echo '--- 2. funding refuses a currency it cannot hold ---'
DO $$
DECLARE v_raised boolean := false;
BEGIN
  INSERT INTO public.transactions (transaction_id, buyer_id, gateway_tx_ref, total_amount, currency, status)
  VALUES ('e7000000-0000-0000-0000-0000000000ff', 'e5c00000-0000-0000-0000-0000000000b1',
          'escrow-test-fx', 90000, 'USD', 'SUCCESS');

  BEGIN
    PERFORM public.escrow_record_funding('e7000000-0000-0000-0000-0000000000ff', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: a USD transaction was posted into a kwacha account';
  END IF;
  RAISE NOTICE 'PASS: no unit inference -- a non-ZMW funding is refused outright';
END $$;

\echo '--- 3. a shop with no verified payout destination cannot take a collection ---'
DO $$
DECLARE v_raised boolean := false; v_msg text; v_dest uuid;
BEGIN
  -- No destination at all.
  BEGIN
    PERFORM public.escrow_redeem_items('ESCROW01',
      ARRAY['01000000-0000-0000-0000-00000000000a']::uuid[], '{}'::uuid[],
      'e5c00000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN OTHERS THEN v_raised := true; v_msg := sqlerrm; END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: goods left the counter for a shop we cannot pay';
  END IF;

  -- A destination, but unverified. Still refused: an unproven number is
  -- treated exactly like a bad one.
  v_dest := (public.set_payout_destination(
    'e5c00000-0000-0000-0000-000000000001', 'e5c00000-0000-0000-0000-0000000000c1',
    'airtel_money', '0977123456', 'Escrow Test Shop')->>'destination_id')::uuid;

  v_raised := false;
  BEGIN
    PERFORM public.escrow_redeem_items('ESCROW01',
      ARRAY['01000000-0000-0000-0000-00000000000a']::uuid[], '{}'::uuid[],
      'e5c00000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: an unverified payout destination was allowed to trade';
  END IF;

  IF public.shop_can_accept_redemptions('e5c00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: shop_can_accept_redemptions is true without verification';
  END IF;

  RAISE NOTICE 'PASS: prevention, not recovery -- unverified shops cannot trade';
END $$;

\echo '--- 4. the number is normalised, so one number is one destination ---'
DO $$
DECLARE v_ident text; v_bad boolean := false;
BEGIN
  SELECT account_identifier INTO v_ident
  FROM public.merchant_payout_destinations
  WHERE shop_id = 'e5c00000-0000-0000-0000-000000000001' AND is_active;

  IF v_ident <> '+260977123456' THEN
    RAISE EXCEPTION 'FAIL: 0977123456 stored as % rather than E.164', v_ident;
  END IF;

  BEGIN
    PERFORM public.set_payout_destination(
      'e5c00000-0000-0000-0000-000000000001', 'e5c00000-0000-0000-0000-0000000000c1',
      'airtel_money', 'not-a-number', 'Escrow Test Shop');
    v_bad := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_bad THEN RAISE EXCEPTION 'FAIL: a malformed mobile number was accepted'; END IF;
  RAISE NOTICE 'PASS: numbers are normalised to E.164 and rubbish is refused';
END $$;

\echo '--- 5. a redemption moves the liability and accrues the fee, exactly ---'
DO $$
DECLARE v_res jsonb; v_dest uuid; v_sender bigint; v_payable bigint; v_fees bigint;
BEGIN
  SELECT id INTO v_dest FROM public.merchant_payout_destinations
  WHERE shop_id = 'e5c00000-0000-0000-0000-000000000001' AND is_active;
  PERFORM public.mark_destination_verified(v_dest, 'airtel_name_lookup', 'ESCROW TEST SHOP', 'lookup-1');

  -- Collect the 500 ZMW item only. 2% fee -> 1000 ngwee fee, 49000 to the shop.
  v_res := public.escrow_redeem_items('ESCROW01',
    ARRAY['01000000-0000-0000-0000-00000000000a']::uuid[], '{}'::uuid[],
    'e5c00000-0000-0000-0000-0000000000c1');

  v_sender  := public.ledger_account_balance('SENDER_LIABILITY', 'e5c00000-0000-0000-0000-0000000000b1');
  v_payable := public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001');
  v_fees    := public.ledger_account_balance('FEE_ACCRUED');

  IF (v_res->>'gross_ngwee')::bigint <> 50000 THEN
    RAISE EXCEPTION 'FAIL: gross was %', v_res->>'gross_ngwee';
  END IF;
  IF v_fees <> 1000 THEN RAISE EXCEPTION 'FAIL: fee accrued % ngwee, expected 1000', v_fees; END IF;
  IF v_payable <> 49000 THEN RAISE EXCEPTION 'FAIL: merchant payable is %', v_payable; END IF;
  IF v_sender <> 40000 THEN
    RAISE EXCEPTION 'FAIL: sender liability is % -- 90000 less 50000 collected is 40000', v_sender;
  END IF;
  IF (v_res->>'items_still_open')::integer <> 1 THEN
    RAISE EXCEPTION 'FAIL: the uncollected item is not still open';
  END IF;

  -- The whole point of partial redemption: the rest is still collectable.
  IF (SELECT claim_status FROM public.shop_orders
      WHERE shop_order_id = 'e5000000-0000-0000-0000-000000000001') <> 'PENDING' THEN
    RAISE EXCEPTION 'FAIL: a partly collected gift was closed';
  END IF;

  PERFORM public.assert_ledger_balanced();
  RAISE NOTICE 'PASS: 500 ZMW collected -> 490 payable, 10 fee, 400 still redeemable';
END $$;

\echo '--- 6. the same item cannot be collected twice ---'
DO $$
DECLARE v_raised boolean := false; v_payable_before bigint; v_payable_after bigint;
BEGIN
  v_payable_before := public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001');

  BEGIN
    PERFORM public.escrow_redeem_items('ESCROW01',
      ARRAY['01000000-0000-0000-0000-00000000000a']::uuid[], '{}'::uuid[],
      'e5c00000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;

  v_payable_after := public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001');

  IF NOT v_raised THEN RAISE EXCEPTION 'FAIL: an already-collected item was collected again'; END IF;
  IF v_payable_after <> v_payable_before THEN
    RAISE EXCEPTION 'FAIL: a rejected rescan still moved % ngwee', v_payable_after - v_payable_before;
  END IF;
  RAISE NOTICE 'PASS: a second scan of the same item pays nothing';
END $$;

\echo '--- 7. a new shop waits; an established one is paid at the scan ---'
DO $$
DECLARE v_inst RECORD; v_tier text; v_hold integer;
BEGIN
  SELECT * INTO v_inst FROM public.payout_instructions
  WHERE shop_order_id = 'e5000000-0000-0000-0000-000000000001'
  ORDER BY created_at DESC LIMIT 1;

  IF v_inst IS NULL THEN RAISE EXCEPTION 'FAIL: the redemption queued no payout'; END IF;
  IF v_inst.amount_ngwee <> 49000 THEN
    RAISE EXCEPTION 'FAIL: queued % ngwee, expected the merchant share of 49000', v_inst.amount_ngwee;
  END IF;

  -- One successful redemption: still a new shop, so a 24 hour hold.
  IF v_inst.release_at <= now() + interval '23 hours' THEN
    RAISE EXCEPTION 'FAIL: a new shop was scheduled for payout at %, too soon', v_inst.release_at;
  END IF;

  -- Earn the promotion.
  UPDATE public.shops SET successful_deliveries = 25
  WHERE id = 'e5c00000-0000-0000-0000-000000000001';
  v_tier := public.refresh_settlement_tier('e5c00000-0000-0000-0000-000000000001');
  v_hold := public.shop_settlement_hold_seconds('e5c00000-0000-0000-0000-000000000001');

  IF v_tier <> 'established' THEN RAISE EXCEPTION 'FAIL: 25 clean redemptions gave tier %', v_tier; END IF;
  IF v_hold <> 0 THEN RAISE EXCEPTION 'FAIL: an established shop still waits % seconds', v_hold; END IF;

  RAISE NOTICE 'PASS: the hold is earned away -- new waits 24h, established is instant';
END $$;

\echo '--- 8. a dispute contains the merchant, whatever their volume ---'
DO $$
DECLARE v_tier text;
BEGIN
  UPDATE public.shop_orders SET disputed_at = now()
  WHERE shop_order_id = 'e5000000-0000-0000-0000-000000000001';

  v_tier := public.refresh_settlement_tier('e5c00000-0000-0000-0000-000000000001');
  IF v_tier <> 'flagged' THEN
    RAISE EXCEPTION 'FAIL: an open dispute left a 25-delivery shop on tier %', v_tier;
  END IF;
  IF public.shop_settlement_hold_seconds('e5c00000-0000-0000-0000-000000000001') <> 259200 THEN
    RAISE EXCEPTION 'FAIL: a flagged shop is not on the 72 hour hold';
  END IF;

  -- And the disputed gift cannot be collected at all.
  BEGIN
    PERFORM public.escrow_redeem_items('ESCROW01',
      ARRAY['01000000-0000-0000-0000-00000000000b']::uuid[], '{}'::uuid[],
      'e5c00000-0000-0000-0000-0000000000c1');
    RAISE EXCEPTION 'FAIL: a disputed gift was collected';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  UPDATE public.shop_orders SET disputed_at = NULL
  WHERE shop_order_id = 'e5000000-0000-0000-0000-000000000001';
  PERFORM public.refresh_settlement_tier('e5c00000-0000-0000-0000-000000000001');

  RAISE NOTICE 'PASS: containment beats promotion, and a disputed gift is frozen';
END $$;

\echo '--- 9. a dead payout rail stops the scan, not just the transfer ---'
DO $$
DECLARE v_raised boolean := false;
BEGIN
  UPDATE public.payment_rails SET is_available = false, manually_disabled = true,
         disabled_reason = 'test outage' WHERE rail = 'airtel_money';

  BEGIN
    PERFORM public.escrow_redeem_items('ESCROW01',
      ARRAY['01000000-0000-0000-0000-00000000000b']::uuid[], '{}'::uuid[],
      'e5c00000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: a scan succeeded that could never have been paid out';
  END IF;

  UPDATE public.payment_rails SET is_available = true, manually_disabled = false,
         disabled_reason = NULL WHERE rail = 'airtel_money';
  RAISE NOTICE 'PASS: no scan succeeds that cannot pay out';
END $$;

\echo '--- 10. a failed payout leaves the debt standing ---'
DO $$
DECLARE v_inst uuid; v_payable_before bigint; v_payable_after bigint; v_res jsonb;
BEGIN
  SELECT id INTO v_inst FROM public.payout_instructions
  WHERE shop_order_id = 'e5000000-0000-0000-0000-000000000001'
  ORDER BY created_at DESC LIMIT 1;

  v_payable_before := public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001');

  PERFORM public.claim_due_payouts(10);
  UPDATE public.payout_instructions SET status = 'CLAIMED', release_at = now() - interval '1 minute'
  WHERE id = v_inst AND status <> 'CLAIMED';

  v_res := public.fail_payout(v_inst, 'Airtel says the subscriber is barred', true);
  v_payable_after := public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001');

  IF v_payable_after <> v_payable_before THEN
    RAISE EXCEPTION 'FAIL: a failed payout changed the payable by % ngwee',
      v_payable_after - v_payable_before;
  END IF;
  IF v_res->>'status' <> 'FAILED' THEN
    RAISE EXCEPTION 'FAIL: a retryable failure went straight to %', v_res->>'status';
  END IF;

  -- Burn the retry budget.
  FOR i IN 1..8 LOOP
    UPDATE public.payout_instructions
    SET status = 'CLAIMED', attempt_count = attempt_count + 1 WHERE id = v_inst;
    BEGIN
      v_res := public.fail_payout(v_inst, 'still barred', true);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  IF (SELECT status FROM public.payout_instructions WHERE id = v_inst) <> 'ABANDONED' THEN
    RAISE EXCEPTION 'FAIL: the retry budget never ran out -- this would retry forever';
  END IF;
  IF public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001') <> v_payable_before THEN
    RAISE EXCEPTION 'FAIL: abandoning a payout wrote off a debt we still owe';
  END IF;

  RAISE NOTICE 'PASS: the merchant is still owed after nine failed attempts';
END $$;

\echo '--- 11. only money arriving closes the payable ---'
DO $$
DECLARE v_inst uuid; v_payable bigint; v_res jsonb;
BEGIN
  SELECT id INTO v_inst FROM public.payout_instructions
  WHERE shop_order_id = 'e5000000-0000-0000-0000-000000000001'
  ORDER BY created_at DESC LIMIT 1;

  UPDATE public.payout_instructions SET status = 'CLAIMED' WHERE id = v_inst;

  v_res := public.complete_payout(v_inst, 'airtel-money-id-99');
  v_payable := public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001');

  IF v_payable <> 0 THEN RAISE EXCEPTION 'FAIL: % ngwee still payable after settlement', v_payable; END IF;
  IF (v_res->>'ledger_pair_id') IS NULL THEN RAISE EXCEPTION 'FAIL: settlement wrote no ledger pair'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_entries
                 WHERE entry_pair_id = (v_res->>'ledger_pair_id')::uuid
                   AND external_ref = 'airtel-money-id-99') THEN
    RAISE EXCEPTION 'FAIL: the rail reference is not on the ledger entry';
  END IF;

  -- A duplicated dispatcher run must not pay twice.
  v_res := public.complete_payout(v_inst, 'airtel-money-id-99');
  IF NOT (v_res->>'already_settled')::boolean THEN
    RAISE EXCEPTION 'FAIL: completing a settled payout was not recognised as a repeat';
  END IF;
  IF public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'FAIL: a repeated settlement moved money again';
  END IF;

  PERFORM public.assert_ledger_balanced();
  RAISE NOTICE 'PASS: settlement closes the debt once, and records the rail id';
END $$;

\echo '--- 12. the compensation term is the one shown at checkout, not today''s ---'
DO $$
DECLARE v_snapshot integer;
BEGIN
  SELECT compensation_percent_at_purchase INTO v_snapshot
  FROM public.order_items WHERE order_item_id = '01000000-0000-0000-0000-00000000000b';

  IF v_snapshot <> 30 THEN
    RAISE EXCEPTION 'FAIL: the disclosed 30%% was snapshotted as %', v_snapshot;
  END IF;

  -- The merchant gets greedy after the sale.
  UPDATE public.items SET compensation_percent = 90
  WHERE id = 'e1e10000-0000-0000-0000-00000000000b';

  SELECT compensation_percent_at_purchase INTO v_snapshot
  FROM public.order_items WHERE order_item_id = '01000000-0000-0000-0000-00000000000b';

  IF v_snapshot <> 30 THEN
    RAISE EXCEPTION 'FAIL: raising the listing changed a completed sale to %', v_snapshot;
  END IF;

  UPDATE public.items SET compensation_percent = 30
  WHERE id = 'e1e10000-0000-0000-0000-00000000000b';
  RAISE NOTICE 'PASS: the contract is what the sender saw, and cannot be raised afterwards';
END $$;

\echo '--- 13. an incoherent compensation term cannot be listed at all ---'
DO $$
DECLARE v_bad integer := 0;
BEGIN
  BEGIN  -- eligible but worth nothing
    UPDATE public.items SET compensation_eligible = true, compensation_percent = 0
    WHERE id = 'e1e10000-0000-0000-0000-00000000000a';
    v_bad := v_bad + 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN  -- a percentage nobody agreed to
    UPDATE public.items SET compensation_eligible = false, compensation_percent = 25
    WHERE id = 'e1e10000-0000-0000-0000-00000000000a';
    v_bad := v_bad + 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN  -- a claim with no stated reason
    UPDATE public.items SET compensation_eligible = true, compensation_percent = 20,
           compensation_reason = NULL
    WHERE id = 'e1e10000-0000-0000-0000-00000000000a';
    v_bad := v_bad + 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: % incoherent compensation terms were accepted', v_bad;
  END IF;
  RAISE NOTICE 'PASS: a compensation claim must be positive, deliberate and explained';
END $$;

\echo '--- 14. expiry refunds to source, and splits only what was disclosed ---'
DO $$
DECLARE v_res jsonb; v_refund RECORD; v_comp bigint; v_sender bigint;
BEGIN
  UPDATE public.shop_orders SET expires_at = now() - interval '1 day'
  WHERE shop_order_id = 'e5000000-0000-0000-0000-000000000001';

  v_comp := public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001');

  v_res := public.escrow_process_expiries(100);

  -- 400 ZMW item, 30% disclosed: 12000 ngwee to the shop, 28000 refunded.
  IF public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001') - v_comp <> 12000 THEN
    RAISE EXCEPTION 'FAIL: compensation was % ngwee, expected 12000',
      public.ledger_account_balance('MERCHANT_PAYABLE', 'e5c00000-0000-0000-0000-000000000001') - v_comp;
  END IF;

  SELECT * INTO v_refund FROM public.refund_requests
  WHERE order_item_id = '01000000-0000-0000-0000-00000000000b';

  IF v_refund IS NULL THEN RAISE EXCEPTION 'FAIL: expiry created no refund'; END IF;
  IF v_refund.amount_ngwee <> 28000 THEN
    RAISE EXCEPTION 'FAIL: refund is % ngwee, expected 28000', v_refund.amount_ngwee;
  END IF;
  IF v_refund.original_ref <> 'escrow-test-001' THEN
    RAISE EXCEPTION 'FAIL: the refund is not addressed to the original charge';
  END IF;

  -- Crucially: no wallet was credited anywhere.
  IF EXISTS (SELECT 1 FROM public.wallet_ledger wl
             JOIN public.kithly_wallets w ON w.id = wl.wallet_id
             WHERE w.user_id = 'e5c00000-0000-0000-0000-0000000000b1') THEN
    RAISE EXCEPTION 'FAIL: the escrow expiry path credited a wallet -- that is stored value';
  END IF;

  RAISE NOTICE 'PASS: 30%% disclosed compensation, 70%% back to the card, no wallet anywhere';
END $$;

\echo '--- 15. a refund that cannot be delivered becomes a holding state, not a balance ---'
DO $$
DECLARE v_refund uuid; v_sender_before bigint; v_res jsonb; i integer;
BEGIN
  SELECT id INTO v_refund FROM public.refund_requests
  WHERE order_item_id = '01000000-0000-0000-0000-00000000000b';

  v_sender_before := public.ledger_account_balance('SENDER_LIABILITY', 'e5c00000-0000-0000-0000-0000000000b1');

  FOR i IN 1..8 LOOP
    UPDATE public.refund_requests SET status = 'CLAIMED', attempt_count = attempt_count + 1
    WHERE id = v_refund;
    BEGIN v_res := public.fail_refund(v_refund, 'card expired', true);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  IF (SELECT status FROM public.refund_requests WHERE id = v_refund) <> 'REFUND_PENDING' THEN
    RAISE EXCEPTION 'FAIL: an undeliverable refund did not reach REFUND_PENDING';
  END IF;

  -- The money is still the sender's. It has not been written off, and it has
  -- not become a spendable balance.
  IF public.ledger_account_balance('SENDER_LIABILITY', 'e5c00000-0000-0000-0000-0000000000b1') <> v_sender_before THEN
    RAISE EXCEPTION 'FAIL: a failed refund moved the sender liability';
  END IF;

  -- And it can still be delivered later.
  UPDATE public.refund_requests SET status = 'CLAIMED' WHERE id = v_refund;
  v_res := public.complete_refund(v_refund, 'flw-refund-77');

  IF public.ledger_account_balance('SENDER_LIABILITY', 'e5c00000-0000-0000-0000-0000000000b1')
     <> v_sender_before - 28000 THEN
    RAISE EXCEPTION 'FAIL: completing the refund did not discharge the liability';
  END IF;

  PERFORM public.assert_ledger_balanced();
  RAISE NOTICE 'PASS: an undeliverable refund is held, not converted into credit';
END $$;

\echo '--- 16. the fee sweep only books money that actually moved ---'
DO $$
DECLARE v_prop jsonb; v_sweep uuid; v_fees_before bigint; v_conf jsonb; v_bad boolean := false;
BEGIN
  v_fees_before := public.ledger_account_balance('FEE_ACCRUED');
  IF v_fees_before <= 0 THEN RAISE EXCEPTION 'FAIL: no fees accrued to sweep'; END IF;

  v_prop := public.propose_fee_sweep(current_date);
  v_sweep := (v_prop->>'sweep_id')::uuid;

  -- Proposing does not move anything.
  IF public.ledger_account_balance('FEE_ACCRUED') <> v_fees_before THEN
    RAISE EXCEPTION 'FAIL: proposing a sweep moved money before the transfer was made';
  END IF;

  -- And it cannot be confirmed without evidence of the transfer.
  BEGIN
    PERFORM public.confirm_fee_sweep(v_sweep, '', 'e5c00000-0000-0000-0000-0000000000a1');
    v_bad := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF v_bad THEN RAISE EXCEPTION 'FAIL: a sweep was confirmed with no bank reference'; END IF;

  -- Nor by someone who is not an admin.
  v_bad := false;
  BEGIN
    PERFORM public.confirm_fee_sweep(v_sweep, 'BANK-REF-1', 'e5c00000-0000-0000-0000-0000000000b1');
    v_bad := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF v_bad THEN RAISE EXCEPTION 'FAIL: a non-admin confirmed a sweep'; END IF;

  v_conf := public.confirm_fee_sweep(v_sweep, 'BANK-REF-1', 'e5c00000-0000-0000-0000-0000000000a1');

  IF public.ledger_account_balance('FEE_ACCRUED') <> 0 THEN
    RAISE EXCEPTION 'FAIL: % ngwee still accrued after the sweep',
      public.ledger_account_balance('FEE_ACCRUED');
  END IF;

  PERFORM public.assert_ledger_balanced();
  RAISE NOTICE 'PASS: the sweep books only a transfer that happened, with its reference';
END $$;

\echo '--- 17. reconciliation is the control: it must catch drift and imbalance ---'
DO $$
DECLARE v_expected bigint; v_res jsonb; v_inv jsonb;
BEGIN
  v_inv := public.ledger_master_invariant();
  v_expected := (v_inv->>'sender_liabilities_ngwee')::bigint
              + (v_inv->>'merchant_payables_ngwee')::bigint
              + (v_inv->>'fees_accrued_ngwee')::bigint;

  -- The bank agrees.
  v_res := public.escrow_reconcile(v_expected, now());
  IF v_res->>'status' <> 'BALANCED' THEN
    RAISE EXCEPTION 'FAIL: a matching bank balance reported % (drift %)',
      v_res->>'status', v_res->>'drift_ngwee';
  END IF;

  -- The bank is short by 5 kwacha.
  v_res := public.escrow_reconcile(v_expected - 500, now());
  IF v_res->>'status' <> 'DRIFT' THEN
    RAISE EXCEPTION 'FAIL: a 500 ngwee shortfall reported %', v_res->>'status';
  END IF;
  IF (v_res->>'drift_ngwee')::bigint <> -500 THEN
    RAISE EXCEPTION 'FAIL: drift computed as %, expected -500', v_res->>'drift_ngwee';
  END IF;

  -- The bank could not be reached: recorded, not skipped.
  v_res := public.escrow_reconcile(NULL, now());
  IF v_res->>'status' <> 'BANK_UNAVAILABLE' THEN
    RAISE EXCEPTION 'FAIL: an unreachable bank reported %', v_res->>'status';
  END IF;

  -- A single-sided entry outranks everything else.
  INSERT INTO public.ledger_entries
    (entry_pair_id, account_type, account_ref, direction, amount_ngwee, reason)
  VALUES (gen_random_uuid(), 'CLIENT_FUNDS', NULL, 'DEBIT', 777, 'ADJUSTMENT');

  v_res := public.escrow_reconcile(v_expected, now());
  IF v_res->>'status' <> 'INTERNAL_IMBALANCE' THEN
    RAISE EXCEPTION 'FAIL: a single-sided entry reported % rather than INTERNAL_IMBALANCE',
      v_res->>'status';
  END IF;
  IF (v_res->>'internal_imbalance_ngwee')::bigint <> 777 THEN
    RAISE EXCEPTION 'FAIL: imbalance measured as %', v_res->>'internal_imbalance_ngwee';
  END IF;

  -- An admin was actually told, every time.
  IF (SELECT COUNT(*) FROM public.notifications
      WHERE user_id = 'e5c00000-0000-0000-0000-0000000000a1' AND type = 'error') < 3 THEN
    RAISE EXCEPTION 'FAIL: unhealthy reconciliations did not alert the admin';
  END IF;

  RAISE NOTICE 'PASS: drift, an unreachable bank and a single-sided entry all alert';
END $$;

\echo '--- 18. a reconciliation result cannot be quietly corrected ---'
DO $$
DECLARE v_bad boolean := false; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.reconciliation_runs ORDER BY created_at DESC LIMIT 1;
  BEGIN
    UPDATE public.reconciliation_runs SET status = 'BALANCED', drift_ngwee = 0 WHERE id = v_id;
    v_bad := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_bad THEN RAISE EXCEPTION 'FAIL: a reconciliation run was edited after the fact'; END IF;
  RAISE NOTICE 'PASS: reconciliation history is immutable, so a control cannot be tidied away';
END $$;

\echo '--- 19. extending a gift is capped, and only the sender may do it ---'
DO $$
DECLARE v_res jsonb; v_bad boolean := false; v_order uuid := 'e5000000-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO public.transactions (transaction_id, buyer_id, gateway_tx_ref, total_amount, currency, status)
  VALUES ('e7000000-0000-0000-0000-000000000002', 'e5c00000-0000-0000-0000-0000000000b1',
          'escrow-test-002', 10000, 'ZMW', 'SUCCESS');
  INSERT INTO public.shop_orders (shop_order_id, transaction_id, shop_id, claim_code, claim_status, subtotal, expires_at)
  VALUES (v_order, 'e7000000-0000-0000-0000-000000000002',
          'e5c00000-0000-0000-0000-000000000001', 'ESCROW02', 'PENDING', 10000, now() + interval '2 days');

  BEGIN
    PERFORM public.extend_voucher_window(v_order, 'e5c00000-0000-0000-0000-0000000000c1');
    v_bad := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF v_bad THEN RAISE EXCEPTION 'FAIL: a merchant extended someone else''s gift'; END IF;

  v_res := public.extend_voucher_window(v_order, 'e5c00000-0000-0000-0000-0000000000b1');
  IF (v_res->>'extensions_used')::integer <> 1 THEN
    RAISE EXCEPTION 'FAIL: first extension counted as %', v_res->>'extensions_used';
  END IF;

  PERFORM public.extend_voucher_window(v_order, 'e5c00000-0000-0000-0000-0000000000b1');

  v_bad := false;
  BEGIN
    PERFORM public.extend_voucher_window(v_order, 'e5c00000-0000-0000-0000-0000000000b1');
    v_bad := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF v_bad THEN RAISE EXCEPTION 'FAIL: the extension cap does not hold'; END IF;

  RAISE NOTICE 'PASS: the sender can buy more time, twice, and nobody else can';
END $$;

\echo '--- 20. after everything, the books still balance ---'
DO $$
DECLARE v_inv jsonb;
BEGIN
  -- Remove the deliberate single-sided entry from assertion 17 so the closing
  -- check is about the lifecycle rather than the sabotage.
  DELETE FROM public.ledger_entries WHERE reason = 'ADJUSTMENT' AND amount_ngwee = 777;
EXCEPTION WHEN OTHERS THEN
  -- Immutability refuses the delete, which is correct. Reverse it instead.
  NULL;
END $$;

DO $$
DECLARE v_inv jsonb; v_imbalance bigint;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_ngwee ELSE -amount_ngwee END), 0)
  INTO v_imbalance FROM public.ledger_entries;

  -- The sabotage row cannot be deleted -- the ledger is append-only -- so the
  -- honest closing assertion is that everything EXCEPT it balances.
  IF v_imbalance <> 777 THEN
    RAISE EXCEPTION 'FAIL: closing imbalance is %, expected only the 777 sabotage row', v_imbalance;
  END IF;

  v_inv := public.ledger_master_invariant();
  IF (v_inv->>'drift_ngwee')::bigint <> 777 THEN
    RAISE EXCEPTION 'FAIL: closing drift is % rather than the sabotage row alone',
      v_inv->>'drift_ngwee';
  END IF;

  RAISE NOTICE 'PASS: the full lifecycle nets to zero -- only the deliberate bad row remains';
END $$;

TRUNCATE public.ledger_entries;
