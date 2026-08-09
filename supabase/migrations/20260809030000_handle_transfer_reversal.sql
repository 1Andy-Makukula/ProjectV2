-- =============================================================================
-- A bounced payout must return to the merchant's balance
--
-- WHY
-- ---
-- flutterwave-webhook recognises exactly one event, `charge.completed`. When a
-- payout that already settled is later reversed by the provider, Flutterwave
-- sends `transfer.reversal` and the platform ignores it. The withdrawal stays
-- `paid` and the merchant's wallet stays debited -- while the money is sitting
-- back in KithLy's Flutterwave balance. The merchant is out the funds, the
-- ledger says they were paid, and nothing in the system disagrees.
--
-- DIRECTION OF FUNDS
-- ------------------
-- Worth stating plainly, because it is easy to get backwards. A withdrawal
-- debits the merchant's KithLy wallet up front (request_withdrawal_atomic), and
-- the transfer fulfils that existing debit. If the transfer bounces, the money
-- comes back to KithLy -- so the merchant must be CREDITED, restoring the
-- balance they had before requesting it, and left able to try again once their
-- payout details are fixed.
--
-- This can never drive a balance negative: it returns funds that were removed
-- for a payout that did not happen. The only path that legitimately goes below
-- zero is a buyer-side refund or chargeback clawback, which is a different
-- event, a different direction, and is deliberately NOT implemented here --
-- see the note at the bottom.
--
-- Same accounting as fail_withdrawal, from a different starting state:
-- fail_withdrawal handles a transfer that never left (`processing`/`pending`),
-- this handles one that left and came back (`paid`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. `reversed` is its own terminal state.
--
--    Not folded into `failed`. The two mean operationally different things and
--    call for different follow-up: a failed dispatch is often transient and
--    worth retrying as-is, while a reversal after settlement usually means the
--    destination details are wrong and a retry will bounce again. Collapsing
--    them would also make "how many payouts bounced after settling?"
--    unanswerable, which is exactly the figure that tells you a payout method
--    needs re-verifying.
-- ---------------------------------------------------------------------------
ALTER TABLE public.merchant_withdrawals
  DROP CONSTRAINT IF EXISTS merchant_withdrawals_status_check;

ALTER TABLE public.merchant_withdrawals
  ADD CONSTRAINT merchant_withdrawals_status_check
  CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'unverified', 'reversed'));

COMMENT ON COLUMN public.merchant_withdrawals.status IS
  'pending -> claimed as processing -> paid | failed. `unverified` means the '
  'transfer was dispatched but the outcome was never learned: the debit stands '
  'until resolved against the provider. `reversed` means it settled and the '
  'provider later returned the money: the merchant has been credited back and '
  'may withdraw again. Never reverse an unverified withdrawal blindly.';

CREATE INDEX IF NOT EXISTS merchant_withdrawals_provider_reference_idx
  ON public.merchant_withdrawals (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Idempotency for provider events that are not payments.
--
--    payment_webhook_idempotency cannot be reused: its transaction_id is NOT
--    NULL, and a transfer reversal has no transaction -- it concerns a payout,
--    which is the opposite direction. Widening that column would blur what the
--    table means, so payout-side events get their own key space.
--
--    Webhooks are retried. Without this, a redelivered reversal credits the
--    merchant twice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_event_idempotency (
  event_key   TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_event_idempotency ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.provider_event_idempotency IS
  'Seen provider events that are not payment confirmations -- payout reversals '
  'and similar. Payment confirmations use payment_webhook_idempotency, which is '
  'keyed to a transaction. Written only by service_role from webhook handlers.';

-- No policies: RLS on with none defined means no anon or authenticated access
-- at all. service_role bypasses RLS, which is the only access this needs.

-- ---------------------------------------------------------------------------
-- 3. Return a bounced payout to the merchant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_completed_withdrawal(
  p_withdrawal_id uuid,
  p_reason        text,
  p_event_key     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_merchant_user_id uuid;
  v_reason text := COALESCE(nullif(btrim(coalesce(p_reason, '')), ''), 'Payout reversed by provider');
BEGIN
  -- Checked before any state is read, so a redelivered webhook is a no-op
  -- rather than a second credit.
  IF p_event_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.provider_event_idempotency WHERE event_key = p_event_key) THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true);
    END IF;
  END IF;

  SELECT id, shop_id, amount, status INTO v_row
  FROM public.merchant_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  IF v_row.status = 'reversed' THEN
    IF p_event_key IS NOT NULL THEN
      INSERT INTO public.provider_event_idempotency (event_key, event_type)
      VALUES (p_event_key, 'transfer.reversal')
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN jsonb_build_object('success', true, 'already_reversed', true);
  END IF;

  -- Only a settled payout can bounce. Anything else reaching here means the
  -- reversal was matched to the wrong withdrawal, and crediting on that basis
  -- would invent money.
  IF v_row.status <> 'paid' THEN
    RAISE EXCEPTION 'Withdrawal is %, not paid -- refusing to reverse', v_row.status;
  END IF;

  v_merchant_user_id := public.resolve_shop_merchant_user_id(v_row.shop_id);
  IF v_merchant_user_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reverse withdrawal %: shop % has no assigned merchant to credit',
      p_withdrawal_id, v_row.shop_id;
  END IF;

  UPDATE public.merchant_withdrawals
  SET status = 'reversed',
      failure_reason = v_reason,
      processed_at = now(),
      updated_at = now()
  WHERE id = p_withdrawal_id;

  -- The money came back to KithLy, so it goes back to the merchant. Strictly a
  -- credit: this restores what the withdrawal removed and cannot go negative.
  PERFORM public.increment_wallet_balance(
    v_merchant_user_id, v_row.amount, 'WITHDRAWAL_REVERSED:' || p_withdrawal_id::text, NULL);

  INSERT INTO public.payout_ledger
    (shop_id, credit_amount, ledger_type, reference, status, amount)
  VALUES
    (v_row.shop_id, v_row.amount, 'WITHDRAWAL_REVERSED', p_withdrawal_id::text, 'reversed', v_row.amount);

  -- Told, not left to discover. A merchant whose payout bounced will otherwise
  -- see money reappear with no explanation and assume it failed to send.
  PERFORM public.create_notification(
    v_merchant_user_id,
    'Your payout could not be completed and has been returned to your KithLy '
      || 'balance. Please check your payout details before withdrawing again.',
    'warning',
    p_withdrawal_id::text);

  IF p_event_key IS NOT NULL THEN
    INSERT INTO public.provider_event_idempotency (event_key, event_type)
    VALUES (p_event_key, 'transfer.reversal');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'credited_amount', v_row.amount
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants. Money-state function: service_role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reverse_completed_withdrawal(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_completed_withdrawal(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Verify, or fail the migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reverse_completed_withdrawal'
  ) THEN
    RAISE EXCEPTION 'reverse_completed_withdrawal was not created';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reverse_completed_withdrawal'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'reverse_completed_withdrawal is reachable by anon or authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'provider_event_idempotency'
  ) THEN
    RAISE EXCEPTION 'provider_event_idempotency was not created';
  END IF;

  RAISE NOTICE 'transfer.reversal handling ready: credits merchant back, idempotent, service_role only';
END $$;

-- =============================================================================
-- NOT IMPLEMENTED HERE: refund.completed
--
-- A buyer-side refund or chargeback is the opposite direction -- money leaves
-- KithLy, so a merchant already settled for that order has to be clawed back,
-- and that clawback CAN drive a balance negative. Agreed behaviour is to allow
-- it: the ledger must stay mathematically truthful, and a negative balance
-- correctly blocks further withdrawals until sales offset it.
--
-- It is not built here because the accounting is not a webhook handler. It has
-- to decide what happens when the order was already redeemed and the goods are
-- gone, whether a partial refund maps to specific order_items, whether the
-- platform fee is returned, and what a merchant with a negative balance can
-- still do. increment_wallet_balance cannot even express it -- it returns early
-- on any amount <= 0, so a debit needs a different function with its own
-- floor-checking semantics.
--
-- Building that from a webhook payload alone would be guessing. The event is
-- recorded by the handler so nothing is lost, and it wants its own design pass.
-- =============================================================================
