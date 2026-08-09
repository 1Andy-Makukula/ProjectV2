-- =============================================================================
-- Lock the money layer to service_role, and clear the checkout_init_atomic ghosts
--
-- ROOT CAUSE
-- ----------
-- PostgreSQL grants EXECUTE to PUBLIC by default on every newly created
-- function. Supabase's `anon` role inherits PUBLIC. Only the earliest
-- migrations (20260525130000, 20260611000000) issued explicit
-- `REVOKE ALL ... FROM PUBLIC`; every money RPC created or replaced since has
-- been callable by an unauthenticated caller holding nothing but the anon key
-- that ships in the browser bundle.
--
-- Verified live against production before writing this, using the public anon
-- key. Each of these executed:
--
--   increment_wallet_balance   -> HTTP 204. Mints spendable wallet credit.
--   claim_withdrawal_batch     -> HTTP 200. Returns merchant bank details and
--                                 transitions withdrawals to `processing`.
--   confirm_payment_atomic     -> reached the body (P0001 'Transaction not
--                                 found'), i.e. would confirm a real unpaid
--                                 transaction.
--   complete_withdrawal, settle_payout_atomic, complete_redemption,
--   process_due_redemptions, fulfill_voucher_atomic -> all reached the body.
--
-- The wallet-minting path does not touch the payment gateway at all: credits
-- cover the basket, `checkout_init_atomic` sets status SUCCESSFUL directly, and
-- a live claim code is issued. Sandbox gateway keys are therefore no defence.
--
-- SCOPE -- deliberately narrow
-- ---------------------------
-- This is a targeted deny-list, not a blanket `REVOKE ON ALL FUNCTIONS`.
-- `current_user_role()` is referenced in 54 RLS policy predicates, alongside
-- can_view_list / can_edit_list / can_rate_shop / can_access_conversation /
-- can_access_shop_document_folder / can_edit_item_options /
-- is_transaction_buyer / is_transaction_recipient. Revoking EXECUTE on those
-- locks every user out of their own rows. They are left untouched here.
--
-- The functions locked below were cross-checked against every `.rpc(` call
-- site in `src/`: the intersection is empty. Nothing the browser calls is
-- affected. All 22 are invoked exclusively by edge functions (service_role) or
-- by pg_cron (which runs as the job owner, not as a grantee).
--
-- Read-only pricing helpers (buyer_fee_percent_for, merchant_share_for,
-- unit_price_for, voucher_expiry_at, low_stock_threshold) are deliberately NOT
-- locked -- they disclose nothing and may be read for price display.
--
-- Trigger functions are not listed: PostgreSQL checks EXECUTE on a trigger
-- function at CREATE TRIGGER time, not at fire time, so they are unaffected by
-- grants either way.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Re-assert the RLS predicates BEFORE anything is revoked.
--
--    These are already accessible; stating them explicitly makes the intent
--    permanent and means a future blanket revoke cannot silently take the app
--    down without also reverting this block.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn   TEXT;
  v_proc RECORD;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'current_user_role',
    'can_view_list',
    'can_edit_list',
    'can_rate_shop',
    'can_access_conversation',
    'can_access_shop_document_folder',
    'can_edit_item_options',
    'is_transaction_buyer',
    'is_transaction_recipient'
  ] LOOP
    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role',
        v_proc.sig
      );
      RAISE NOTICE 'rls-predicate preserved: %', v_proc.sig;
    END LOOP;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Drop the stale checkout_init_atomic overloads.
--
--    Nine rewrites left older signatures behind: a bare 4-argument call returns
--    PGRST203 (overload cannot be resolved). The edge function passes all
--    twelve named arguments so it still resolves today, but ambiguous overloads
--    on the checkout entry point are a correctness hazard -- and the ghosts
--    carry their own inherited grants.
--
--    Identified by argument count rather than a literal signature string so
--    this is not brittle to type-rendering. The canonical function is the only
--    one with twelve arguments; the assertion below fails the migration rather
--    than dropping the wrong thing.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_keep_oid  OID;
  v_keep_args INT;
  v_proc      RECORD;
  v_dropped   INT := 0;
BEGIN
  SELECT p.oid, p.pronargs
    INTO v_keep_oid, v_keep_args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'checkout_init_atomic'
  ORDER BY p.pronargs DESC
  LIMIT 1;

  IF v_keep_oid IS NULL THEN
    RAISE EXCEPTION 'checkout_init_atomic not found -- refusing to continue';
  END IF;

  IF v_keep_args <> 12 THEN
    RAISE EXCEPTION
      'Expected the canonical checkout_init_atomic to take 12 arguments, found %. Refusing to drop anything.',
      v_keep_args;
  END IF;

  FOR v_proc IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'checkout_init_atomic'
      AND p.oid <> v_keep_oid
  LOOP
    EXECUTE format('DROP FUNCTION %s', v_proc.sig);
    v_dropped := v_dropped + 1;
    RAISE NOTICE 'dropped ghost overload: %', v_proc.sig;
  END LOOP;

  RAISE NOTICE 'checkout_init_atomic: kept 12-arg canonical, dropped % ghost(s)', v_dropped;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Lock the money layer.
--
--    Every overload of each named function is revoked from PUBLIC, anon and
--    authenticated, then granted to service_role. Iterating pg_proc rather than
--    writing signatures by hand means a REVOKE cannot silently no-op against a
--    signature that drifted.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn    TEXT;
  v_proc  RECORD;
  v_count INT := 0;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    -- checkout / payment
    'checkout_init_atomic',
    'confirm_payment_atomic',
    'sweep_hanging_payments',
    'trigger_payment_sweeper',
    -- fulfilment / redemption
    'fulfill_voucher_atomic',
    'atomic_fulfill_voucher',
    'complete_redemption',
    'process_due_redemptions',
    'process_expired_vouchers',
    'resolve_claim_code_for_shop',
    -- settlement / merchant balances
    'settle_payout_atomic',
    'apply_merchant_settlement',
    'increment_wallet_balance',
    'increment_merchant_balance',
    'refresh_shop_trust_tier',
    'resolve_shop_merchant_user_id',
    -- withdrawals / payouts
    'request_withdrawal_atomic',
    'claim_withdrawal_batch',
    'complete_withdrawal',
    'fail_withdrawal',
    'trigger_daily_payout_sweeper',
    -- admin-only data movement
    'import_catalog_item_to_shop'
  ] LOOP
    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_proc.sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_proc.sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_proc.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_proc.sig);
      v_count := v_count + 1;
      RAISE NOTICE 'locked to service_role: %', v_proc.sig;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'locked % function(s) to service_role', v_count;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No functions were locked -- the name list is wrong. Refusing to report success.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Stop this recurring.
--
--    Without this, the next `CREATE FUNCTION` in this schema is world-callable
--    again by default and the whole class of bug returns silently. From here a
--    new function is private unless its migration grants access deliberately.
--
--    Note for future migrations: any new function needed by an RLS policy or
--    called directly from the browser must now carry its own explicit GRANT.
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 5. Prove it, in the migration output.
--
--    Fails the migration -- rather than reporting a false success -- if any
--    locked function is still reachable by anon or authenticated.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_leak RECORD;
  v_bad  INT := 0;
BEGIN
  FOR v_leak IN
    SELECT p.oid::regprocedure AS sig, r.rolname
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
    RAISE WARNING 'STILL REACHABLE by %: %', v_leak.rolname, v_leak.sig;
    v_bad := v_bad + 1;
  END LOOP;

  IF v_bad > 0 THEN
    RAISE EXCEPTION '% money function(s) still reachable by anon/authenticated', v_bad;
  END IF;

  RAISE NOTICE 'verified: no money function is reachable by anon or authenticated';
END $$;
