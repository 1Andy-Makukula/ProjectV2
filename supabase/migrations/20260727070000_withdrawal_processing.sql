-- =============================================================================
-- Merchant withdrawals — actually paying them out
--
-- Settlement credits a merchant's in-app wallet, and `request_withdrawal_atomic`
-- debits that wallet and writes a WITHDRAWAL_REQUEST row telling them "KithLy
-- will process it within 1-2 business days". Nothing ever processed those rows.
-- The money left the balance and stopped.
--
-- Meanwhile `batch-payout-sweeper` contains a working Flutterwave transfers
-- call, but it reads `shop_orders` where payout_status = 'PENDING_BATCH', and
-- nothing in the codebase has ever set that value. Two halves of a payout
-- system, neither connected to the other.
--
-- ---------------------------------------------------------------------------
-- Why this pays out against withdrawals rather than orders
-- ---------------------------------------------------------------------------
-- Wiring the sweeper to settlement instead would have paid merchants twice:
-- once into the withdrawable wallet balance at redemption, once into their bank
-- account. Paying against withdrawal requests cannot double-pay, because the
-- wallet debit already happened when the request was made — the transfer only
-- fulfils a debit that is already on the books.
--
-- It also sidesteps the sweeper's stale arithmetic. That code deducts 8% or 10%
-- from the merchant, which was the old model; the merchant now gives up 2% and
-- the buyer pays the rest. A withdrawal is simply the amount the merchant asked
-- for, with fees long since applied at settlement, so there is nothing to
-- recompute and nothing to get wrong.
--
-- ---------------------------------------------------------------------------
-- Why a separate table
-- ---------------------------------------------------------------------------
-- payout_ledger carries an immutability trigger — it is append-only, by design.
-- A withdrawal has a genuine state machine (pending, processing, paid, failed),
-- so that state lives here and references the immutable ledger entry rather
-- than trying to mutate it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.merchant_withdrawals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  ledger_id           uuid REFERENCES public.payout_ledger(id) ON DELETE SET NULL,
  amount              integer NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  requested_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  provider            text NOT NULL DEFAULT 'flutterwave',
  provider_reference  text,
  provider_transfer_id text,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,

  CONSTRAINT merchant_withdrawals_status_check
    CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  CONSTRAINT merchant_withdrawals_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS merchant_withdrawals_pending_idx
  ON public.merchant_withdrawals (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS merchant_withdrawals_shop_idx
  ON public.merchant_withdrawals (shop_id, created_at DESC);

ALTER TABLE public.merchant_withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchant_withdrawals_select ON public.merchant_withdrawals;
CREATE POLICY merchant_withdrawals_select ON public.merchant_withdrawals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = merchant_withdrawals.shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 1. Anything already requested and stranded joins the queue
-- ---------------------------------------------------------------------------
INSERT INTO public.merchant_withdrawals (shop_id, ledger_id, amount, status, created_at)
SELECT pl.shop_id, pl.id, COALESCE(pl.amount, pl.credit_amount), 'pending', pl.created_at
FROM public.payout_ledger pl
WHERE pl.ledger_type = 'WITHDRAWAL_REQUEST'
  AND COALESCE(pl.status, 'pending') = 'pending'
  AND COALESCE(pl.amount, pl.credit_amount) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.merchant_withdrawals mw WHERE mw.ledger_id = pl.id
  );

-- ---------------------------------------------------------------------------
-- 2. request_withdrawal_atomic — unchanged behaviour, now also queues the work
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal_atomic(
  target_shop_id UUID,
  withdrawal_amount INTEGER
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_wallet_id UUID;
  v_balance INTEGER;
  v_ledger_id UUID := gen_random_uuid();
  v_withdrawal_id UUID;
BEGIN
  IF withdrawal_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = target_shop_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  SELECT id, balance INTO v_wallet_id, v_balance
  FROM public.kithly_wallets WHERE user_id = v_owner_id FOR UPDATE;

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
-- 3. claim_withdrawal_batch — hands work to exactly one sweeper run
--
-- SKIP LOCKED means two overlapping invocations cannot claim the same row, so
-- a slow run and its successor can never both wire the same money.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_withdrawal_batch(p_limit integer DEFAULT 25)
RETURNS TABLE (
  withdrawal_id  uuid,
  shop_id        uuid,
  shop_name      text,
  amount         integer,
  payout_method  text,
  payout_details text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT mw.id
    FROM public.merchant_withdrawals mw
    WHERE mw.status = 'pending'
    ORDER BY mw.created_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  ),
  moved AS (
    UPDATE public.merchant_withdrawals mw
    SET status = 'processing', updated_at = now()
    FROM claimed c
    WHERE mw.id = c.id
    RETURNING mw.id, mw.shop_id, mw.amount
  )
  SELECT m.id, m.shop_id, s.name, m.amount, s.payout_method, s.payout_details::text
  FROM moved m
  JOIN public.shops s ON s.id = m.shop_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. complete_withdrawal
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
  v_owner_id uuid;
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

  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_row.shop_id;

  PERFORM public.create_notification(
    v_owner_id,
    'Your withdrawal of ZMW ' || to_char(v_row.amount / 100.0, 'FM999999990.00')
      || ' has been sent to your registered payout account.',
    'success',
    p_withdrawal_id::text);

  RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. fail_withdrawal — puts the money back
--
-- The wallet was debited when the request was made. If the transfer does not
-- happen, that debit has to be reversed or the merchant is simply out the
-- money with nothing to show for it.
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
  v_owner_id uuid;
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

  UPDATE public.merchant_withdrawals
  SET status = 'failed',
      failure_reason = v_reason,
      processed_at = now(),
      updated_at = now()
  WHERE id = p_withdrawal_id;

  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_row.shop_id;

  -- Return the funds to the balance they came from.
  PERFORM public.increment_wallet_balance(
    v_owner_id, v_row.amount, 'WITHDRAWAL_REVERSED:' || p_withdrawal_id::text, NULL);

  INSERT INTO public.payout_ledger
    (shop_id, credit_amount, ledger_type, reference, status, amount)
  VALUES
    (v_row.shop_id, v_row.amount, 'WITHDRAWAL_REVERSED', p_withdrawal_id::text, 'reversed', v_row.amount);

  PERFORM public.create_notification(
    v_owner_id,
    'Your withdrawal could not be completed and the amount has been returned to your balance. '
      || 'Reason: ' || v_reason,
    'warning',
    p_withdrawal_id::text);

  RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id, 'reversed', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — payout movement is service-role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.claim_withdrawal_batch(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_withdrawal(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_withdrawal(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_withdrawal_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_withdrawal(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_withdrawal(uuid, text) TO service_role;
