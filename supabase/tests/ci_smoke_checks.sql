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

-- ---------------------------------------------------------------------------
-- 4. No money function is reachable by anon or authenticated.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default on every new function, and
-- Supabase's `anon` role inherits PUBLIC. Every money RPC created after the
-- earliest migrations was therefore callable by anyone holding the anon key
-- that ships in the browser bundle -- verified live against production on
-- 2026-08-09, where `increment_wallet_balance` returned HTTP 204 and would
-- mint spendable wallet credit for any user id.
--
-- Closed by 20260809000000_lock_money_rpcs_service_role_only.sql. This check
-- exists because the fix is one `CREATE OR REPLACE` away from being undone:
-- replacing a function preserves its ACL, but a migration that CREATEs a new
-- money function, or DROPs and recreates one, silently gets the PUBLIC default
-- back. Nothing but this check would notice.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leak    RECORD;
  v_leaked  text[] := '{}';
BEGIN
  FOR v_leak IN
    SELECT p.oid::regprocedure::text AS sig, r.rolname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (SELECT unnest(ARRAY['anon','authenticated']) AS rolname) r
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'checkout_init_atomic','confirm_payment_atomic','sweep_hanging_payments',
        'trigger_payment_sweeper','fulfill_voucher_atomic','atomic_fulfill_voucher',
        'complete_redemption','process_due_redemptions','process_expired_vouchers',
        'resolve_claim_code_for_shop','settle_payout_atomic','apply_merchant_settlement',
        'increment_wallet_balance','increment_merchant_balance','refresh_shop_trust_tier',
        'resolve_shop_merchant_user_id','request_withdrawal_atomic','claim_withdrawal_batch',
        'complete_withdrawal','fail_withdrawal','trigger_daily_payout_sweeper',
        'import_catalog_item_to_shop'
      ])
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  LOOP
    v_leaked := array_append(v_leaked, v_leak.rolname || ' -> ' || v_leak.sig);
  END LOOP;

  IF array_length(v_leaked, 1) > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: money functions reachable by anon/authenticated: %', v_leaked;
  END IF;
  RAISE NOTICE 'PASS: no money function is reachable by anon or authenticated';
END $$;

-- ---------------------------------------------------------------------------
-- 5. checkout_init_atomic has exactly one signature.
--
-- Nine rewrites left older overloads behind in production; a 4-argument call
-- returned PGRST203 (overload could not be resolved) until they were dropped.
-- Ambiguous overloads on the checkout entry point are a correctness hazard,
-- and each ghost carries its own inherited grants.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'checkout_init_atomic';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: expected exactly 1 checkout_init_atomic, found %', v_count;
  END IF;
  RAISE NOTICE 'PASS: checkout_init_atomic has a single canonical signature';
END $$;

DO $$
BEGIN
  RAISE NOTICE '--- CI smoke checks complete ---';
END $$;
