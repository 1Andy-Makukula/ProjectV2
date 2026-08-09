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
-- 5. No function in `public` is overloaded.
--
-- checkout_init_atomic was rewritten nine times, each adding a parameter, and
-- the DROPs did not keep up: production ended up carrying several signatures at
-- once, and a 4-argument call returned PGRST203 because PostgREST could not
-- resolve which one was meant. Every stale copy also kept its own inherited
-- grants, so revoking the live one hardened nothing.
--
-- Checked generally rather than for that one function: a from-empty replay of
-- this chain produces exactly one signature per name today, so any overload is
-- drift rather than design. If an overload is ever genuinely wanted, this check
-- is the place to say so deliberately -- which is the point. Overloads on RPCs
-- reached by name through PostgREST are a footgun, and they cost a real
-- production incident once already.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dupes text[] := '{}';
  v_row   RECORD;
BEGIN
  FOR v_row IN
    SELECT p.proname, count(*) AS n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    GROUP BY p.proname
    HAVING count(*) > 1
    ORDER BY p.proname
  LOOP
    v_dupes := array_append(v_dupes, v_row.proname || ' x' || v_row.n);
  END LOOP;

  IF array_length(v_dupes, 1) > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: overloaded functions in public: %', v_dupes;
  END IF;
  RAISE NOTICE 'PASS: every function in public has a single signature';
END $$;

-- ---------------------------------------------------------------------------
-- 6. Notification and dispatch internals stay unreachable, and RLS stays alive.
--
-- Both halves matter. create_notification writes a notification to any user id
-- and is SECURITY DEFINER: reachable by anon, it is a phishing primitive on a
-- financial product, since the message arrives in the app's own notification
-- list. dispatch_expiry_reminder_whatsapp makes outbound HTTP, so reaching it
-- means sending real messages to real numbers at the platform's expense.
-- Neither is called from the frontend; both simply inherited the PUBLIC default
-- grant, and 20260809050000 removed it.
--
-- The second half guards the opposite failure. A check that only asserts things
-- are locked would pass happily on a database where current_user_role has been
-- revoked too -- and that single function backs 54 policies, so losing it locks
-- every user out of their own rows. Over-tightening is as much a regression as
-- under-tightening, and only asserting both catches it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text[] := '{}';
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT p.oid::regprocedure::text AS sig, r.rolname
    FROM pg_proc p
    CROSS JOIN (SELECT unnest(ARRAY['anon','authenticated']) AS rolname) r
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY[
        'create_notification','dispatch_expiry_reminder_whatsapp',
        'notify_conversation_counterparties','notify_experience_shop_owners',
        'notify_expiring_vouchers','notify_low_stock'
      ])
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  LOOP
    v_bad := array_append(v_bad, v_row.rolname || ' -> ' || v_row.sig);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: notification/dispatch internals reachable: %', v_bad;
  END IF;

  FOR v_row IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY[
        'current_user_role','can_view_list','can_edit_list','can_rate_shop',
        'can_access_conversation','can_access_shop_document_folder',
        'can_edit_item_options','is_transaction_buyer','is_transaction_recipient',
        'is_valid_opening_hours'
      ])
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    v_bad := array_append(v_bad, 'anon cannot reach ' || v_row.sig);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: RLS predicates are over-restricted: %', v_bad;
  END IF;

  RAISE NOTICE 'PASS: dispatch internals locked, RLS predicates still reachable';
END $$;

-- ---------------------------------------------------------------------------
-- 7. checkout_init_atomic's signature is frozen.
--
-- See docs/adr/0001-checkout-init-atomic-signature.md.
--
-- This function was rewritten nine times and grew from seven positional
-- parameters to twelve, one selling mode at a time. Each rewrite reproduced the
-- whole body, the DROPs did not keep up, and production ended up serving
-- several signatures at once -- a four-argument call returned PGRST203 because
-- PostgREST could not tell which was meant, and every stale copy kept its own
-- grants.
--
-- Everything that describes a checkout now travels in p_context, which rejects
-- unknown keys. A new vertical adds a key, not an argument.
--
-- Pinned because a freeze nobody can breach by accident is the only kind worth
-- having: all nine of those rewrites looked locally reasonable. Changing the
-- signature is allowed -- update this pin, add a superseding ADR explaining why
-- the context object was insufficient, and drop the old signature explicitly in
-- the same migration, remembering that a new signature does NOT inherit the old
-- one's grants.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count int;
  v_args  text;
  v_expected CONSTANT text :=
    'p_buyer_id uuid, p_origin_type text, p_gateway_tx_ref text, p_vendors jsonb, p_context jsonb';
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'checkout_init_atomic';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'CHECK FAILED: expected exactly 1 checkout_init_atomic, found % -- a stale overload is back', v_count;
  END IF;

  SELECT pg_get_function_identity_arguments(oid) INTO v_args
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'checkout_init_atomic';

  IF v_args <> v_expected THEN
    RAISE EXCEPTION 'CHECK FAILED: checkout_init_atomic signature changed. expected [%] but found [%]. See docs/adr/0001-checkout-init-atomic-signature.md before changing it.',
      v_expected, v_args;
  END IF;

  RAISE NOTICE 'PASS: checkout_init_atomic signature is unchanged (ADR 0001)';
END $$;

-- ---------------------------------------------------------------------------
-- 8. The supported-currency list exists in exactly one place, effectively.
--
-- It is written twice by necessity -- fx_supported_currencies() is the runtime
-- source, and the fx_quotes CHECK carries a literal because a function inside a
-- constraint is a dump/restore hazard and does not revalidate existing rows
-- when it changes. Two copies is tolerable; two copies that can drift is not.
--
-- They did drift, once: AUD was added to the constraint and not to the function,
-- so the schema advertised a currency the issuer refused, and AUD quotes failed
-- with "Unsupported quote currency" while the table said otherwise.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def      text;
  v_currency text;
  v_missing  text[] := '{}';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'fx_supported_currencies'
  ) THEN
    RAISE NOTICE 'SKIP: fx_supported_currencies() not present yet';
    RETURN;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.fx_quotes'::regclass AND conname = 'fx_quotes_currency_supported';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: fx_quotes has no currency constraint';
  END IF;

  FOREACH v_currency IN ARRAY public.fx_supported_currencies() LOOP
    IF position(v_currency IN v_def) = 0 THEN
      v_missing := array_append(v_missing, v_currency);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'CHECK FAILED: fx_supported_currencies() allows % but the fx_quotes constraint does not (%)',
      v_missing, v_def;
  END IF;

  -- And no issuer may reintroduce a private copy of the list.
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'issue_fx_quote'
      AND prosrc LIKE '%''GBP'', ''USD''%'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: issue_fx_quote has its own hardcoded currency list again';
  END IF;

  RAISE NOTICE 'PASS: supported currencies agree between function and constraint';
END $$;

DO $$
BEGIN
  RAISE NOTICE '--- CI smoke checks complete ---';
END $$;
