-- =============================================================================
-- atomic_fulfill_voucher: resolve the merchant deterministically
--
-- WHAT IS ACTUALLY WRONG
-- ----------------------
-- The USSD redemption path picks the merchant it hands to
-- fulfill_voucher_atomic like this:
--
--     (SELECT ms.user_id FROM public.merchant_shops ms
--       WHERE ms.shop_id = p_shop_id LIMIT 1)
--
-- LIMIT 1 with no ORDER BY returns whichever row the planner reaches first.
-- For a shop with two staff accounts that is not stable across plans, index
-- changes or row churn: the same shop can resolve to a different person from
-- one redemption to the next.
--
-- 20260729030000_fix_merchant_wallet_resolution.sql already fixed exactly this
-- class of bug everywhere money moves, and introduced
-- `resolve_shop_merchant_user_id` as the single source of truth -- the same
-- lookup with `ORDER BY created_at ASC`, so it is deterministic. That
-- migration's own header cites this call site as the pattern it was mirroring,
-- and then did not convert it. This converts it.
--
-- WHAT IS NOT WRONG, CONTRARY TO THE 2026-09-14 AUDIT
-- ---------------------------------------------------
-- The audit reported this as "fulfillment can't tell you who did it -- for a
-- fraud investigation, which staff member redeemed this, that's a dead end."
-- That overstates it on two counts, and the record should be accurate because
-- someone will read this file during an investigation.
--
-- First, the call site is in `atomic_fulfill_voucher`, the USSD wrapper, not
-- in `fulfill_voucher_atomic`. The app path does not go through it: the
-- fulfill-voucher Edge Function calls `fulfill_voucher_atomic` directly with
-- the authenticated merchant's own id, which is correct already.
--
-- Second, the USSD audit trail is not lost. ussd-gateway resolves the caller
-- from the dialling MSISDN (unique on users.phone since 20260903010000) and
-- writes that id into transaction_events as `merchant_user_id` on both
-- CLAIM_VERIFIED and FRAUD_REJECTION. So "who redeemed this" is recorded, from
-- a better source than this subquery, on every USSD redemption.
--
-- What the subquery feeds is the authorization argument inside
-- fulfill_voucher_atomic -- `IF NOT EXISTS (SELECT 1 FROM merchant_shops WHERE
-- user_id = p_merchant_user_id AND shop_id = ...)`. Any assigned user passes
-- that check, so the arbitrary pick has never let an unauthorized redemption
-- through. It is a correctness and consistency defect, not an open door, and
-- it is worth closing because two tables disagreeing about "who is the
-- merchant for this shop" is precisely what 20260729030000 was written to end.
--
-- HOW THIS FILE WAS PRODUCED
-- --------------------------
-- The body was not retyped. It was extracted verbatim from its only definition
-- in 20260525130000_v2_atomic_money_rpcs.sql (lines 472-527) and patched by
-- exact string replacement at a single unique anchor. The complete diff
-- against the live body is one line replaced and nothing else:
--
--     <     (SELECT ms.user_id FROM public.merchant_shops ms WHERE ms.shop_id = p_shop_id LIMIT 1)
--     >     public.resolve_shop_merchant_user_id(p_shop_id)
--
-- CREATE OR REPLACE, not DROP + CREATE: the signature is unchanged and a DROP
-- would discard the ACL set by 20260809000000_lock_money_rpcs_service_role_only.
--
-- BLAST RADIUS 🟡
-- ---------------
-- Sole caller is supabase/functions/ussd-gateway/index.ts:229. No collision
-- with the staged escrow work -- 20260915045000 patches `fulfill_voucher_atomic`,
-- a different function, and nothing in the escrow set redefines this one.
-- Behaviour on a shop with no assigned merchant is unchanged: the subquery
-- returned NULL and so does the helper, and the inner authorization check
-- rejects identically.
--
-- NOT ADDRESSED HERE, DELIBERATELY
-- --------------------------------
-- The SELECT below reads shop_orders with `claim_status = 'PENDING'` and no
-- FOR UPDATE before delegating -- a check-then-act above a money operation.
-- It is not a live race, because fulfill_voucher_atomic re-selects the same
-- row FOR UPDATE and flips it to PROCESSING_FULFILLMENT. Adding the lock is a
-- money-path change and is out of scope for this pass; it is noted so the next
-- person does not have to rediscover it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.atomic_fulfill_voucher(
  p_claim_code TEXT,
  p_shop_id UUID
)
RETURNS TABLE (
  voucher_id UUID,
  item_name TEXT,
  recipient_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_present_ids UUID[];
  v_result JSONB;
  v_item_name TEXT;
BEGIN
  SELECT so.shop_order_id, so.transaction_id, so.recipient_name
  INTO v_order
  FROM public.shop_orders so
  WHERE so.claim_code = upper(trim(p_claim_code))
    AND so.shop_id = p_shop_id
    AND so.claim_status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FRAUD_REJECTION:Invalid or already fulfilled code';
  END IF;

  SELECT array_agg(order_item_id) INTO v_present_ids
  FROM public.order_items
  WHERE shop_order_id = v_order.shop_order_id;

  SELECT i.name INTO v_item_name
  FROM public.order_items oi
  JOIN public.items i ON i.id = oi.item_id
  WHERE oi.shop_order_id = v_order.shop_order_id
  LIMIT 1;

  v_result := public.fulfill_voucher_atomic(
    p_claim_code,
    COALESCE(v_present_ids, ARRAY[]::UUID[]),
    ARRAY[]::UUID[],
    public.resolve_shop_merchant_user_id(p_shop_id)
  );

  IF v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FRAUD_REJECTION:Fulfillment failed';
  END IF;

  RETURN QUERY
  SELECT v_order.transaction_id, COALESCE(v_item_name, 'Gift'), COALESCE(v_order.recipient_name, 'Customer');
END;
$$;

-- ---------------------------------------------------------------------------
-- Re-assert the service-role lock rather than inherit it.
--
-- CREATE OR REPLACE does preserve the existing ACL, so on the deployed project
-- the grants from 20260525130000 and 20260809000000 survive this file
-- untouched. But "preserved" is only as good as what was there, and a function
-- in `public` carries EXECUTE for PUBLIC by default -- so anywhere the earlier
-- REVOKE has not run (a fresh cluster, a partial replay, scripts/sql-test.sh),
-- replacing the body would quietly leave a money RPC callable by every role.
--
-- Stating the lock here costs nothing and makes the migration self-contained.
-- service_role only exists on Supabase, so the GRANT is guarded.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.atomic_fulfill_voucher(TEXT, UUID) FROM PUBLIC;

DO $$
DECLARE
  v_role TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.atomic_fulfill_voucher(TEXT, UUID) FROM %I',
        v_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.atomic_fulfill_voucher(TEXT, UUID) TO service_role';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.atomic_fulfill_voucher(TEXT, UUID) IS
  'USSD redemption wrapper (all items collected). Resolves the merchant via '
  'resolve_shop_merchant_user_id so it cannot disagree with the settlement '
  'and withdrawal paths. The acting operator is recorded separately by '
  'ussd-gateway from the dialling MSISDN.';

-- ---------------------------------------------------------------------------
-- Assert the arbitrary pick is gone, and that the ACL survived the replace.
--
-- The first check greps the live function source rather than trusting that
-- this file is the definition in effect -- the same ambiguity Part 2 of the
-- audit raised about repeatedly-replaced money functions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src TEXT;
  v_reachable TEXT;
BEGIN
  SELECT pg_get_functiondef('public.atomic_fulfill_voucher(text, uuid)'::regprocedure)
  INTO v_src;

  IF v_src LIKE '%merchant_shops ms WHERE ms.shop_id = p_shop_id LIMIT 1%' THEN
    RAISE EXCEPTION
      'atomic_fulfill_voucher still resolves the merchant with a bare LIMIT 1';
  END IF;

  IF v_src NOT LIKE '%resolve_shop_merchant_user_id(p_shop_id)%' THEN
    RAISE EXCEPTION
      'atomic_fulfill_voucher is not calling resolve_shop_merchant_user_id -- a later definition may have replaced this one';
  END IF;

  -- 20260809000000 revoked these from anon/authenticated. CREATE OR REPLACE
  -- preserves the ACL, but assert it rather than assume it: a DROP + CREATE
  -- slipping in here is how a money RPC was once handed back to authenticated.
  --
  -- Guarded on the role existing. These are Supabase roles; on the bare
  -- throwaway cluster that scripts/sql-test.sh spins up they are absent, and
  -- has_function_privilege() on an unknown role raises rather than returning
  -- false. Skipping the check there is correct -- there is no role to leak to.
  -- Driven off pg_roles rather than a literal list with an EXISTS guard: the
  -- planner is free to evaluate has_function_privilege() before a guard in the
  -- same WHERE clause, and it raises on an unknown role rather than returning
  -- false. Scanning pg_roles means every name reaching the call exists.
  SELECT string_agg(pr.rolname, ', ') INTO v_reachable
  FROM pg_roles pr
  WHERE pr.rolname IN ('anon', 'authenticated')
    AND has_function_privilege(
      pr.rolname,
      'public.atomic_fulfill_voucher(text, uuid)'::regprocedure,
      'EXECUTE'
    );

  IF v_reachable IS NOT NULL THEN
    RAISE EXCEPTION
      'atomic_fulfill_voucher is EXECUTE-reachable by % -- the service-role lock from 20260809000000 was lost',
      v_reachable;
  END IF;

  RAISE NOTICE 'atomic_fulfill_voucher: deterministic resolution confirmed, service-role lock intact.';
END;
$$;
