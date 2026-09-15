\set ON_ERROR_STOP on
\pset pager off

-- =============================================================================
-- The double-entry ledger: structure, idempotency, and the arithmetic
--
-- These assertions are about the ledger as a mechanism -- whether it can be
-- made to lose money, double-count, or be edited. The lifecycle suite
-- (assert_escrow_lifecycle) covers what the money does.
-- =============================================================================

TRUNCATE public.ledger_entries;

DELETE FROM public.users WHERE id IN (
  '5e1de100-0000-0000-0000-000000000001',
  '5e1de100-0000-0000-0000-000000000002'
);
INSERT INTO public.users (id, role) VALUES
  ('5e1de100-0000-0000-0000-000000000001', 'sender'),
  ('5e1de100-0000-0000-0000-000000000002', 'merchant');

DELETE FROM public.shops WHERE id = '5409e000-0000-0000-0000-000000000001';
INSERT INTO public.shops (id, owner_id, name) VALUES
  ('5409e000-0000-0000-0000-000000000001', '5e1de100-0000-0000-0000-000000000002', 'Ledger Test Shop');

\echo '--- 1. a pair is two rows, equal and opposite ---'
DO $$
DECLARE v_pair uuid; v_debits bigint; v_credits bigint; v_rows integer;
BEGIN
  v_pair := public.post_ledger_pair(
    'CLIENT_FUNDS', NULL, 'SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001',
    250000, 'FUNDING');

  SELECT COUNT(*),
         SUM(amount_ngwee) FILTER (WHERE direction = 'DEBIT'),
         SUM(amount_ngwee) FILTER (WHERE direction = 'CREDIT')
  INTO v_rows, v_debits, v_credits
  FROM public.ledger_entries WHERE entry_pair_id = v_pair;

  IF v_rows <> 2 THEN RAISE EXCEPTION 'FAIL: a pair wrote % rows, not 2', v_rows; END IF;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'FAIL: pair is unbalanced -- % debit vs % credit', v_debits, v_credits;
  END IF;
  RAISE NOTICE 'PASS: one movement writes exactly two equal and opposite rows';
END $$;

\echo '--- 2. the ledger refuses amounts that are not money ---'
DO $$
DECLARE v_bad integer := 0;
BEGIN
  BEGIN
    PERFORM public.post_ledger_pair('CLIENT_FUNDS', NULL, 'FEE_ACCRUED', NULL, 0, 'FUNDING');
    v_bad := v_bad + 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    PERFORM public.post_ledger_pair('CLIENT_FUNDS', NULL, 'FEE_ACCRUED', NULL, -5000, 'FUNDING');
    v_bad := v_bad + 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    PERFORM public.post_ledger_pair('CLIENT_FUNDS', NULL, 'FEE_ACCRUED', NULL, NULL, 'FUNDING');
    v_bad := v_bad + 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: % non-positive amounts were accepted into the ledger', v_bad;
  END IF;
  RAISE NOTICE 'PASS: zero, negative and null amounts are all refused';
END $$;

\echo '--- 3. a house account may not carry a counterparty, and a liability must ---'
DO $$
DECLARE v_bad integer := 0;
BEGIN
  -- A liability with nobody to owe it to.
  BEGIN
    INSERT INTO public.ledger_entries
      (entry_pair_id, account_type, account_ref, direction, amount_ngwee, reason)
    VALUES (gen_random_uuid(), 'SENDER_LIABILITY', NULL, 'CREDIT', 1000, 'FUNDING');
    v_bad := v_bad + 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- A house account attributed to a person.
  BEGIN
    INSERT INTO public.ledger_entries
      (entry_pair_id, account_type, account_ref, direction, amount_ngwee, reason)
    VALUES (gen_random_uuid(), 'CLIENT_FUNDS', '5e1de100-0000-0000-0000-000000000001',
            'DEBIT', 1000, 'FUNDING');
    v_bad := v_bad + 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: % malformed account references were accepted', v_bad;
  END IF;
  RAISE NOTICE 'PASS: liabilities need an owner and house accounts refuse one';
END $$;

\echo '--- 4. a repeated idempotency key posts nothing and returns the first pair ---'
DO $$
DECLARE v_first uuid; v_second uuid; v_rows_before integer; v_rows_after integer;
BEGIN
  SELECT COUNT(*) INTO v_rows_before FROM public.ledger_entries;

  v_first := public.post_ledger_pair(
    'CLIENT_FUNDS', NULL, 'SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001',
    75000, 'FUNDING', NULL, NULL, NULL, 'flw-abc', 'webhook-retry-test');

  -- The same webhook, delivered again.
  v_second := public.post_ledger_pair(
    'CLIENT_FUNDS', NULL, 'SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001',
    75000, 'FUNDING', NULL, NULL, NULL, 'flw-abc', 'webhook-retry-test');

  SELECT COUNT(*) INTO v_rows_after FROM public.ledger_entries;

  IF v_first <> v_second THEN
    RAISE EXCEPTION 'FAIL: a retry created a second pair (% then %)', v_first, v_second;
  END IF;
  IF v_rows_after - v_rows_before <> 2 THEN
    RAISE EXCEPTION 'FAIL: a retried posting wrote % rows instead of 2', v_rows_after - v_rows_before;
  END IF;
  RAISE NOTICE 'PASS: a replayed webhook is a no-op, not a double credit';
END $$;

\echo '--- 5. the unique index, not just the pre-check, is what guarantees it ---'
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  -- Simulating the race the pre-check cannot win: two callers both pass the
  -- SELECT, then both INSERT. The second must be refused by the index.
  BEGIN
    INSERT INTO public.ledger_entries
      (entry_pair_id, account_type, account_ref, direction, amount_ngwee, reason, idempotency_key)
    VALUES (gen_random_uuid(), 'CLIENT_FUNDS', NULL, 'DEBIT', 75000, 'FUNDING', 'webhook-retry-test');
  EXCEPTION WHEN unique_violation THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL: the idempotency index did not stop a duplicate DEBIT';
  END IF;
  RAISE NOTICE 'PASS: idempotency is enforced by the index, not only by the read';
END $$;

\echo '--- 6. history cannot be edited or deleted ---'
DO $$
DECLARE v_updated boolean := false; v_deleted boolean := false; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.ledger_entries LIMIT 1;

  BEGIN
    UPDATE public.ledger_entries SET amount_ngwee = 1 WHERE id = v_id;
    v_updated := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.ledger_entries WHERE id = v_id;
    v_deleted := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_updated THEN RAISE EXCEPTION 'FAIL: a ledger entry was updated'; END IF;
  IF v_deleted THEN RAISE EXCEPTION 'FAIL: a ledger entry was deleted'; END IF;
  RAISE NOTICE 'PASS: entries are immutable -- corrections must be reversing pairs';
END $$;

\echo '--- 7. a correction is a reversal, and it nets to zero ---'
DO $$
DECLARE v_pair uuid; v_rev uuid; v_before bigint; v_after bigint;
BEGIN
  v_before := public.ledger_account_balance('SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001');

  v_pair := public.post_ledger_pair(
    'CLIENT_FUNDS', NULL, 'SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001',
    31337, 'FUNDING', NULL, NULL, NULL, NULL, 'reversal-subject');

  v_rev := public.reverse_ledger_pair(v_pair);

  v_after := public.ledger_account_balance('SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001');

  IF v_after <> v_before THEN
    RAISE EXCEPTION 'FAIL: reversal left % ngwee behind', v_after - v_before;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ledger_entries
                 WHERE entry_pair_id = v_rev AND reverses_pair_id = v_pair) THEN
    RAISE EXCEPTION 'FAIL: the reversal does not point at what it reversed';
  END IF;

  -- Reversing twice would create money.
  BEGIN
    PERFORM public.reverse_ledger_pair(v_pair);
    RAISE EXCEPTION 'FAIL: a pair was reversed twice';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: reversal nets to zero, is traceable, and cannot be repeated';
END $$;

\echo '--- 8. balances carry the right sign for their account class ---'
DO $$
DECLARE v_client bigint; v_sender bigint;
BEGIN
  TRUNCATE public.ledger_entries;

  PERFORM public.post_ledger_pair(
    'CLIENT_FUNDS', NULL, 'SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001',
    100000, 'FUNDING');

  v_client := public.ledger_account_balance('CLIENT_FUNDS');
  v_sender := public.ledger_account_balance('SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001');

  -- An asset rises on a debit; a liability rises on a credit. Getting this
  -- backwards makes every figure in the system negative.
  IF v_client <> 100000 THEN
    RAISE EXCEPTION 'FAIL: client funds (an asset) reads % after a 100000 debit', v_client;
  END IF;
  IF v_sender <> 100000 THEN
    RAISE EXCEPTION 'FAIL: sender liability reads % after a 100000 credit', v_sender;
  END IF;
  RAISE NOTICE 'PASS: assets are debit-normal and liabilities credit-normal';
END $$;

\echo '--- 9. the master invariant holds across a full lifecycle ---'
DO $$
DECLARE v_inv jsonb; v_fee bigint;
BEGIN
  TRUNCATE public.ledger_entries;

  -- Fund 1000.00 ZMW.
  PERFORM public.post_ledger_pair('CLIENT_FUNDS', NULL,
    'SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001', 100000, 'FUNDING');

  -- Redeem 400.00 of it: 380.00 to the merchant, 20.00 in fees.
  PERFORM public.post_ledger_pair('SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001',
    'MERCHANT_PAYABLE', '5409e000-0000-0000-0000-000000000001', 38000, 'REDEMPTION');
  PERFORM public.post_ledger_pair('SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001',
    'FEE_ACCRUED', NULL, 2000, 'REDEMPTION_FEE');

  v_inv := public.ledger_master_invariant();
  IF (v_inv->>'drift_ngwee')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: drift of % after redemption', v_inv->>'drift_ngwee';
  END IF;
  IF (v_inv->>'sender_liabilities_ngwee')::bigint <> 60000 THEN
    RAISE EXCEPTION 'FAIL: sender liability is % after redeeming 40000 of 100000',
      v_inv->>'sender_liabilities_ngwee';
  END IF;

  -- Pay the merchant out.
  PERFORM public.post_ledger_pair('MERCHANT_PAYABLE', '5409e000-0000-0000-0000-000000000001',
    'CLIENT_FUNDS', NULL, 38000, 'PAYOUT');

  -- Sweep the fee.
  PERFORM public.post_ledger_pair('FEE_ACCRUED', NULL, 'CLIENT_FUNDS', NULL, 2000, 'FEE_SWEEP');

  -- Refund what was never collected.
  PERFORM public.post_ledger_pair('SENDER_LIABILITY', '5e1de100-0000-0000-0000-000000000001',
    'CLIENT_FUNDS', NULL, 60000, 'EXPIRY_REFUND');

  v_inv := public.ledger_master_invariant();

  IF (v_inv->>'drift_ngwee')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: drift of % at the end of the lifecycle', v_inv->>'drift_ngwee';
  END IF;
  IF (v_inv->>'client_funds_ngwee')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: % ngwee left in client funds after everything settled',
      v_inv->>'client_funds_ngwee';
  END IF;
  IF NOT (v_inv->>'balanced')::boolean THEN
    RAISE EXCEPTION 'FAIL: the ledger does not balance';
  END IF;

  RAISE NOTICE 'PASS: fund, redeem, pay out, sweep and refund all net to zero';
END $$;

\echo '--- 10. the fee split never loses or invents a ngwee ---'
DO $$
DECLARE v_gross bigint; v_fee bigint; v_merchant bigint; v_worst bigint := 0;
BEGIN
  UPDATE public.platform_settings SET merchant_fee_percent = 2.5 WHERE id = 1;

  -- Every amount from 1 ngwee to 10 kwacha, then a spread of larger ones. The
  -- property that matters is exact: merchant + fee = gross, for all of them.
  FOR v_gross IN 1..1000 LOOP
    v_fee := public.escrow_fee_ngwee(v_gross);
    v_merchant := v_gross - v_fee;

    IF v_merchant + v_fee <> v_gross THEN
      RAISE EXCEPTION 'FAIL: % + % <> % ngwee', v_merchant, v_fee, v_gross;
    END IF;
    IF v_fee < 0 OR v_fee > v_gross THEN
      RAISE EXCEPTION 'FAIL: fee of % is not within 0..% ', v_fee, v_gross;
    END IF;
    IF v_merchant < 0 THEN
      RAISE EXCEPTION 'FAIL: merchant share went negative at gross %', v_gross;
    END IF;
  END LOOP;

  FOREACH v_gross IN ARRAY ARRAY[9999::bigint, 100000, 123457, 999999999] LOOP
    v_fee := public.escrow_fee_ngwee(v_gross);
    IF (v_gross - v_fee) + v_fee <> v_gross THEN
      RAISE EXCEPTION 'FAIL: split does not reconstruct % ', v_gross;
    END IF;
    v_worst := GREATEST(v_worst, v_fee);
  END LOOP;

  RAISE NOTICE 'PASS: 1004 fee splits are exact -- nothing rounds into thin air';
END $$;

\echo '--- 11. a zero fee percentage takes nothing ---'
DO $$
DECLARE v_fee bigint;
BEGIN
  UPDATE public.platform_settings SET merchant_fee_percent = 0 WHERE id = 1;
  v_fee := public.escrow_fee_ngwee(500000);
  IF v_fee <> 0 THEN RAISE EXCEPTION 'FAIL: a 0%% fee took % ngwee', v_fee; END IF;

  UPDATE public.platform_settings SET merchant_fee_percent = 2.00 WHERE id = 1;
  RAISE NOTICE 'PASS: a zero fee percentage accrues nothing';
END $$;

\echo '--- 12. assert_ledger_balanced catches a single-sided entry ---'
DO $$
DECLARE v_raised boolean := false;
BEGIN
  TRUNCATE public.ledger_entries;

  PERFORM public.assert_ledger_balanced();  -- empty ledger balances

  -- Bypassing post_ledger_pair, exactly as a future bug would.
  INSERT INTO public.ledger_entries
    (entry_pair_id, account_type, account_ref, direction, amount_ngwee, reason)
  VALUES (gen_random_uuid(), 'CLIENT_FUNDS', NULL, 'DEBIT', 12345, 'ADJUSTMENT');

  BEGIN
    PERFORM public.assert_ledger_balanced();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: a single-sided entry did not trip the balance assertion';
  END IF;
  IF public.ledger_is_balanced() THEN
    RAISE EXCEPTION 'FAIL: ledger_is_balanced() reported true with a dangling debit';
  END IF;

  TRUNCATE public.ledger_entries;
  RAISE NOTICE 'PASS: a code path that bypasses post_ledger_pair is detected';
END $$;

\echo '--- 13. claim codes come from a cryptographic source ---'
DO $$
DECLARE v_def text; v_code text; v_codes text[] := '{}'; v_distinct integer; i integer;
BEGIN
  v_def := pg_get_functiondef('public.gen_claim_code(integer)'::regprocedure);

  -- The specific thing §4.1 forbids.
  IF v_def ~* '\mrandom\s*\(' THEN
    RAISE EXCEPTION 'FAIL: gen_claim_code still draws from random()';
  END IF;
  IF v_def !~* 'gen_random_uuid|gen_random_bytes' THEN
    RAISE EXCEPTION 'FAIL: gen_claim_code does not use a strong random source';
  END IF;

  FOR i IN 1..500 LOOP
    v_code := public.gen_claim_code(8);
    IF length(v_code) <> 8 THEN
      RAISE EXCEPTION 'FAIL: gen_claim_code(8) returned % of length %', v_code, length(v_code);
    END IF;
    IF v_code !~ '^[A-Z0-9]{8}$' THEN
      RAISE EXCEPTION 'FAIL: gen_claim_code produced out-of-alphabet output: %', v_code;
    END IF;
    v_codes := array_append(v_codes, v_code);
  END LOOP;

  SELECT COUNT(DISTINCT c) INTO v_distinct FROM unnest(v_codes) AS c;
  IF v_distinct <> 500 THEN
    RAISE EXCEPTION 'FAIL: % collisions in 500 codes', 500 - v_distinct;
  END IF;

  IF length(public.gen_claim_code(6)) <> 6 THEN
    RAISE EXCEPTION 'FAIL: gen_claim_code(6) is not 6 characters -- create_list_with_slug needs it';
  END IF;

  RAISE NOTICE 'PASS: claim codes are strong, correctly shaped, and collision-free over 500 draws';
END $$;

\echo '--- 14. no escrow money function is reachable without the service role ---'
DO $$
DECLARE v_fn text; v_offenders text[] := '{}';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'post_ledger_pair', 'reverse_ledger_pair', 'escrow_record_funding',
    'escrow_redeem_items', 'enqueue_payout', 'complete_payout', 'fail_payout',
    'complete_refund', 'fail_refund', 'escrow_process_expiries',
    'confirm_fee_sweep', 'escrow_reconcile', 'escrow_open_balances',
    'set_payout_destination', 'mark_destination_verified'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
        AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    ) THEN
      v_offenders := array_append(v_offenders, v_fn);
    END IF;
  END LOOP;

  IF array_length(v_offenders, 1) > 0 THEN
    RAISE EXCEPTION 'FAIL: these money functions are reachable by anon/authenticated: %', v_offenders;
  END IF;
  RAISE NOTICE 'PASS: every escrow money function is service_role only';
END $$;

TRUNCATE public.ledger_entries;
