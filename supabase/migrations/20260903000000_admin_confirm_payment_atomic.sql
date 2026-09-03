-- =============================================================================
-- admin_confirm_payment_atomic: the manual recovery path stops being two
-- independent HTTP writes
--
-- WHY
-- ---
-- admin-confirm-payment promotes a stuck transaction to SUCCESS and releases
-- its child shop_orders from PENDING_PAYMENT. It did so as two separate
-- PostgREST calls from Deno:
--
--   UPDATE transactions SET status = 'SUCCESS'         ...  -- request 1
--   UPDATE shop_orders  SET claim_status = 'PENDING'   ...  -- request 2
--
-- There is no transaction spanning those two requests. If the isolate is
-- evicted, the function times out, or the network drops between them, the
-- parent is permanently SUCCESS while the children stay PENDING_PAYMENT.
--
-- That state does not self-heal, and the reason is specific: should
-- Flutterwave's webhook arrive afterwards, confirm_payment_atomic reads
-- status = 'SUCCESS', takes its already_confirmed branch, records the
-- idempotency key and returns -- without ever touching shop_orders. The
-- automatic rail is now permanently convinced the work is done. The buyer has
-- paid, the merchant is owed, and the voucher can never be collected. Recovery
-- is a hand-written UPDATE against production.
--
-- The automated rail has always done both writes in one ACID transaction. The
-- manual rail is the one an operator reaches for precisely when things have
-- already gone wrong, so it is the worse of the two places to have a torn
-- write.
--
-- WHAT THIS DOES
-- --------------
-- One SECURITY DEFINER function doing both updates plus the audit rows in a
-- single transaction. Deliberately a SEPARATE function from
-- confirm_payment_atomic rather than a flag on it: this path bypasses gateway
-- verification entirely, and the two must not be able to drift into each other.
-- confirm_payment_atomic's gateway-evidence requirement (20260809010000) is a
-- guarantee worth keeping un-bypassable.
--
-- The narrowness of the existing endpoint is preserved exactly: it still
-- refuses anything that is not GATEWAY_PROCESSING, and it still returns cleanly
-- when the transaction is already SUCCESS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_confirm_payment_atomic(
  p_transaction_id uuid,
  p_reason         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_txn            RECORD;
  v_orders_updated INTEGER;
  v_recipient      TEXT;
  v_admin          UUID := auth.uid();
BEGIN
  -- 1. The caller must be an admin.
  --
  -- Checked here as well as in the edge function. requireAdmin in the edge
  -- function is the only guard today, but this function is reachable by
  -- anything holding a session, and a SECURITY DEFINER function that moves an
  -- order out of escrow must not depend on a caller it cannot see having
  -- checked who it is.
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can manually confirm a payment';
  END IF;

  -- 2. Lock the transaction. FOR UPDATE, matching confirm_payment_atomic, so a
  --    webhook landing at the same instant serialises behind this rather than
  --    both deciding the status independently.
  SELECT transaction_id, status, buyer_id
  INTO v_txn
  FROM public.transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- 3. Already done is success, not an error -- an operator retrying a request
  --    whose response they never saw must not get a failure.
  IF v_txn.status = 'SUCCESS' THEN
    RETURN jsonb_build_object('success', true, 'already_confirmed', true);
  END IF;

  IF v_txn.status <> 'GATEWAY_PROCESSING' THEN
    RAISE EXCEPTION
      'Only transactions awaiting payment can be confirmed manually. This one is %',
      v_txn.status;
  END IF;

  -- 4. Both writes, same transaction. This is the entire point of the change.
  UPDATE public.transactions
  SET status = 'SUCCESS'
  WHERE transaction_id = p_transaction_id;

  UPDATE public.shop_orders
  SET claim_status = 'PENDING'
  WHERE transaction_id = p_transaction_id
    AND claim_status = 'PENDING_PAYMENT';

  GET DIAGNOSTICS v_orders_updated = ROW_COUNT;

  -- 5. Audit, inside the same transaction, so a confirmed payment can never
  --    exist without the record of who vouched for it.
  --
  --    gateway_reference is deliberately left NULL: no gateway charge was
  --    verified, and writing a placeholder would make a manual confirmation
  --    indistinguishable from a real one during reconciliation. The
  --    ADMIN_MANUAL_CONFIRM event is the evidence instead.
  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (
    p_transaction_id,
    'ADMIN_MANUAL_CONFIRM',
    jsonb_build_object(
      'admin_user_id',       v_admin,
      'reason',              p_reason,
      'confirmed_at',        now(),
      'shop_orders_updated', v_orders_updated,
      'gateway_verified',    false
    )
  );

  PERFORM public.log_admin_action(
    'ADMIN_MANUAL_CONFIRM_PAYMENT',
    'transaction',
    p_transaction_id,
    jsonb_build_object('reason', p_reason, 'shop_orders_updated', v_orders_updated),
    v_admin
  );

  SELECT recipient_name INTO v_recipient
  FROM public.shop_orders WHERE transaction_id = p_transaction_id LIMIT 1;

  PERFORM public.create_notification(
    v_txn.buyer_id,
    'Payment confirmed. '
      || COALESCE('Your gift for ' || v_recipient || ' is', 'Your gift is')
      || ' held safely in escrow and ready to collect.',
    'success',
    p_transaction_id::text);

  RETURN jsonb_build_object(
    'success', true,
    'shop_orders_updated', v_orders_updated
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- authenticated, not anon: the function checks current_user_role() itself, so
-- an anonymous caller already fails -- but per 20260809040000, holding EXECUTE
-- with no purpose is surface, and it is the thing that turns a future relaxed
-- internal check into an internet-facing hole rather than a logged-in-user one.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_confirm_payment_atomic(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_payment_atomic(uuid, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verify, or fail the migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_confirm_payment_atomic(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_confirm_payment_atomic is reachable by anon';
  END IF;

  IF (SELECT p.prosrc
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname = 'admin_confirm_payment_atomic') NOT LIKE '%current_user_role()%'
  THEN
    RAISE EXCEPTION 'admin_confirm_payment_atomic has no admin role check';
  END IF;

  RAISE NOTICE 'admin_confirm_payment_atomic created: manual confirmation is now a single transaction';
END $$;
