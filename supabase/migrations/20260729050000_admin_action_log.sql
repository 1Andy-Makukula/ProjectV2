-- =============================================================================
-- Durable admin action log
--
-- No table anywhere records "which admin did what to whom" -- confirmed
-- absent by search across every migration. admin-set-password and
-- create-merchant only ever console.log, which is ephemeral runtime output,
-- not queryable or reportable. transaction_events exists but is
-- money-specific, not a general admin-action record. So a shop's
-- verification decision, a merchant's shop reassignment, a directly-set
-- password, or a deactivated shop currently leave no durable trace of who
-- did it or when, beyond whatever the affected row's own updated_at happens
-- to show.
--
-- This mirrors the append-only shape already established for
-- payout_ledger/wallet_ledger/transaction_events/merchant_float_ledger, and
-- reuses their shared enforce_immutable_ledger() trigger function BY
-- REFERENCE -- that function is itself never defined in any migration in
-- this repo (it was created by hand, like several other objects; see the
-- CI-hardening plan). Redefining it here with a guessed body would risk
-- silently changing behavior shared by four other tables. Attaching the
-- existing function to a fifth, differently-shaped table is safe precisely
-- because it already works correctly across four different table shapes
-- today, which only holds if it is written generically (RAISE on any
-- UPDATE/DELETE, not keyed to specific columns) -- not verifiable from this
-- repo alone, since the function body isn't in it, but strongly evidenced
-- by its four existing successful attachments.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   UUID,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_actor
  ON public.admin_action_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_target
  ON public.admin_action_log (target_type, target_id, created_at DESC);

ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_action_log_admin_select ON public.admin_action_log;
CREATE POLICY admin_action_log_admin_select ON public.admin_action_log
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

-- No write policy at all -- log_admin_action() (SECURITY DEFINER) is the
-- only write path, for both authenticated admin sessions and service-role
-- Edge Functions.

DROP TRIGGER IF EXISTS enforce_immutable_admin_action_log ON public.admin_action_log;
CREATE TRIGGER enforce_immutable_admin_action_log
BEFORE UPDATE OR DELETE ON public.admin_action_log
FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

-- ---------------------------------------------------------------------------
-- log_admin_action — the one write entrypoint.
--
-- auth.uid() always wins over p_actor_id when both are present, so an
-- authenticated caller can never attribute an action to someone else.
-- p_actor_id exists only for service-role Edge Functions, which have no
-- auth.uid() of their own and must already have run requireAdmin() (or
-- equivalent) before calling this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action      TEXT,
  p_target_type TEXT,
  p_target_id   UUID DEFAULT NULL,
  p_payload     JSONB DEFAULT '{}'::jsonb,
  p_actor_id    UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_actor UUID;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF public.current_user_role() <> 'admin' THEN
      RAISE EXCEPTION 'Only admins may write to the action log';
    END IF;
    v_actor := auth.uid();
  ELSE
    v_actor := p_actor_id;
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'log_admin_action requires an actor: an authenticated admin session, or an explicit p_actor_id from a service-role caller';
  END IF;

  INSERT INTO public.admin_action_log (actor_id, action, target_type, target_id, payload)
  VALUES (v_actor, p_action, p_target_type, p_target_id, p_payload)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_action(TEXT, TEXT, UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, TEXT, UUID, JSONB, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- review_merchant_verification — instrument the one existing SQL call site.
-- Same signature, so CREATE OR REPLACE applies without a DROP.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_merchant_verification(
  p_shop_id          uuid,
  p_decision         text,
  p_rejection_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_shop RECORD;
  v_reason TEXT := nullif(btrim(coalesce(p_rejection_reason, '')), '');
  v_approved BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may review merchant verification';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be either approved or rejected';
  END IF;

  v_approved := p_decision = 'approved';

  IF NOT v_approved AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT id, name, owner_id, verification_status
  INTO v_shop
  FROM public.shops
  WHERE id = p_shop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  IF v_shop.verification_status <> 'pending' THEN
    RAISE EXCEPTION 'This shop has already been reviewed (currently %)', v_shop.verification_status;
  END IF;

  UPDATE public.shops
  SET verification_status       = p_decision,
      is_active                 = v_approved,
      rejection_reason          = CASE WHEN v_approved THEN NULL ELSE v_reason END,
      verification_reviewed_by  = v_uid,
      verification_reviewed_at  = now()
  WHERE id = p_shop_id;

  INSERT INTO public.notifications (user_id, message, type, is_read, reference_id)
  VALUES (
    v_shop.owner_id,
    CASE
      WHEN v_approved THEN
        'Your shop "' || v_shop.name || '" has been verified and is now live on KithLy.'
      ELSE
        'Your shop "' || v_shop.name || '" could not be verified. Reason: ' || v_reason
    END,
    CASE WHEN v_approved THEN 'success' ELSE 'rejection' END,
    false,
    p_shop_id::text
  );

  PERFORM public.log_admin_action(
    'shop.verification_' || p_decision,
    'shop',
    p_shop_id,
    jsonb_build_object('reason', v_reason)
  );

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'verification_status', p_decision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_merchant_verification(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_merchant_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_merchant_verification(uuid, text, text) TO service_role;
