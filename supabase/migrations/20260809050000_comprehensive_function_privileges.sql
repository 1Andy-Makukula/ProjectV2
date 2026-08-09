-- =============================================================================
-- Every function in `public` is private unless it has a reason to be public
--
-- WHY
-- ---
-- 20260809000000 locked the money layer and set ALTER DEFAULT PRIVILEGES so new
-- functions are no longer world-callable. Both were deliberately narrow: at the
-- time there were no tests, and a blanket revoke that got the allowlist wrong
-- would have locked every user out of their own rows with no way to catch it
-- before production.
--
-- That gap is now covered -- the money path has integration tests and the
-- migration chain replays from empty in CI -- so this finishes the job for the
-- functions that already existed.
--
-- Of 70 callable functions, `anon` could reach 38. Most were harmless read
-- helpers. Two were not:
--
--   create_notification(p_user_id, p_message, p_type, p_reference_id)
--     SECURITY DEFINER, callable by anyone holding the anon key from the
--     browser bundle, and it writes a notification to ANY user id. On a
--     financial product that is a phishing primitive: "your payment failed, tap
--     here" arriving inside the app's own notification list, which is precisely
--     the surface a user has been taught to trust.
--
--   dispatch_expiry_reminder_whatsapp()
--     SECURITY DEFINER, makes outbound HTTP through pg_net. An unauthenticated
--     caller could trigger WhatsApp dispatch at will -- real messages to real
--     phone numbers, billed to the platform, with a rate limit of however fast
--     they can send requests.
--
-- Neither is reachable from the frontend. Both are internals that inherited the
-- PUBLIC default grant, like everything else.
--
-- SHAPE
-- -----
-- Revoke from PUBLIC/anon/authenticated across the board, then grant back three
-- explicit sets. Derived, not guessed:
--
--   * RLS predicates, from the functions actually named in policy USING and
--     WITH CHECK clauses (current_user_role alone backs 54 of them).
--   * The CHECK-constraint helper, from pg_constraint's dependencies.
--   * Browser-callable RPCs, from every `.rpc(` call site in src/.
--
-- No view in public depends on a function in public, so there is nothing to
-- account for there.
--
-- service_role is granted everything. It is the secret key -- it already
-- bypasses RLS, and edge functions call across the whole surface. Without an
-- explicit grant the blanket revoke would take its access away too, since it
-- holds most of it through PUBLIC.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Revoke everything, then restore service_role.
--
--    Trigger functions are included in the revoke and deliberately not granted
--    back: PostgreSQL checks EXECUTE on a trigger function when the trigger is
--    CREATED, not when it fires, so revoking cannot break one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_proc RECORD;
  v_count INT := 0;
BEGIN
  FOR v_proc IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_proc.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_proc.sig);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'revoked PUBLIC/anon/authenticated on % function(s); service_role retained', v_count;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No functions found in public -- refusing to report success';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Grant back what anon AND authenticated genuinely need.
--
--    RLS predicates come first and matter most: current_user_role is named in
--    54 policies, and without it every user is locked out of their own rows.
--
--    The read-only helpers below disclose nothing -- a fee percentage, a price
--    tier, an expiry date. They are granted rather than locked because a logged
--    out visitor browsing the storefront legitimately reaches them, and the
--    cost of being wrong is a broken shop page for the cost of hiding a number
--    that is already on screen.
--
--    get_transaction_status and get_shop_order_by_claim_code are deliberately
--    included. Both are read-only and keyed on an identifier the caller must
--    already hold, and a buyer returning from the payment gateway may land on
--    the confirmation page before a session is restored.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn   TEXT;
  v_proc RECORD;
  v_missing TEXT[] := '{}';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    -- RLS predicates
    'current_user_role',
    'can_access_conversation',
    'can_access_shop_document_folder',
    'can_edit_item_options',
    'can_edit_list',
    'can_rate_shop',
    'can_view_list',
    'is_transaction_buyer',
    'is_transaction_recipient',
    -- CHECK constraint on shops.opening_hours
    'is_valid_opening_hours',
    -- Read-only display helpers
    'buyer_fee_percent_for',
    'merchant_share_for',
    'unit_price_for',
    'voucher_expiry_at',
    'low_stock_threshold',
    'experience_is_available',
    'experience_total',
    -- Read-only lookups reachable before a session exists
    'get_transaction_status',
    'get_shop_order_by_claim_code',
    'generate_list_slug'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
    ) THEN
      v_missing := array_append(v_missing, v_fn);
      CONTINUE;
    END IF;

    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', v_proc.sig);
    END LOOP;
  END LOOP;

  -- A name that no longer exists means this list has drifted from the schema,
  -- and the next reader would have no way to tell which entries still matter.
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'public-read allowlist names functions that do not exist: %', v_missing;
  END IF;

  RAISE NOTICE 'anon + authenticated: RLS predicates, constraint helper and read-only lookups';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Grant back the browser-callable RPCs, to authenticated only.
--
--    Every one of these is called from src/ with a session and checks
--    auth.uid(), current_user_role(), or both. anon is excluded because an
--    anonymous call could only ever fail -- and holding EXECUTE anyway means a
--    future edit that relaxes an internal check is exposed to the internet
--    rather than to logged-in users.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn   TEXT;
  v_proc RECORD;
  v_missing TEXT[] := '{}';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'accept_quotation',
    'create_quotation',
    'decline_quotation',
    'copy_list',
    'mark_conversation_read',
    'raise_order_dispute',
    'send_message',
    'start_conversation',
    'update_shop_profile',
    'convert_floating_item_to_credits',
    'register_merchant_shop',
    'set_experience_items',
    'review_merchant_verification',
    'log_admin_action',
    'admin_expire_order',
    'admin_force_fulfill_order',
    'admin_broadcast_notification',
    'admin_start_conversation'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
    ) THEN
      v_missing := array_append(v_missing, v_fn);
      CONTINUE;
    END IF;

    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_proc.sig);
    END LOOP;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'browser-RPC allowlist names functions that do not exist: %', v_missing;
  END IF;

  RAISE NOTICE 'authenticated: browser-callable RPCs';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Verify both directions, or fail the migration.
--
--    Checking only that things are locked would pass on a database where
--    everything is locked, including the predicates the application cannot
--    work without. Both halves are asserted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad  TEXT[] := '{}';
  v_row  RECORD;
BEGIN
  -- Must be unreachable.
  FOR v_row IN
    SELECT p.oid::regprocedure::text AS sig, r.rolname
    FROM pg_proc p
    CROSS JOIN (SELECT unnest(ARRAY['anon','authenticated']) AS rolname) r
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (ARRAY[
        'create_notification','dispatch_expiry_reminder_whatsapp',
        'notify_conversation_counterparties','notify_experience_shop_owners',
        'notify_expiring_vouchers','notify_low_stock',
        'ensure_transaction_code','gen_claim_code',
        'checkout_init_atomic','confirm_payment_atomic','increment_wallet_balance',
        'claim_withdrawal_batch','settle_payout_atomic'
      ])
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  LOOP
    v_bad := array_append(v_bad, v_row.rolname || ' -> ' || v_row.sig);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'still reachable: %', v_bad;
  END IF;

  -- Must remain reachable, or the application is dead.
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
    v_bad := array_append(v_bad, 'anon LOST access to ' || v_row.sig);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'RLS would break: %', v_bad;
  END IF;

  -- service_role must keep everything, or every edge function stops working.
  FOR v_row IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prorettype <> 'trigger'::regtype
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  LOOP
    v_bad := array_append(v_bad, 'service_role LOST access to ' || v_row.sig);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'service_role would break: %', v_bad;
  END IF;

  RAISE NOTICE 'function privileges: locked by default, RLS intact, service_role whole';
END $$;
