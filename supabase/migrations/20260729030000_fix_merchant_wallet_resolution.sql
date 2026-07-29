-- =============================================================================
-- Fix: merchant wallet credit/debit resolves the wrong person
--
-- increment_merchant_balance, request_withdrawal_atomic, fail_withdrawal and
-- complete_withdrawal all resolved "the merchant" for a shop via
-- shops.owner_id. Everywhere else in the codebase -- the request-withdrawal
-- Edge Function's authorization check, the merchant dashboard's "my shop"
-- lookup, every RLS policy on shop_orders/payout_ledger/merchant_withdrawals
-- -- resolves it via merchant_shops instead.
--
-- Those two can disagree, and when they do, real money moves to the wrong
-- wallet. useAdminShopForm.ts's saveShop() sets owner_id to whichever user
-- submitted the form, unconditionally, on both shop creation AND every
-- subsequent edit -- and that hook is shared by the admin shop-edit screen.
-- So the moment an admin ever edits a shop for any reason (fixing a typo,
-- confirming KYC info, anything), that shop's owner_id silently becomes the
-- admin's own user id. From then on: settlement credits and withdrawal
-- debits/reversals move to the admin's wallet, while the actual merchant --
-- still correctly authorized via merchant_shops everywhere else -- keeps
-- requesting withdrawals none the wiser. create-merchant never set owner_id
-- at all, so shops staffed through that path never had a correct one from
-- day one either.
--
-- This is not a one-off wrong-owner bug: it is two different tables used as
-- two different sources of truth for the same fact ("who is the merchant for
-- this shop"), and they were always going to drift. The fix centralizes
-- resolution into one function so credit and debit can never disagree again,
-- mirroring a pattern that already exists in this codebase --
-- atomic_fulfill_voucher (20260525130000_v2_atomic_money_rpcs.sql) already
-- resolves the merchant via
-- `(SELECT ms.user_id FROM merchant_shops ms WHERE ms.shop_id = p_shop_id LIMIT 1)`
-- for the same reason. This adds a deterministic ORDER BY and gives every
-- money-moving function the same single source of truth.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_shop_merchant_user_id(p_shop_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT user_id FROM public.merchant_shops
  WHERE shop_id = p_shop_id
  ORDER BY created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_shop_merchant_user_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_shop_merchant_user_id(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 1. increment_merchant_balance — settlement credit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_merchant_balance(
  target_shop_id UUID,
  amount_to_add INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_user_id UUID;
BEGIN
  v_merchant_user_id := public.resolve_shop_merchant_user_id(target_shop_id);
  IF v_merchant_user_id IS NULL THEN
    RAISE EXCEPTION 'Shop has no assigned merchant';
  END IF;
  PERFORM public.increment_wallet_balance(v_merchant_user_id, amount_to_add);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_merchant_balance(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_merchant_balance(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. request_withdrawal_atomic — withdrawal debit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal_atomic(
  target_shop_id UUID,
  withdrawal_amount INTEGER
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_merchant_user_id UUID;
  v_wallet_id UUID;
  v_balance INTEGER;
  v_ledger_id UUID := gen_random_uuid();
  v_withdrawal_id UUID;
BEGIN
  IF withdrawal_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;

  v_merchant_user_id := public.resolve_shop_merchant_user_id(target_shop_id);
  IF v_merchant_user_id IS NULL THEN
    RAISE EXCEPTION 'Shop has no assigned merchant';
  END IF;

  SELECT id, balance INTO v_wallet_id, v_balance
  FROM public.kithly_wallets WHERE user_id = v_merchant_user_id FOR UPDATE;

  IF v_wallet_id IS NULL OR v_balance < withdrawal_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- The debit happens now. Everything downstream is fulfilling it.
  INSERT INTO public.wallet_ledger (wallet_id, amount, description)
  VALUES (v_wallet_id, -withdrawal_amount, 'WITHDRAWAL_REQUEST');

  INSERT INTO public.payout_ledger (id, shop_id, credit_amount, ledger_type, reference, status, amount)
  VALUES (v_ledger_id, target_shop_id, withdrawal_amount, 'WITHDRAWAL_REQUEST', 'withdrawal', 'pending', withdrawal_amount);

  INSERT INTO public.merchant_withdrawals (shop_id, ledger_id, amount, status, requested_by)
  VALUES (target_shop_id, v_ledger_id, withdrawal_amount, 'pending', auth.uid())
  RETURNING id INTO v_withdrawal_id;

  RETURN v_withdrawal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_withdrawal_atomic(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_withdrawal_atomic(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. complete_withdrawal — notification recipient only (no money at stake
--    here; the transfer already happened). Tolerant of a missing merchant:
--    a shop with nobody to notify shouldn't block marking the payout paid.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_withdrawal(
  p_withdrawal_id uuid,
  p_transfer_id   text DEFAULT NULL,
  p_reference     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_merchant_user_id uuid;
BEGIN
  SELECT id, shop_id, amount, status INTO v_row
  FROM public.merchant_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  IF v_row.status <> 'processing' THEN
    RAISE EXCEPTION 'Withdrawal is %, not processing', v_row.status;
  END IF;

  UPDATE public.merchant_withdrawals
  SET status = 'paid',
      provider_transfer_id = p_transfer_id,
      provider_reference = p_reference,
      processed_at = now(),
      updated_at = now()
  WHERE id = p_withdrawal_id;

  v_merchant_user_id := public.resolve_shop_merchant_user_id(v_row.shop_id);

  IF v_merchant_user_id IS NOT NULL THEN
    PERFORM public.create_notification(
      v_merchant_user_id,
      'Your withdrawal of ZMW ' || to_char(v_row.amount / 100.0, 'FM999999990.00')
        || ' has been sent to your registered payout account.',
      'success',
      p_withdrawal_id::text);
  END IF;

  RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. fail_withdrawal — reversal credit. Unlike complete_withdrawal, this one
--    moves real money back and must NOT tolerate a missing merchant: raising
--    here rolls back the whole transaction (including the status='failed'
--    update), leaving the withdrawal in its prior state rather than marking
--    it failed while the reversal has nowhere to go.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_withdrawal(
  p_withdrawal_id uuid,
  p_reason        text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_merchant_user_id uuid;
  v_reason text := COALESCE(nullif(btrim(coalesce(p_reason, '')), ''), 'Transfer failed');
BEGIN
  SELECT id, shop_id, amount, status INTO v_row
  FROM public.merchant_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  IF v_row.status NOT IN ('processing', 'pending') THEN
    RAISE EXCEPTION 'Withdrawal is % and cannot be failed', v_row.status;
  END IF;

  v_merchant_user_id := public.resolve_shop_merchant_user_id(v_row.shop_id);
  IF v_merchant_user_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reverse withdrawal %: shop % has no assigned merchant to credit',
      p_withdrawal_id, v_row.shop_id;
  END IF;

  UPDATE public.merchant_withdrawals
  SET status = 'failed',
      failure_reason = v_reason,
      processed_at = now(),
      updated_at = now()
  WHERE id = p_withdrawal_id;

  -- Return the funds to the balance they came from.
  PERFORM public.increment_wallet_balance(
    v_merchant_user_id, v_row.amount, 'WITHDRAWAL_REVERSED:' || p_withdrawal_id::text, NULL);

  INSERT INTO public.payout_ledger
    (shop_id, credit_amount, ledger_type, reference, status, amount)
  VALUES
    (v_row.shop_id, v_row.amount, 'WITHDRAWAL_REVERSED', p_withdrawal_id::text, 'reversed', v_row.amount);

  PERFORM public.create_notification(
    v_merchant_user_id,
    'Your withdrawal could not be completed and the amount has been returned to your balance. '
      || 'Reason: ' || v_reason,
    'warning',
    p_withdrawal_id::text);

  RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id, 'reversed', true);
END;
$$;

-- complete_withdrawal / fail_withdrawal signatures are unchanged from
-- 20260727070000_withdrawal_processing.sql, so CREATE OR REPLACE preserves
-- their existing grants -- no REVOKE/GRANT needed here.
