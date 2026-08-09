-- =============================================================================
-- confirm_payment_atomic must hold gateway evidence before it confirms
--
-- WHY
-- ---
-- 20260809000000 revoked EXECUTE from anon, which closes the hole today. That
-- is an administrative guarantee, not a structural one: the function still
-- confirms a payment purely on the strength of its arguments. Anything that
-- can reach it -- a future mis-grant, a leaked service key, a bug in an edge
-- function -- can still mark an unpaid transaction as paid, because nothing
-- inside it asks for proof that a gateway was ever involved.
--
-- After this migration a confirmation must carry a payload containing the
-- gateway's own charge id, and that id is recorded on the transaction.
--
-- WHY NO NEW PARAMETER
-- --------------------
-- The obvious shape is a required p_gateway_reference argument. It was tried
-- and rejected, for two reasons worth recording:
--
--   1. A parameter without a default must precede the defaulted ones, so the
--      signature changes. That produces a NEW pg_proc entry, which is created
--      with the PUBLIC default EXECUTE grant -- reintroducing, in the very
--      migration meant to harden it, the exact defect 20260809000000 fixed.
--
--   2. sweep_hanging_payments calls this function POSITIONALLY with five
--      arguments, so it would have to move too. That function is 261 lines --
--      Vault secret retrieval, a two-hour harvest window, timeout and
--      JSON-parse guards, and an entire second phase. CREATE OR REPLACE has no
--      partial form, so touching its signature means retyping all of it, and
--      its call site sits inside an `EXCEPTION WHEN others` block that only
--      RAISEs a WARNING. A transcription slip there would not fail loudly; the
--      sweep would simply stop working, silently.
--
-- Deriving the reference from p_payload avoids both. It is also stronger
-- evidence: the id has to appear in the gateway's own response body, rather
-- than being a string the caller chose. All three callers already pass it --
-- flutterwave-webhook passes rawBody, verify-payment passes the stringified
-- verify response, sweep_hanging_payments passes v_response_body -- and all
-- three shapes carry the charge id at `data.id`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Somewhere to record the evidence.
--
--    Nullable: transactions confirmed before this migration have no reference
--    and cannot acquire one retroactively. NOT NULL would either fail on those
--    rows or force a fabricated backfill, and a fabricated gateway reference is
--    worse than an absent one -- it would make the forensic query below lie.
--
--    Deliberately not UNIQUE: Flutterwave reuses a charge id across retries of
--    the same payment, so a unique index would turn a legitimate retry into a
--    hard failure. Duplicate suppression stays with payment_webhook_idempotency,
--    which is keyed for exactly that.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS gateway_reference TEXT;

COMMENT ON COLUMN public.transactions.gateway_reference IS
  'The gateway charge id this transaction was confirmed against, taken from the '
  'gateway response body rather than supplied by the caller. NULL for rows '
  'confirmed before 20260809010000, or never confirmed. A row at status SUCCESS '
  'with a NULL reference, created after that migration, is a confirmation that '
  'never saw a gateway.';

CREATE INDEX IF NOT EXISTS idx_transactions_gateway_reference
  ON public.transactions (gateway_reference)
  WHERE gateway_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The function.
--
--    Signature is byte-for-byte the one from 20260727050000, so this is a true
--    CREATE OR REPLACE: the existing ACL (service_role only, set by
--    20260809000000) carries over untouched and no new grant hazard is opened.
--
--    The body differs in exactly two places -- the evidence check at the top,
--    and gateway_reference on the UPDATE. Everything else is carried over
--    unchanged so the diff reads as what it is. The ZMW-only currency gate is
--    left exactly as found; it is reopened in Phase C, once the transaction
--    carries its own charge currency to validate against.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_transaction_id UUID,
  p_paid_amount NUMERIC,
  p_paid_currency TEXT,
  p_payload TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  SELECT transaction_id, total_amount, status, buyer_id
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

  IF p_paid_amount < v_txn.total_amount OR p_paid_currency <> 'ZMW' THEN
    RAISE EXCEPTION 'Payment amount or currency mismatch';
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
$$;

-- ---------------------------------------------------------------------------
-- 3. Restate the grants.
--
--    CREATE OR REPLACE preserves the ACL, so this is belt-and-braces rather
--    than a fix -- but stating it here means the guarantee survives even if
--    this file is ever replayed against a database where 20260809000000 has
--    not run.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Verify, or fail the migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_overloads INT;
BEGIN
  SELECT count(*) INTO v_overloads
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'confirm_payment_atomic';

  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 confirm_payment_atomic, found % -- signature drifted', v_overloads;
  END IF;

  IF has_function_privilege('anon', 'public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.confirm_payment_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'confirm_payment_atomic is still reachable by anon or authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'gateway_reference'
  ) THEN
    RAISE EXCEPTION 'transactions.gateway_reference was not created';
  END IF;

  RAISE NOTICE 'confirm_payment_atomic: gateway evidence required, reference recorded, service_role only';
END $$;
