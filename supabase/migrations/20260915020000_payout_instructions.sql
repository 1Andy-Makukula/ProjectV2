-- =============================================================================
-- The payout queue, and the rail health that gates it
--
-- WHY A QUEUE AND NOT A DIRECT CALL
-- ---------------------------------
-- §6.5: every money movement is a single database transaction, and external
-- calls happen AFTER commit. A redemption that called Airtel inline would hold
-- a row lock across a network request to a third party, and -- far worse -- a
-- timeout would leave the platform unable to say whether the money went. There
-- is no state in this design where liability decreased but payable was not
-- created, because the payable and the instruction to pay are written in the
-- same transaction as the redemption, and the network call reads the
-- instruction afterwards.
--
-- The ledger is the record of intent. The queue is the record of attempts.
--
-- WHY THE DESTINATION IS SNAPSHOTTED
-- ----------------------------------
-- `destination_id` is a foreign key AND the rail/number/name are copied in.
-- That looks redundant until a merchant changes their number between the scan
-- and the payout: the instruction must pay where it was addressed when it was
-- created, and the audit trail must show the digits that were actually used,
-- not the digits currently on file.
--
-- WHY FAILURE DOES NOT REVERSE THE REDEMPTION
-- -------------------------------------------
-- §6.2. The goods are already over the counter. Reversing the redemption would
-- take back a debt KithLy genuinely owes, leaving the merchant having given
-- away stock for nothing. So a failed payout leaves MERCHANT_PAYABLE open --
-- visible to the merchant as money owed -- and retries. The only thing that
-- closes it is money actually arriving.
--
-- BLAST RADIUS: additive. Nothing enqueues yet; 20260915040000 does.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rail health (§6.4)
--
-- Collection and payout fail independently, and the correct response differs:
-- a dead payout rail must block new REDEMPTIONS (never let a scan succeed that
-- cannot pay out), while a dead collection rail blocks new FUNDING but leaves
-- existing vouchers redeemable. One table, because "is this rail up" is one
-- question asked about several rails.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_rails (
  rail                 text PRIMARY KEY,
  kind                 text NOT NULL,
  is_available         boolean NOT NULL DEFAULT true,

  -- Set by an operator. Survives automatic recovery: if a human turned a rail
  -- off, a run of successes must not turn it back on behind their back.
  manually_disabled    boolean NOT NULL DEFAULT false,
  disabled_reason      text,
  disabled_at          timestamptz,

  consecutive_failures integer NOT NULL DEFAULT 0,
  failure_threshold    integer NOT NULL DEFAULT 5,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_error           text,
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_rails_kind_check CHECK (kind IN ('collection', 'payout'))
);

INSERT INTO public.payment_rails (rail, kind) VALUES
  ('airtel_money', 'payout'),
  ('bank',         'payout'),
  ('flutterwave',  'collection')
ON CONFLICT (rail) DO NOTHING;

ALTER TABLE public.payment_rails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_rails_admin_read ON public.payment_rails;
CREATE POLICY payment_rails_admin_read ON public.payment_rails
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.rail_is_available(p_rail text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- An unknown rail is unavailable. Defaulting to "up" for a rail nobody
  -- registered would let a typo in a destination row wave money through to a
  -- provider that does not exist.
  SELECT COALESCE(
    (SELECT is_available AND NOT manually_disabled
     FROM public.payment_rails WHERE rail = p_rail),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.record_rail_outcome(
  p_rail    text,
  p_success boolean,
  p_error   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF p_success THEN
    UPDATE public.payment_rails
    SET consecutive_failures = 0,
        -- Recovery is automatic, but never overrides a human's decision.
        is_available    = CASE WHEN manually_disabled THEN is_available ELSE true END,
        disabled_reason = CASE WHEN manually_disabled THEN disabled_reason ELSE NULL END,
        disabled_at     = CASE WHEN manually_disabled THEN disabled_at ELSE NULL END,
        last_success_at = now(),
        updated_at      = now()
    WHERE rail = p_rail;
    RETURN;
  END IF;

  UPDATE public.payment_rails
  SET consecutive_failures = consecutive_failures + 1,
      last_failure_at      = now(),
      last_error           = p_error,
      is_available         = (consecutive_failures + 1) < failure_threshold,
      disabled_reason      = CASE
        WHEN (consecutive_failures + 1) >= failure_threshold
          THEN 'Automatic: ' || (consecutive_failures + 1)::text || ' consecutive failures'
        ELSE disabled_reason END,
      disabled_at          = CASE
        WHEN (consecutive_failures + 1) >= failure_threshold AND is_available
          THEN now() ELSE disabled_at END,
      updated_at           = now()
  WHERE rail = p_rail
  RETURNING * INTO v_row;

  IF FOUND AND NOT v_row.is_available THEN
    INSERT INTO public.transaction_events (event_type, payload)
    VALUES ('PAYMENT_RAIL_DOWN', jsonb_build_object(
      'rail', p_rail, 'kind', v_row.kind,
      'consecutive_failures', v_row.consecutive_failures, 'error', p_error
    ));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Retry budget
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS payout_max_attempts integer NOT NULL DEFAULT 6;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_payout_attempts_check'
  ) THEN
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_payout_attempts_check
      CHECK (payout_max_attempts BETWEEN 1 AND 20);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The instructions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_instructions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            uuid NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
  shop_order_id      uuid REFERENCES public.shop_orders(shop_order_id) ON DELETE SET NULL,
  order_item_id      uuid,

  destination_id     uuid NOT NULL REFERENCES public.merchant_payout_destinations(id) ON DELETE RESTRICT,
  -- Snapshot of the destination as addressed. See the header.
  rail               text NOT NULL,
  account_identifier text NOT NULL,
  account_name       text,

  amount_ngwee       bigint NOT NULL,

  status             text NOT NULL DEFAULT 'SCHEDULED',

  -- Tier-driven. §5: instant for established merchants means release_at = now().
  release_at         timestamptz NOT NULL DEFAULT now(),

  claimed_at         timestamptz,
  sent_at            timestamptz,
  settled_at         timestamptz,
  failed_at          timestamptz,

  attempt_count      integer NOT NULL DEFAULT 0,
  last_error         text,

  -- The rail's own id. Airtel returns `airtel_money_id`; it is the only thing
  -- that lets a support conversation reach a specific transfer.
  external_ref       text,

  -- Sent to the rail so a retry after an ambiguous timeout cannot double-pay.
  idempotency_key    text NOT NULL UNIQUE,

  -- The MERCHANT_PAYABLE -> CLIENT_FUNDS pair, written only on success.
  ledger_pair_id     uuid,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payout_instructions_amount_check CHECK (amount_ngwee > 0),
  CONSTRAINT payout_instructions_status_check CHECK (
    status IN (
      'SCHEDULED',  -- waiting for release_at
      'CLAIMED',    -- a dispatcher run owns it
      'SENT',       -- handed to the rail, outcome not yet confirmed
      'SETTLED',    -- money arrived; ledger pair written
      'FAILED',     -- attempt failed, will retry
      'ABANDONED'   -- retry budget exhausted; ops owns it now
    )
  ),
  CONSTRAINT payout_instructions_settled_check
    CHECK (status <> 'SETTLED' OR (settled_at IS NOT NULL AND ledger_pair_id IS NOT NULL))
);

-- The dispatcher reads exactly this predicate.
CREATE INDEX IF NOT EXISTS payout_instructions_due_idx
  ON public.payout_instructions (release_at)
  WHERE status IN ('SCHEDULED', 'FAILED');

CREATE INDEX IF NOT EXISTS payout_instructions_shop_idx
  ON public.payout_instructions (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payout_instructions_open_idx
  ON public.payout_instructions (shop_id)
  WHERE status <> 'SETTLED';

COMMENT ON TABLE public.payout_instructions IS
  'Queue of merchant payouts. The ledger records intent; this records attempts. '
  'A row reaching SETTLED is the only thing that closes a MERCHANT_PAYABLE.';

ALTER TABLE public.payout_instructions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_instructions_select ON public.payout_instructions;
CREATE POLICY payout_instructions_select ON public.payout_instructions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = payout_instructions.shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 4. enqueue_payout
--
-- Called inside the redemption transaction. Does no network I/O and takes no
-- locks outside its own row, so it cannot be the reason a scan is slow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_payout(
  p_shop_id         uuid,
  p_amount_ngwee    bigint,
  p_idempotency_key text,
  p_shop_order_id   uuid DEFAULT NULL,
  p_order_item_id   uuid DEFAULT NULL,
  p_release_at      timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dest RECORD;
  v_id   uuid;
BEGIN
  IF p_amount_ngwee IS NULL OR p_amount_ngwee <= 0 THEN
    RAISE EXCEPTION 'enqueue_payout: amount must be positive, got %', p_amount_ngwee;
  END IF;

  -- A repeat of the same logical payout returns the existing instruction. This
  -- is what makes the redemption RPC safe to retry.
  SELECT id INTO v_id FROM public.payout_instructions
  WHERE idempotency_key = p_idempotency_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT id, rail, account_identifier, account_name, verification_status
  INTO v_dest
  FROM public.merchant_payout_destinations
  WHERE shop_id = p_shop_id AND is_active;

  -- Belt and braces. The redemption path already refused unverified shops;
  -- this refuses again at the point of instruction, because the cost of being
  -- wrong here is money sent to an unproven number.
  IF NOT FOUND OR v_dest.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'enqueue_payout: shop % has no verified payout destination', p_shop_id;
  END IF;

  INSERT INTO public.payout_instructions (
    shop_id, shop_order_id, order_item_id, destination_id,
    rail, account_identifier, account_name,
    amount_ngwee, release_at, idempotency_key
  )
  VALUES (
    p_shop_id, p_shop_order_id, p_order_item_id, v_dest.id,
    v_dest.rail, v_dest.account_identifier, COALESCE(v_dest.account_name, ''),
    p_amount_ngwee, COALESCE(p_release_at, now()), p_idempotency_key
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. claim_due_payouts
--
-- SKIP LOCKED so two overlapping dispatcher runs cannot wire the same money --
-- the same reason `claim_withdrawal_batch` uses it, and the same consequence
-- if it is dropped.
--
-- Claims only what the rail can actually take: a payout addressed to a rail
-- that is down stays SCHEDULED rather than burning retry budget against a
-- provider that is not answering.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_payouts(p_limit integer DEFAULT 25)
RETURNS TABLE (
  id                 uuid,
  shop_id            uuid,
  shop_order_id      uuid,
  rail               text,
  account_identifier text,
  account_name       text,
  amount_ngwee       bigint,
  idempotency_key    text,
  attempt_count      integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT p.id
    FROM public.payout_instructions p
    JOIN public.payment_rails r ON r.rail = p.rail
    WHERE p.status IN ('SCHEDULED', 'FAILED')
      AND p.release_at <= now()
      AND r.is_available
      AND NOT r.manually_disabled
    ORDER BY p.release_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE OF p SKIP LOCKED
  )
  UPDATE public.payout_instructions p
  SET status        = 'CLAIMED',
      claimed_at    = now(),
      attempt_count = p.attempt_count + 1
  FROM due
  WHERE p.id = due.id
  RETURNING p.id, p.shop_id, p.shop_order_id, p.rail, p.account_identifier,
            p.account_name, p.amount_ngwee, p.idempotency_key, p.attempt_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. mark_payout_sent
--
-- Between handing an instruction to the rail and hearing back, the row is
-- SENT. That state exists so a dispatcher that crashes mid-flight leaves
-- evidence that money may be in motion -- a row stuck in SENT is an alert, and
-- an automatic retry of it would be a double payment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_payout_sent(
  p_instruction_id uuid,
  p_external_ref   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.payout_instructions
  SET status = 'SENT', sent_at = now(), external_ref = COALESCE(p_external_ref, external_ref)
  WHERE id = p_instruction_id AND status = 'CLAIMED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_payout_sent: instruction % is not CLAIMED', p_instruction_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. complete_payout — §4.3.2
--
-- The only place a MERCHANT_PAYABLE is closed. Writes the ledger pair and
-- stamps the rail's reference on it, so the ledger row and the provider's
-- record point at each other.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_payout(
  p_instruction_id uuid,
  p_external_ref   text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row  RECORD;
  v_pair uuid;
BEGIN
  SELECT * INTO v_row
  FROM public.payout_instructions
  WHERE id = p_instruction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_payout: no instruction %', p_instruction_id;
  END IF;

  -- Already settled: return what happened before rather than paying twice.
  IF v_row.status = 'SETTLED' THEN
    RETURN jsonb_build_object(
      'instruction_id', p_instruction_id, 'status', 'SETTLED',
      'ledger_pair_id', v_row.ledger_pair_id, 'already_settled', true
    );
  END IF;

  IF v_row.status NOT IN ('CLAIMED', 'SENT') THEN
    RAISE EXCEPTION 'complete_payout: instruction % is %, not in flight',
      p_instruction_id, v_row.status;
  END IF;

  v_pair := public.post_ledger_pair(
    'MERCHANT_PAYABLE', v_row.shop_id,
    'CLIENT_FUNDS',     NULL,
    v_row.amount_ngwee,
    'PAYOUT',
    NULL, v_row.shop_order_id, v_row.order_item_id,
    p_external_ref,
    'payout:' || v_row.idempotency_key
  );

  UPDATE public.payout_instructions
  SET status = 'SETTLED', settled_at = now(),
      external_ref = COALESCE(p_external_ref, external_ref),
      ledger_pair_id = v_pair, last_error = NULL
  WHERE id = p_instruction_id;

  PERFORM public.record_rail_outcome(v_row.rail, true, NULL);

  INSERT INTO public.transaction_events (shop_order_id, event_type, payload)
  VALUES (v_row.shop_order_id, 'PAYOUT_SETTLED', jsonb_build_object(
    'instruction_id', p_instruction_id, 'shop_id', v_row.shop_id,
    'amount_ngwee', v_row.amount_ngwee, 'rail', v_row.rail,
    'external_ref', p_external_ref, 'ledger_pair_id', v_pair
  ));

  RETURN jsonb_build_object(
    'instruction_id', p_instruction_id, 'status', 'SETTLED',
    'ledger_pair_id', v_pair, 'already_settled', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. fail_payout — §6.2
--
-- No ledger movement. The payable stays open because the debt is still real.
-- Backoff is exponential and capped; when the budget runs out the row goes to
-- ABANDONED, which is a human's problem by design -- an automatic system that
-- keeps retrying a payout to a number that does not exist will do so forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_payout(
  p_instruction_id uuid,
  p_error          text,
  p_retryable      boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row      RECORD;
  v_max      integer;
  v_backoff  interval;
  v_status   text;
  v_owner    uuid;
BEGIN
  SELECT * INTO v_row FROM public.payout_instructions
  WHERE id = p_instruction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fail_payout: no instruction %', p_instruction_id;
  END IF;

  IF v_row.status = 'SETTLED' THEN
    RAISE EXCEPTION 'fail_payout: instruction % already settled', p_instruction_id;
  END IF;

  SELECT COALESCE(payout_max_attempts, 6) INTO v_max
  FROM public.platform_settings WHERE id = 1;
  v_max := COALESCE(v_max, 6);

  IF NOT p_retryable OR v_row.attempt_count >= v_max THEN
    v_status := 'ABANDONED';
    v_backoff := interval '0';
  ELSE
    v_status := 'FAILED';
    -- 1, 2, 4, 8... minutes, capped at an hour. Capped because an uncapped
    -- doubling puts the fifteenth retry a fortnight out, by which time the
    -- merchant has given up on us anyway.
    v_backoff := LEAST(
      make_interval(mins => (2 ^ LEAST(v_row.attempt_count, 10))::integer),
      interval '1 hour'
    );
  END IF;

  UPDATE public.payout_instructions
  SET status     = v_status,
      failed_at  = now(),
      last_error = p_error,
      release_at = now() + v_backoff
  WHERE id = p_instruction_id;

  PERFORM public.record_rail_outcome(v_row.rail, false, p_error);

  INSERT INTO public.transaction_events (shop_order_id, event_type, payload)
  VALUES (v_row.shop_order_id, 'PAYOUT_FAILED', jsonb_build_object(
    'instruction_id', p_instruction_id, 'shop_id', v_row.shop_id,
    'amount_ngwee', v_row.amount_ngwee, 'rail', v_row.rail,
    'attempt', v_row.attempt_count, 'status', v_status, 'error', p_error
  ));

  IF v_status = 'ABANDONED' THEN
    SELECT owner_id INTO v_owner FROM public.shops WHERE id = v_row.shop_id;
    IF v_owner IS NOT NULL THEN
      PERFORM public.create_notification(
        v_owner,
        'We could not pay out ' || to_char(v_row.amount_ngwee / 100.0, 'FM999G999D00')
          || ' ZMW. The money is still owed to you and is safe. Please check your payout details so we can send it.',
        'error',
        v_row.shop_id::text
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'instruction_id', p_instruction_id, 'status', v_status,
    'attempt', v_row.attempt_count, 'next_attempt_at', now() + v_backoff
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. What a merchant is owed right now
--
-- §6.2 requires the debt to be visible to the merchant, not merely recorded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merchant_payout_summary(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owed      bigint;
  v_scheduled bigint;
  v_in_flight bigint;
  v_stuck     bigint;
  v_paid_30d  bigint;
BEGIN
  v_owed := public.ledger_account_balance('MERCHANT_PAYABLE', p_shop_id);

  SELECT
    COALESCE(SUM(amount_ngwee) FILTER (WHERE status IN ('SCHEDULED', 'FAILED')), 0),
    COALESCE(SUM(amount_ngwee) FILTER (WHERE status IN ('CLAIMED', 'SENT')), 0),
    COALESCE(SUM(amount_ngwee) FILTER (WHERE status = 'ABANDONED'), 0)
  INTO v_scheduled, v_in_flight, v_stuck
  FROM public.payout_instructions
  WHERE shop_id = p_shop_id;

  SELECT COALESCE(SUM(amount_ngwee), 0) INTO v_paid_30d
  FROM public.payout_instructions
  WHERE shop_id = p_shop_id AND status = 'SETTLED' AND settled_at > now() - interval '30 days';

  RETURN jsonb_build_object(
    'owed_ngwee',            v_owed,
    'scheduled_ngwee',       v_scheduled,
    'in_flight_ngwee',       v_in_flight,
    'needs_attention_ngwee', v_stuck,
    'paid_last_30_days_ngwee', v_paid_30d,
    'next_payout_at', (
      SELECT MIN(release_at) FROM public.payout_instructions
      WHERE shop_id = p_shop_id AND status IN ('SCHEDULED', 'FAILED')
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rail_is_available(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_rail_outcome(text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_payout(uuid, bigint, text, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_payouts(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_payout_sent(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_payout(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_payout(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_payout_summary(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rail_is_available(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_rail_outcome(text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_payout(uuid, bigint, text, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_payouts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payout_sent(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_payout(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_payout(uuid, text, boolean) TO service_role;

-- The merchant sees what they are owed. Same reasoning as the payable balance
-- in 20260915000000: a debt the creditor cannot see is not really recorded.
GRANT EXECUTE ON FUNCTION public.merchant_payout_summary(uuid) TO service_role, authenticated;

GRANT SELECT ON public.payout_instructions TO authenticated;
