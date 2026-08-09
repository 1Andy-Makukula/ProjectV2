-- =============================================================================
-- convert_floating_item_to_credits must verify who is calling it
--
-- WHY
-- ---
-- The function is SECURITY DEFINER, was reachable by `anon`, and contained no
-- reference to auth.uid() at all. It takes p_user_id as an argument and trusts
-- it. Its only authorisation is that users.phone for the supplied id matches
-- shop_orders.recipient_phone -- a check on whether the *named* user is the
-- right recipient, not on whether the *caller* is that user.
--
-- So an unauthenticated caller holding an order_item_id and the recipient's
-- user id could convert someone else's FLOATING item. They could not steal:
-- the credits land in the rightful recipient's wallet, because the phone match
-- forces that. What they could do is force the conversion -- and FLOATING ->
-- CONVERTED is terminal. The recipient loses the ability to collect the actual
-- goods and is handed wallet credit instead, without ever asking for it.
--
-- Found while auditing the browser-callable SECURITY DEFINER functions after
-- 20260809000000. Of the nine privileged ones, this was the only one with no
-- auth.uid() check; the rest verify the caller and/or their role.
--
-- FIX
-- ---
-- Bind the argument to the session. p_user_id is kept rather than dropped in
-- favour of auth.uid() alone: the signature is in database.types.ts and called
-- from useCustomerDashboard, so changing it would ripple into generated types
-- for no security gain. It is now required to equal the caller. The frontend
-- already passes the session's own id (`user?.id || profile?.id`, no
-- impersonation path), so the legitimate call is unaffected.
--
-- The phone match is deliberately kept as well. It answers a different
-- question -- is this item actually addressed to this person -- and defends
-- against a logged-in user converting an item belonging to someone else.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.convert_floating_item_to_credits(
  p_item_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_allocated_price INTEGER;
  v_recipient_phone TEXT;
  v_user_phone TEXT;
  v_status TEXT;
  v_shop_order_id UUID;
BEGIN
  -- 0. The caller must be the user they claim to be acting as.
  --
  -- First statement in the function on purpose: nothing about someone else's
  -- order should be readable, let alone mutable, before this passes. An
  -- unauthenticated caller has auth.uid() = NULL and stops here.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Cannot convert an item on behalf of another user';
  END IF;

  -- 1. Get the order item details and verify it exists
  SELECT allocated_price, fulfillment_status, shop_order_id
  INTO v_allocated_price, v_status, v_shop_order_id
  FROM public.order_items
  WHERE order_item_id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found';
  END IF;

  -- 2. Verify the item is currently FLOATING
  IF v_status <> 'FLOATING' THEN
    RAISE EXCEPTION 'Item is not in FLOATING status (current status: %)', v_status;
  END IF;

  -- 3. Get the recipient's phone number from shop_orders
  SELECT recipient_phone
  INTO v_recipient_phone
  FROM public.shop_orders
  WHERE shop_order_id = v_shop_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated shop order not found';
  END IF;

  -- 4. Get the user's phone number from users table
  SELECT phone
  INTO v_user_phone
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- 5. Verify the item matches the user by comparing phone numbers
  IF COALESCE(v_recipient_phone, '') = '' OR COALESCE(v_user_phone, '') <> COALESCE(v_recipient_phone, '') THEN
    RAISE EXCEPTION 'User phone mismatch: recipient is %, user is %', v_recipient_phone, v_user_phone;
  END IF;

  -- 6. Update order_items status to CONVERTED
  UPDATE public.order_items
  SET fulfillment_status = 'CONVERTED',
      fulfilled_at = now()
  WHERE order_item_id = p_item_id;

  -- 7. Add the allocated_price to the user's wallet using existing increment_wallet_balance function
  PERFORM public.increment_wallet_balance(p_user_id, v_allocated_price, 'CONVERSION:' || p_item_id, v_shop_order_id);

  RETURN TRUE;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Take `anon` off the privileged browser-callable surface.
--
-- All nine of these require a session to do anything: they check auth.uid(),
-- current_user_role(), or both, so an anonymous call already failed. Holding
-- EXECUTE anyway is surface with no purpose -- it lets an unauthenticated
-- caller reach the inside of a SECURITY DEFINER function and learn from how it
-- fails, and it means any future edit that relaxes an internal check is
-- immediately exposed to the internet rather than to logged-in users.
--
-- `authenticated` is retained: the frontend calls all of these with a session.
-- Deliberately scoped to the privileged set. The remaining browser-callable
-- RPCs (get_transaction_status, generate_list_slug, can_rate_shop and the like)
-- are left alone -- some legitimately serve logged-out visitors, and sorting
-- that out belongs with the comprehensive privilege pass, where tests can catch
-- a wrong call.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn   TEXT;
  v_proc RECORD;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'convert_floating_item_to_credits',
    'admin_expire_order',
    'admin_force_fulfill_order',
    'admin_broadcast_notification',
    'admin_start_conversation',
    'review_merchant_verification',
    'log_admin_action',
    'set_experience_items',
    'register_merchant_shop'
  ] LOOP
    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_proc.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_proc.sig);
      RAISE NOTICE 'authenticated-only: %', v_proc.sig;
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Verify, or fail the migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad TEXT[] := '{}';
  v_leak RECORD;
BEGIN
  FOR v_leak IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'convert_floating_item_to_credits','admin_expire_order','admin_force_fulfill_order',
        'admin_broadcast_notification','admin_start_conversation','review_merchant_verification',
        'log_admin_action','set_experience_items','register_merchant_shop'
      ])
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    v_bad := array_append(v_bad, v_leak.sig);
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'Still reachable by anon: %', v_bad;
  END IF;

  -- The whole point of the change: prove the guard is actually in the body.
  IF (SELECT p.prosrc FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname = 'convert_floating_item_to_credits') NOT LIKE '%auth.uid()%'
  THEN
    RAISE EXCEPTION 'convert_floating_item_to_credits has no auth.uid() check';
  END IF;

  RAISE NOTICE 'floating conversion bound to the session; privileged RPCs are authenticated-only';
END $$;
