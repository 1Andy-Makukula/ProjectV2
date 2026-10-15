-- =============================================================================
-- Escrow money functions were reachable with the public anon key
--
-- FOUND 13 Oct 2026, by running CI's own structural smoke checks against a
-- from-empty replay of the whole migration chain. Check 4 of
-- supabase/tests/ci_smoke_checks.sql has been failing since 15 Sep, and this
-- is what it was reporting. It is the reason CI has been red on main.
--
-- WHAT WAS WRONG
-- --------------
-- Every function added by the escrow rebuild (20260915*) and the two added by
-- 20260917* was executable by `anon` and `authenticated` -- that is, by anyone
-- holding the public anon key that ships in the browser bundle. All 28 of them:
-- the ledger writers, the payout queue, the refund queue, the fee sweeps, the
-- reconciliation entry point and the destination verifiers.
--
-- Those migrations DID try to lock themselves down. Each one ends with
--
--     REVOKE ALL ON FUNCTION public.<fn>(...) FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION public.<fn>(...) TO service_role;
--
-- and that is not enough, which is the lesson worth keeping. Supabase ships
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO
-- anon, authenticated, service_role` for objects owned by `postgres`. So each
-- new function is born with THREE direct role grants, and revoking PUBLIC
-- removes none of them. Confirmed on the replay -- every one of the 28 carried
-- `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
-- service_role=X/postgres}`. 20260809000000 revoked the PUBLIC *default*, which
-- is a different thing again and also does not touch the role grants.
--
-- The rule this leaves behind: on this project a money function is private only
-- once `anon` and `authenticated` are revoked BY NAME. PUBLIC is not the hole.
--
-- TWO AUTHORIZATION HOLES BEHIND THE GRANTS
-- -----------------------------------------
-- The grants are how you reach the functions; these are what you could do.
--
--   * `propose_fee_sweep` had no caller check whatsoever. It opens a sweep of
--     the platform's unswept fees out of the segregated account.
--
--   * `confirm_fee_sweep` and `cancel_fee_sweep` check `p_admin_id` -- that the
--     id NAMED is an admin -- and never that the CALLER is that admin. The
--     browser supplied that id (`useEscrowAdmin.ts` passed `profile.id`). So
--     anyone who knew an admin's user id could confirm a sweep and have
--     `admin_action_log` record that admin as having done it. A check against a
--     claimed identity is not an authorization check.
--
-- WHAT THIS DOES
-- --------------
--   1. Guards the three fee-sweep functions on the caller's own identity,
--      scoped to a direct caller -- see the note inside the first one.
--   2. Revokes EXECUTE from `anon` and `authenticated` on all 28, leaving
--      `service_role` alone. Only an Edge Function can reach them now, which
--      is the money-path rule this project already states:
--      user -> edge function (service_role) -> RPC.
--
-- The four with browser call sites moved to Edge Functions in the same change,
-- because revoking the grant without them would have broken two live screens:
--
--   propose/confirm/cancel_fee_sweep   useEscrowAdmin.ts -> AdminEscrow,
--                                      routed at admin/escrow
--                                      NOW: supabase/functions/admin-fee-sweep
--   set_payout_destination             usePayoutDestination.ts ->
--                                      PayoutDestinationPanel on the merchant
--                                      dashboard, where a merchant chooses
--                                      where their money lands
--                                      NOW: supabase/functions/set-payout-destination
--
-- `set_payout_destination`'s own body is NOT rewritten here. It authorises on
-- `p_actor_user_id` being assigned to the shop, which was the same
-- trust-the-caller's-claim weakness; the Edge Function now derives that id from
-- the verified JWT, so the claim is no longer the caller's to make. Rewriting a
-- second long money function body to say so twice is scope this did not need.
--
-- DEPLOY ORDER MATTERS. CI runs `db push` and then `functions deploy` in one
-- job, so the revoke lands a moment before the functions that replace it. If
-- that deploy step fails, the admin escrow screen and the merchant payout panel
-- stop working until it succeeds -- nothing on the checkout path is affected.
-- Watch that job, or deploy the two functions by hand first.
--
-- BLAST RADIUS: Critical global -- it changes who may execute 28 money
-- functions. Bounded by only ever REVOKING, never granting: `service_role`
-- keeps every grant it had.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. The fee-sweep functions decide the actor from auth.uid()
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.propose_fee_sweep(p_sweep_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_date   date := COALESCE(p_sweep_date, (now() AT TIME ZONE 'Africa/Lusaka')::date);
  v_amount bigint;
  v_id     uuid;
  v_open   RECORD;
BEGIN
  -- WHO IS ASKING.
  --
  -- The only caller after 20261013000000 is the `admin-fee-sweep` Edge
  -- Function, which runs as `service_role` and has already checked the
  -- caller is an admin (requireAdmin). That path carries no end-user JWT,
  -- so auth.uid() is null on it and the checks below would refuse it.
  --
  -- They are kept, scoped to a direct caller, so this function is still
  -- safe if EXECUTE is ever granted back to `authenticated` -- which is
  -- exactly how it was reachable in the first place. `auth.jwt() ->> 'role'`
  -- is Supabase's session role, per 20260614200000.
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
    -- IS DISTINCT FROM, not <>: a caller with no users row gets NULL back,
    -- and `NULL <> 'admin'` is NULL, which an IF treats as false and lets
    -- through.
    IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Forbidden: admin only';
    END IF;
  END IF;

  SELECT * INTO v_open FROM public.fee_sweeps WHERE status = 'PROPOSED';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'sweep_id', v_open.id, 'amount_ngwee', v_open.amount_ngwee,
      'status', 'PROPOSED', 'created', false,
      'message', 'A sweep is already awaiting confirmation.'
    );
  END IF;

  v_amount := public.ledger_account_balance('FEE_ACCRUED');

  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('amount_ngwee', v_amount, 'created', false,
                              'message', 'Nothing accrued to sweep.');
  END IF;

  INSERT INTO public.fee_sweeps (sweep_date, amount_ngwee)
  VALUES (v_date, v_amount)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'sweep_id', v_id, 'sweep_date', v_date,
    'amount_ngwee', v_amount, 'amount_zmw', round(v_amount / 100.0, 2),
    'status', 'PROPOSED', 'created', true
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.confirm_fee_sweep(
  p_sweep_id       uuid,
  p_bank_reference text,
  p_admin_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row  RECORD;
  v_pair uuid;
BEGIN
  -- WHO IS ASKING.
  --
  -- The only caller after 20261013000000 is the `admin-fee-sweep` Edge
  -- Function, which runs as `service_role` and has already checked the
  -- caller is an admin (requireAdmin). That path carries no end-user JWT,
  -- so auth.uid() is null on it and the checks below would refuse it.
  --
  -- They are kept, scoped to a direct caller, so this function is still
  -- safe if EXECUTE is ever granted back to `authenticated` -- which is
  -- exactly how it was reachable in the first place. `auth.jwt() ->> 'role'`
  -- is Supabase's session role, per 20260614200000.
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
    -- IS DISTINCT FROM, not <>: a caller with no users row gets NULL back,
    -- and `NULL <> 'admin'` is NULL, which an IF treats as false and lets
    -- through.
    IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Forbidden: admin only';
    END IF;
    -- And the caller must BE the admin they name. The p_admin_id check
    -- further down proves only that the named person is an admin, not that
    -- they are the one calling, and p_admin_id arrived from the browser.
    IF p_admin_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'The acting admin must be the caller';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  IF COALESCE(btrim(p_bank_reference), '') = '' THEN
    RAISE EXCEPTION 'A bank reference is required: the ledger records money that moved';
  END IF;

  SELECT * INTO v_row FROM public.fee_sweeps WHERE id = p_sweep_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such sweep %', p_sweep_id;
  END IF;

  IF v_row.status <> 'PROPOSED' THEN
    RAISE EXCEPTION 'Sweep % is %, not awaiting confirmation', p_sweep_id, v_row.status;
  END IF;

  v_pair := public.post_ledger_pair(
    'FEE_ACCRUED',  NULL,
    'CLIENT_FUNDS', NULL,
    v_row.amount_ngwee,
    'FEE_SWEEP',
    NULL, NULL, NULL,
    p_bank_reference,
    'fee-sweep:' || p_sweep_id::text
  );

  UPDATE public.fee_sweeps
  SET status = 'CONFIRMED', confirmed_at = now(),
      bank_reference = p_bank_reference, ledger_pair_id = v_pair
  WHERE id = p_sweep_id;

  INSERT INTO public.admin_action_log (actor_id, action, target_type, target_id, payload)
  VALUES (p_admin_id, 'FEE_SWEEP_CONFIRMED', 'fee_sweep', p_sweep_id,
          jsonb_build_object('amount_ngwee', v_row.amount_ngwee,
                             'bank_reference', p_bank_reference));

  RETURN jsonb_build_object(
    'sweep_id', p_sweep_id, 'status', 'CONFIRMED',
    'amount_ngwee', v_row.amount_ngwee, 'ledger_pair_id', v_pair,
    'fees_accrued_after_ngwee', public.ledger_account_balance('FEE_ACCRUED')
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.cancel_fee_sweep(
  p_sweep_id uuid,
  p_reason   text,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- WHO IS ASKING.
  --
  -- The only caller after 20261013000000 is the `admin-fee-sweep` Edge
  -- Function, which runs as `service_role` and has already checked the
  -- caller is an admin (requireAdmin). That path carries no end-user JWT,
  -- so auth.uid() is null on it and the checks below would refuse it.
  --
  -- They are kept, scoped to a direct caller, so this function is still
  -- safe if EXECUTE is ever granted back to `authenticated` -- which is
  -- exactly how it was reachable in the first place. `auth.jwt() ->> 'role'`
  -- is Supabase's session role, per 20260614200000.
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
    -- IS DISTINCT FROM, not <>: a caller with no users row gets NULL back,
    -- and `NULL <> 'admin'` is NULL, which an IF treats as false and lets
    -- through.
    IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Forbidden: admin only';
    END IF;
    -- And the caller must BE the admin they name. The p_admin_id check
    -- further down proves only that the named person is an admin, not that
    -- they are the one calling, and p_admin_id arrived from the browser.
    IF p_admin_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'The acting admin must be the caller';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  UPDATE public.fee_sweeps
  SET status = 'CANCELLED', cancelled_at = now(), cancelled_reason = p_reason
  WHERE id = p_sweep_id AND status = 'PROPOSED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sweep % is not awaiting confirmation', p_sweep_id;
  END IF;

  INSERT INTO public.admin_action_log (actor_id, action, target_type, target_id, payload)
  VALUES (p_admin_id, 'FEE_SWEEP_CANCELLED', 'fee_sweep', p_sweep_id,
          jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('sweep_id', p_sweep_id, 'status', 'CANCELLED');
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. Only the service role may execute any of them
--
-- Nothing calls these as `anon`: a signed-in caller is `authenticated`, and
-- after this migration a signed-in caller cannot reach them either. The Edge
-- Functions use `service_role`, whose grants are untouched throughout.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.cancel_fee_sweep(uuid,text,uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_due_payouts(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_due_refunds(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_payout(uuid,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_refund(uuid,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_fee_sweep(uuid,text,uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_payout(uuid,bigint,text,uuid,uuid,timestamp with time zone) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.escrow_open_balances(boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.escrow_process_expiries(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.escrow_reconcile(bigint,timestamp with time zone) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.escrow_record_funding(uuid,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.escrow_redeem_items(text,uuid[],uuid[],uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.escrow_shadow_redemption(uuid,text,integer,integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_payout(uuid,text,boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_refund(uuid,text,boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_destination_failed(uuid,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_destination_verified(uuid,text,text,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_destination_verifying(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_payout_sent(uuid,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_item_fee_share_ngwee(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_ledger_pair(text,uuid,text,uuid,bigint,text,uuid,uuid,uuid,text,text,uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.propose_fee_sweep(date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_rail_outcome(text,boolean,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_settlement_tier(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_charge_instruction(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reverse_ledger_pair(uuid,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_payout_destination(uuid,uuid,text,text,text,text,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_settlement_manual_flag(uuid,boolean,text,uuid) FROM anon, authenticated;
