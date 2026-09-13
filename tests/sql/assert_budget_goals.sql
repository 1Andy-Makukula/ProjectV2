\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.users WHERE id = '99999999-9999-9999-9999-999999999999';
INSERT INTO public.users (id, role) VALUES
  ('99999999-9999-9999-9999-999999999999', 'sender');
INSERT INTO public.kithly_wallets (id, user_id, balance) VALUES
  ('e1e1e1e1-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', 50000);

\echo '--- 1. provenance is forward-only, because history cannot be rewritten ---'
DO $$
DECLARE resolved text; residual text;
BEGIN
  -- Written the way the existing money RPCs write, with no kind.
  INSERT INTO public.wallet_ledger (wallet_id, amount, description)
  VALUES ('e1e1e1e1-0000-0000-0000-000000000001', 20000, 'WALLET_CREDIT');
  INSERT INTO public.wallet_ledger (wallet_id, amount, description)
  VALUES ('e1e1e1e1-0000-0000-0000-000000000001', 8000,
          'REFUND_EXPIRY:11111111-1111-1111-1111-111111111111');

  -- Backfilling is not merely discouraged; the ledger refuses it.
  BEGIN
    UPDATE public.wallet_ledger SET kind = 'topup'
     WHERE wallet_id = 'e1e1e1e1-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL: the ledger allowed a backfill -- immutability is gone';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- So history is classified at read time instead.
  SELECT resolved_kind INTO resolved FROM public.wallet_ledger_classified
   WHERE description = 'WALLET_CREDIT' LIMIT 1;
  SELECT resolved_kind INTO residual FROM public.wallet_ledger_classified
   WHERE description LIKE 'REFUND_EXPIRY%' LIMIT 1;

  IF resolved <> 'topup' THEN RAISE EXCEPTION 'FAIL: a top-up classified as %', resolved; END IF;
  IF residual <> 'residual' THEN
    RAISE EXCEPTION 'FAIL: money back from an uncollected item classified as %', residual;
  END IF;
  RAISE NOTICE 'PASS: saved money and residual credit are distinguishable without touching history';
END $$;

\echo '--- 2. setting money aside moves no money ---'
DO $$
DECLARE goal uuid; bal integer; res integer; ledger_rows integer;
BEGIN
  INSERT INTO public.budget_goals (user_id, name, target_zmw)
  VALUES ('99999999-9999-9999-9999-999999999999', 'Mum''s birthday', 40000)
  RETURNING id INTO goal;

  SELECT count(*) INTO ledger_rows FROM public.wallet_ledger
   WHERE wallet_id = 'e1e1e1e1-0000-0000-0000-000000000001';

  PERFORM public.reserve_to_goal(goal, 30000);

  SELECT balance, reserved_zmw INTO bal, res FROM public.kithly_wallets
   WHERE user_id = '99999999-9999-9999-9999-999999999999';

  IF bal <> 50000 THEN RAISE EXCEPTION 'FAIL: balance changed to %, nothing was spent', bal; END IF;
  IF res <> 30000 THEN RAISE EXCEPTION 'FAIL: reserved is %, expected 30000', res; END IF;

  IF (SELECT count(*) FROM public.wallet_ledger
       WHERE wallet_id = 'e1e1e1e1-0000-0000-0000-000000000001') <> ledger_rows THEN
    RAISE EXCEPTION 'FAIL: reserving wrote a ledger row -- nothing was spent or received';
  END IF;
  RAISE NOTICE 'PASS: reserved %, balance untouched, ledger untouched', res;
END $$;

\echo '--- 3. you cannot set aside money you do not have ---'
DO $$
DECLARE goal uuid;
BEGIN
  SELECT id INTO goal FROM public.budget_goals
   WHERE user_id = '99999999-9999-9999-9999-999999999999' LIMIT 1;

  BEGIN
    -- 50000 balance, 30000 already reserved: only 20000 is free.
    PERFORM public.reserve_to_goal(goal, 25000);
    RAISE EXCEPTION 'FAIL: reserved more than was available';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: refused to reserve beyond available balance';
  END;
END $$;

\echo '--- 4. the wallet figure is recomputed from the goals, never incremented ---'
DO $$
DECLARE g2 uuid; res integer;
BEGIN
  INSERT INTO public.budget_goals (user_id, name, target_zmw)
  VALUES ('99999999-9999-9999-9999-999999999999', 'That fridge', 100000)
  RETURNING id INTO g2;

  PERFORM public.reserve_to_goal(g2, 15000);

  SELECT reserved_zmw INTO res FROM public.kithly_wallets
   WHERE user_id = '99999999-9999-9999-9999-999999999999';
  IF res <> 45000 THEN RAISE EXCEPTION 'FAIL: reserved is %, expected 45000', res; END IF;

  -- Cancelling a goal must take its share with it. An incrementing trigger
  -- would strand the 15000 here; a recompute cannot.
  UPDATE public.budget_goals SET status = 'cancelled' WHERE id = g2;

  SELECT reserved_zmw INTO res FROM public.kithly_wallets
   WHERE user_id = '99999999-9999-9999-9999-999999999999';
  IF res <> 30000 THEN
    RAISE EXCEPTION 'FAIL: reserved is % after cancelling, expected 30000 -- the figure was incremented, not recomputed', res;
  END IF;
  RAISE NOTICE 'PASS: recomputed from active goals in both directions';
END $$;

\echo '--- 5. releasing gives it back, and cannot give back more than is held ---'
DO $$
DECLARE goal uuid; res integer;
BEGIN
  SELECT id INTO goal FROM public.budget_goals
   WHERE user_id = '99999999-9999-9999-9999-999999999999' AND status = 'active' LIMIT 1;

  BEGIN
    PERFORM public.release_from_goal(goal, 999999);
    RAISE EXCEPTION 'FAIL: released more than the goal held';
  EXCEPTION WHEN check_violation THEN NULL; END;

  PERFORM public.release_from_goal(goal, 10000);
  SELECT reserved_zmw INTO res FROM public.kithly_wallets
   WHERE user_id = '99999999-9999-9999-9999-999999999999';
  IF res <> 20000 THEN RAISE EXCEPTION 'FAIL: reserved is % after release, expected 20000', res; END IF;
  RAISE NOTICE 'PASS: released 100.00, reserved now %', res;
END $$;

\echo '--- 6. available balance is what a shopper may actually spend ---'
DO $$
DECLARE avail integer;
BEGIN
  avail := public.wallet_available_zmw('99999999-9999-9999-9999-999999999999');
  IF avail <> 30000 THEN RAISE EXCEPTION 'FAIL: available is %, expected 30000', avail; END IF;
  RAISE NOTICE 'PASS: 500.00 held, 200.00 set aside, 300.00 spendable';
END $$;

\echo '--- 7. THE GUARD: nothing may spend reserved money, by any path ---'
DO $$
BEGIN
  BEGIN
    -- A direct write, as any future code path might attempt.
    UPDATE public.kithly_wallets SET balance = 10000
     WHERE user_id = '99999999-9999-9999-9999-999999999999';
    RAISE EXCEPTION 'FAIL: a wallet was drained below its reserved amount';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: the backstop refused a balance below reserved';
  END;

  -- And a write that leaves reserved intact is still fine.
  UPDATE public.kithly_wallets SET balance = 25000
   WHERE user_id = '99999999-9999-9999-9999-999999999999';
  RAISE NOTICE 'PASS: a legitimate balance change is unaffected';
END $$;

\echo '--- 8. checkout reads available balance, not balance ---'
DO $$
DECLARE src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc
   WHERE proname = 'checkout_init_atomic' AND pronamespace = 'public'::regnamespace;

  IF src IS NULL THEN RAISE EXCEPTION 'FAIL: checkout_init_atomic is not defined'; END IF;
  IF position('balance - reserved_zmw' in src) = 0 THEN
    RAISE EXCEPTION 'FAIL: checkout still reads raw balance -- a budget could be spent';
  END IF;
  RAISE NOTICE 'PASS: the live checkout definition consults reserved balance';
END $$;

\echo '--- 9. the signature stayed frozen and unoverloaded (ADR 0001) ---'
DO $$
DECLARE n integer; args text;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname = 'checkout_init_atomic' AND pronamespace = 'public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: checkout_init_atomic has % signatures', n; END IF;

  -- Types only. pg_get_function_identity_arguments() includes parameter names,
  -- which ADR 0001 does not freeze -- what is frozen is the argument list the
  -- edge function and the integration suites call through.
  SELECT oidvectortypes(proargtypes) INTO args FROM pg_proc
   WHERE proname = 'checkout_init_atomic' AND pronamespace = 'public'::regnamespace;
  IF args <> 'uuid, text, text, jsonb, jsonb' THEN
    RAISE EXCEPTION 'FAIL: the frozen signature changed to (%)', args;
  END IF;
  RAISE NOTICE 'PASS: one signature, unchanged (%)', args;
END $$;

\echo '--- 10. a goal may be free standing, or about a date, a thing or a shop ---'
DO $$
DECLARE n integer;
BEGIN
  INSERT INTO public.budget_goals (user_id, name, target_zmw, due_on)
  VALUES ('99999999-9999-9999-9999-999999999999', 'School fees, January', 250000, '2027-01-08');

  SELECT count(*) INTO n FROM public.budget_goals
   WHERE user_id = '99999999-9999-9999-9999-999999999999';
  IF n < 3 THEN RAISE EXCEPTION 'FAIL: expected at least 3 goals, got %', n; END IF;

  BEGIN
    INSERT INTO public.budget_goals (user_id, name, target_zmw, visibility)
    VALUES ('99999999-9999-9999-9999-999999999999', 'Group gift', 50000, 'shared');
    RAISE EXCEPTION 'FAIL: the group-purchase seam is open -- it should be documented, not usable';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: goals are flexible; the group seam stays shut until it is built';
  END;
END $$;
