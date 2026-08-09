-- =============================================================================
-- FX layers 2 and 4: record what was charged, and let the gate accept it
--
-- C2. transactions had no way to express a payment taken in anything but
-- kwacha. A GBP charge was literally unrecordable: no currency, no charged
-- amount, no rate, no link to the quote it was priced from.
--
-- C4. confirm_payment_atomic compared every payment against a hardcoded 'ZMW'
-- and rejected anything else. So an international order could be created and
-- paid, and the webhook would then refuse to confirm it -- the gateway takes
-- the money and the platform never releases the goods. That gate is the last
-- thing standing between the international wedge and working end to end.
--
-- The gate now validates against what the transaction itself records it was
-- charged. A domestic transaction has no charge_currency and keeps the original
-- ZMW comparison: the absence of a currency is not permission to accept any
-- currency, which is the failure mode a looser rewrite would have introduced.
--
-- The function body is otherwise carried over verbatim from the live definition
-- via pg_get_functiondef -- the SELECT gains two columns, the gate is replaced,
-- and nothing else moves. Retyping ~90 lines of payment confirmation to change
-- one condition is the trade that nearly destroyed sweep_hanging_payments
-- earlier in this series.
--
-- The signature is unchanged, so CREATE OR REPLACE preserves the
-- service_role-only ACL and no new grant hazard is opened.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Somewhere to record a non-kwacha charge.
--
--    All nullable. A domestic order has no charge currency and never will, and
--    every transaction that already exists predates this. NULL here means
--    "charged in ZMW at total_amount", which is exactly what the gate assumes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS charge_currency     TEXT,
  ADD COLUMN IF NOT EXISTS charge_amount_minor INTEGER,
  ADD COLUMN IF NOT EXISTS fx_rate_applied     NUMERIC,
  ADD COLUMN IF NOT EXISTS fx_quote_id         UUID REFERENCES public.fx_quotes(quote_id);

COMMENT ON COLUMN public.transactions.charge_currency IS
  'What the buyer was actually charged in. NULL for domestic orders, which are '
  'charged in ZMW at total_amount. Set only from a consumed fx_quote.';

COMMENT ON COLUMN public.transactions.charge_amount_minor IS
  'The charged amount in the charge currency minor unit -- pence, cents. This, '
  'not total_amount, is what the payment gateway is expected to report back.';

COMMENT ON COLUMN public.transactions.fx_quote_id IS
  'The quote this was priced from. Makes the charge reproducible: the quote '
  'carries the rate, the spread and fee as they stood, and the snapshot they '
  'were derived from.';

-- Both or neither. A currency without an amount is a transaction nobody can
-- confirm, and the gate refuses it rather than guessing.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_charge_currency_complete;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_charge_currency_complete
  CHECK (
    (charge_currency IS NULL AND charge_amount_minor IS NULL)
    OR (charge_currency IS NOT NULL AND charge_amount_minor IS NOT NULL AND charge_amount_minor > 0)
  );

CREATE INDEX IF NOT EXISTS transactions_fx_quote_idx
  ON public.transactions (fx_quote_id)
  WHERE fx_quote_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The gate, reopened.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(p_transaction_id uuid, p_paid_amount numeric, p_paid_currency text, p_payload text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_txn RECORD;
  v_orders_updated INTEGER;
  v_recipient TEXT;
  v_payload_json JSONB;
  v_gateway_reference TEXT;
BEGIN
  -- Gateway evidence, established before anything else.
  --
  -- Ahead of the idempotency short-circuit on purpose: a call that cannot
  -- evidence a gateway charge should be refused outright, not quietly told the
  -- payment was already processed.
  IF p_payload IS NULL OR btrim(p_payload) = '' THEN
    RAISE EXCEPTION 'A gateway response payload is required to confirm a payment';
  END IF;

  BEGIN
    v_payload_json := p_payload::JSONB;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Gateway payload is not valid JSON';
  END;

  -- `data.id` in every shape this is called with: the webhook's raw body, the
  -- verify endpoint's response, and the sweeper's harvested response all nest
  -- the charge id there. The top-level fallback covers a bare data object.
  v_gateway_reference := COALESCE(
    v_payload_json -> 'data' ->> 'id',
    v_payload_json ->> 'id'
  );

  IF v_gateway_reference IS NULL OR btrim(v_gateway_reference) = '' THEN
    RAISE EXCEPTION 'Gateway payload carries no charge id -- refusing to confirm';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.payment_webhook_idempotency WHERE idempotency_key = p_idempotency_key) THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true);
    END IF;
  END IF;

  SELECT transaction_id, total_amount, status, buyer_id,
         charge_currency, charge_amount_minor
  INTO v_txn
  FROM public.transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_txn.status = 'SUCCESS' THEN
    IF p_idempotency_key IS NOT NULL THEN
      INSERT INTO public.payment_webhook_idempotency (idempotency_key, transaction_id)
      VALUES (p_idempotency_key, p_transaction_id)
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN jsonb_build_object('success', true, 'already_confirmed', true);
  END IF;

  IF v_txn.status <> 'GATEWAY_PROCESSING' THEN
    RAISE EXCEPTION 'Transaction is in status %', v_txn.status;
  END IF;

  -- Validated against what THIS transaction was actually charged in, rather
  -- than against a hardcoded 'ZMW'.
  --
  -- The old gate rejected every non-ZMW payment outright, which is why an
  -- international order could be created but never confirmed: Flutterwave would
  -- take sterling and the webhook would then refuse it. A domestic order still
  -- has no charge currency, so it keeps the original ZMW comparison -- the
  -- absence of a currency is not permission to accept any currency.
  IF v_txn.charge_currency IS NULL THEN
    IF p_paid_amount < v_txn.total_amount OR p_paid_currency <> 'ZMW' THEN
      RAISE EXCEPTION 'Payment amount or currency mismatch';
    END IF;
  ELSE
    IF v_txn.charge_amount_minor IS NULL THEN
      RAISE EXCEPTION
        'Transaction % has a charge currency but no charge amount -- refusing to confirm',
        p_transaction_id;
    END IF;

    IF upper(p_paid_currency) <> upper(v_txn.charge_currency) THEN
      RAISE EXCEPTION 'Payment currency % does not match the charged currency %',
        upper(p_paid_currency), upper(v_txn.charge_currency);
    END IF;

    IF p_paid_amount < v_txn.charge_amount_minor THEN
      RAISE EXCEPTION 'Underpayment: % received against % charged in %',
        p_paid_amount, v_txn.charge_amount_minor, upper(v_txn.charge_currency);
    END IF;
  END IF;

  UPDATE public.transactions
  SET status = 'SUCCESS',
      gateway_reference = v_gateway_reference
  WHERE transaction_id = p_transaction_id;

  UPDATE public.shop_orders
  SET claim_status = 'PENDING'
  WHERE transaction_id = p_transaction_id
    AND claim_status = 'PENDING_PAYMENT';

  GET DIAGNOSTICS v_orders_updated = ROW_COUNT;

  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (p_transaction_id, 'WEBHOOK_RECEIVED', v_payload_json);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.payment_webhook_idempotency (idempotency_key, transaction_id)
    VALUES (p_idempotency_key, p_transaction_id);
  END IF;

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
-- 3. Grants restated, and verification.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT)
  TO service_role;

DO $verify$
DECLARE
  v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'confirm_payment_atomic';

  IF v_src NOT LIKE '%charge_currency%' THEN
    RAISE EXCEPTION 'confirm_payment_atomic still ignores charge_currency';
  END IF;

  -- The domestic path must stay pinned to ZMW. A rewrite that dropped this
  -- would quietly accept any currency for a local order.
  IF v_src NOT LIKE '%p_paid_currency <> ''ZMW''%' THEN
    RAISE EXCEPTION 'the domestic ZMW check was lost';
  END IF;

  -- The gateway-evidence requirement from 20260809010000 must also survive.
  IF v_src NOT LIKE '%no charge id%' THEN
    RAISE EXCEPTION 'the gateway evidence check was lost';
  END IF;

  IF has_function_privilege('anon', 'public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'confirm_payment_atomic is reachable by anon';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'charge_currency'
  ) THEN
    RAISE EXCEPTION 'transactions.charge_currency was not created';
  END IF;

  RAISE NOTICE 'charge currency recorded; gate validates against it, ZMW still pinned for domestic';
END $verify$;
