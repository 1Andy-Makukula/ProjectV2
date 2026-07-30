-- =============================================================================
-- CI structural smoke checks
--
-- Runs after the full migration chain replays from empty (see
-- .github/workflows/ci.yml's db-migrations job). These aren't behavior
-- tests -- they check that specific past mistakes can't silently reappear:
-- an immutability trigger missing from a ledger table, a money-routing
-- function reading shops.owner_id again, or a blanket merchant-write RLS
-- policy landing on shops (see 20260729040000_shop_self_service_rpc.sql for
-- why that specific policy must never exist).
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '--- CI smoke checks starting ---';
END $$;

-- ---------------------------------------------------------------------------
-- 1. Every append-only ledger table still has its immutability trigger.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_missing text[] := '{}';
BEGIN
  FOREACH v_table IN ARRAY ARRAY['payout_ledger', 'wallet_ledger', 'transaction_events', 'merchant_float_ledger', 'admin_action_log']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = v_table AND t.tgfoid = 'public.enforce_immutable_ledger'::regproc
    ) THEN
      v_missing := array_append(v_missing, v_table);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: missing enforce_immutable_ledger trigger on: %', v_missing;
  END IF;
  RAISE NOTICE 'PASS: all 5 ledger tables have their immutability trigger';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Regression guard for the owner_id -> merchant_shops fix: none of the
--    four money-moving functions may read shops.owner_id again.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_def text;
  v_offenders text[] := '{}';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.increment_merchant_balance(uuid,integer)',
    'public.request_withdrawal_atomic(uuid,integer)',
    'public.fail_withdrawal(uuid,text)',
    'public.complete_withdrawal(uuid,text,text)'
  ]
  LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF v_def ILIKE '%FROM public.shops%owner_id%' OR v_def ILIKE '%shops.owner_id%' THEN
      v_offenders := array_append(v_offenders, v_fn);
    END IF;
  END LOOP;

  IF array_length(v_offenders, 1) > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: these money functions read shops.owner_id again: %', v_offenders;
  END IF;
  RAISE NOTICE 'PASS: money-moving functions never read shops.owner_id';
END $$;

-- ---------------------------------------------------------------------------
-- 3. shops must stay admin-only at the RLS layer -- merchant self-service
--    goes exclusively through update_shop_profile()'s whitelist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shops'
      AND policyname NOT IN ('shops_public_read', 'shops_admin_write')
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: an unexpected RLS policy exists on shops -- merchant writes must stay RPC-only';
  END IF;
  RAISE NOTICE 'PASS: shops RLS is still admin-write-only';
END $$;

-- ---------------------------------------------------------------------------
-- 4. update_shop_profile must never accept owner_id/is_active/verification_*
--    as parameters -- that's the whole point of the whitelist.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_args text;
BEGIN
  SELECT pg_get_function_arguments('public.update_shop_profile'::regproc) INTO v_args;
  IF v_args ILIKE '%owner_id%' OR v_args ILIKE '%is_active%' OR v_args ILIKE '%verification%' THEN
    RAISE EXCEPTION 'CHECK FAILED: update_shop_profile accepts a governance field as a parameter: %', v_args;
  END IF;
  RAISE NOTICE 'PASS: update_shop_profile does not expose governance fields';
END $$;

-- ---------------------------------------------------------------------------
-- 5. Every table this session's work depends on exists (fast, cheap sanity
--    check that the baseline snapshot + full chain produced the right shape).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_missing text[] := '{}';
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'users','shops','items','transactions','shop_orders','order_items',
    'kithly_wallets','wallet_ledger','transaction_events','merchant_shops',
    'payout_ledger','merchant_withdrawals','payout_bank_codes','admin_action_log',
    'conversations','messages','quotations','experiences'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_table
    ) THEN
      v_missing := array_append(v_missing, v_table);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: expected tables missing after full replay: %', v_missing;
  END IF;
  RAISE NOTICE 'PASS: all expected tables present after a from-empty replay';
END $$;

DO $$
BEGIN
  RAISE NOTICE '--- CI smoke checks complete ---';
END $$;
