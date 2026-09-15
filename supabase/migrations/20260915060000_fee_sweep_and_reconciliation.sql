-- =============================================================================
-- Fee sweep and daily reconciliation
--
-- WHY RECONCILIATION IS THE MOST IMPORTANT THING HERE
-- ---------------------------------------------------
-- Everything else in this model is internal consistency, and internal
-- consistency is not correctness. A double-entry ledger with a bug in every
-- posting function still balances perfectly -- debits equal credits by
-- construction. It would tell us nothing about whether the money is actually
-- in the account.
--
-- Only the bank can tell us that. So the daily job asserts:
--
--     segregated_account_balance == open_sender_liabilities
--                                 + pending_merchant_payouts
--                                 + accrued_unswept_fees
--
-- with the left-hand side read from the bank and the right-hand side computed
-- from the ledger. Drift means money is missing, money is unaccounted for, or
-- a code path is writing entries that do not correspond to real movements. All
-- three are emergencies and all three are invisible without this check.
--
-- WHY THE SWEEP IS TWO-PHASE
-- --------------------------
-- The obvious implementation posts FEE_ACCRUED -> CLIENT_FUNDS and tells an
-- operator to move the money. That is backwards: between the posting and the
-- transfer, the ledger says the segregated account is lower than it really is,
-- and the reconciliation above -- which runs daily, and might run in that
-- window -- reports drift for a discrepancy that is purely our own bookkeeping
-- getting ahead of itself.
--
-- So a sweep is proposed with an amount, the transfer is made, and the pair is
-- posted when the transfer is confirmed with its bank reference. The ledger
-- only ever describes money that has actually moved.
--
-- WHY ONE SWEEP A DAY
-- -------------------
-- §4.4: one transfer per day means one number to reconcile. Sweeping per
-- redemption would put thousands of small transfers on the bank statement and
-- make the daily comparison a matching exercise rather than a subtraction.
--
-- BLAST RADIUS: additive. Nothing existing reads these tables.
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS reconciliation_tolerance_ngwee integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.platform_settings.reconciliation_tolerance_ngwee IS
  'Permitted drift before the daily reconciliation alerts. Defaults to zero '
  'deliberately: start strict and widen with a documented reason, never the '
  'other way round.';

-- ---------------------------------------------------------------------------
-- 1. Fee sweeps (§4.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_sweeps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_date      date NOT NULL,
  amount_ngwee    bigint NOT NULL,
  status          text NOT NULL DEFAULT 'PROPOSED',

  -- The bank's reference for the transfer out of the segregated account.
  bank_reference  text,
  ledger_pair_id  uuid,

  proposed_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  cancelled_at    timestamptz,
  cancelled_reason text,

  CONSTRAINT fee_sweeps_amount_check CHECK (amount_ngwee > 0),
  CONSTRAINT fee_sweeps_status_check CHECK (status IN ('PROPOSED', 'CONFIRMED', 'CANCELLED')),
  CONSTRAINT fee_sweeps_confirmed_check
    CHECK (status <> 'CONFIRMED' OR (confirmed_at IS NOT NULL AND ledger_pair_id IS NOT NULL))
);

-- One open sweep at a time. Two proposed sweeps would each claim the same
-- accrued balance and an operator could transfer it twice.
CREATE UNIQUE INDEX IF NOT EXISTS fee_sweeps_one_open_idx
  ON public.fee_sweeps ((status))
  WHERE status = 'PROPOSED';

CREATE UNIQUE INDEX IF NOT EXISTS fee_sweeps_one_per_day_idx
  ON public.fee_sweeps (sweep_date)
  WHERE status = 'CONFIRMED';

ALTER TABLE public.fee_sweeps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fee_sweeps_admin_read ON public.fee_sweeps;
CREATE POLICY fee_sweeps_admin_read ON public.fee_sweeps
  FOR SELECT TO authenticated USING (public.current_user_role() = 'admin');

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
-- 2. Reconciliation runs (§8)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of                    timestamptz NOT NULL DEFAULT now(),
  run_date                 date NOT NULL,

  -- Read from the bank. Nullable because a run can fail to reach the bank,
  -- and "we could not check" must be recorded as distinct from "it balanced".
  bank_balance_ngwee       bigint,

  ledger_client_funds_ngwee  bigint NOT NULL,
  sender_liabilities_ngwee   bigint NOT NULL,
  merchant_payables_ngwee    bigint NOT NULL,
  fees_accrued_ngwee         bigint NOT NULL,
  operating_ngwee            bigint NOT NULL DEFAULT 0,

  -- bank - (sender + merchant + fees). The number that must be zero.
  drift_ngwee              bigint,

  -- Structural: global debits minus global credits. Must always be zero; a
  -- non-zero value means a code path bypassed post_ledger_pair.
  internal_imbalance_ngwee bigint NOT NULL DEFAULT 0,

  status                   text NOT NULL,
  tolerance_ngwee          integer NOT NULL DEFAULT 0,
  movements                jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reconciliation_runs_status_check
    CHECK (status IN ('BALANCED', 'DRIFT', 'INTERNAL_IMBALANCE', 'BANK_UNAVAILABLE'))
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_date_idx
  ON public.reconciliation_runs (run_date DESC);

CREATE INDEX IF NOT EXISTS reconciliation_runs_unhealthy_idx
  ON public.reconciliation_runs (created_at DESC)
  WHERE status <> 'BALANCED';

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_runs_admin_read ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_admin_read ON public.reconciliation_runs
  FOR SELECT TO authenticated USING (public.current_user_role() = 'admin');

-- Immutable: a reconciliation result that can be edited is not a control.
DROP TRIGGER IF EXISTS enforce_immutable_reconciliation_runs ON public.reconciliation_runs;
CREATE TRIGGER enforce_immutable_reconciliation_runs
  BEFORE UPDATE OR DELETE ON public.reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

-- ---------------------------------------------------------------------------
-- 3. The daily job
--
-- `p_bank_balance_ngwee` comes from the caller, because reading a bank balance
-- is an authenticated HTTP call and Postgres is the wrong place for it. Pass
-- NULL when the bank could not be reached: the run still records the ledger
-- side and the internal check, and reports BANK_UNAVAILABLE rather than
-- silently skipping a day.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_reconcile(
  p_bank_balance_ngwee bigint DEFAULT NULL,
  p_as_of              timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_as_of     timestamptz := COALESCE(p_as_of, now());
  v_client    bigint;
  v_sender    bigint;
  v_merchant  bigint;
  v_fees      bigint;
  v_operating bigint;
  v_expected  bigint;
  v_drift     bigint;
  v_internal  bigint;
  v_tolerance integer;
  v_status    text;
  v_movements jsonb;
  v_id        uuid;
  v_admin     RECORD;
BEGIN
  SELECT COALESCE(reconciliation_tolerance_ngwee, 0) INTO v_tolerance
  FROM public.platform_settings WHERE id = 1;
  v_tolerance := COALESCE(v_tolerance, 0);

  v_client    := public.ledger_account_balance('CLIENT_FUNDS');
  v_sender    := public.ledger_account_balance('SENDER_LIABILITY');
  v_merchant  := public.ledger_account_balance('MERCHANT_PAYABLE');
  v_fees      := public.ledger_account_balance('FEE_ACCRUED');
  v_operating := public.ledger_account_balance('OPERATING');

  SELECT COALESCE(SUM(
    CASE WHEN direction = 'DEBIT' THEN amount_ngwee ELSE -amount_ngwee END
  ), 0) INTO v_internal
  FROM public.ledger_entries;

  v_expected := v_sender + v_merchant + v_fees - v_operating;

  -- The day's movements, so an alert arrives with the context needed to start
  -- looking rather than a bare number.
  SELECT COALESCE(jsonb_object_agg(reason, detail), '{}'::jsonb) INTO v_movements
  FROM (
    SELECT e.reason,
           jsonb_build_object(
             'pairs', COUNT(DISTINCT e.entry_pair_id),
             'ngwee', SUM(e.amount_ngwee) FILTER (WHERE e.direction = 'DEBIT')
           ) AS detail
    FROM public.ledger_entries e
    WHERE e.created_at >= v_as_of - interval '1 day'
      AND e.created_at < v_as_of
    GROUP BY e.reason
  ) m;

  IF v_internal <> 0 THEN
    -- Takes precedence over everything. If the ledger does not balance against
    -- itself, its own numbers cannot be trusted against the bank either.
    v_status := 'INTERNAL_IMBALANCE';
    v_drift := NULL;
  ELSIF p_bank_balance_ngwee IS NULL THEN
    v_status := 'BANK_UNAVAILABLE';
    v_drift := NULL;
  ELSE
    v_drift := p_bank_balance_ngwee - v_expected;
    v_status := CASE WHEN abs(v_drift) <= v_tolerance THEN 'BALANCED' ELSE 'DRIFT' END;
  END IF;

  INSERT INTO public.reconciliation_runs (
    as_of, run_date, bank_balance_ngwee,
    ledger_client_funds_ngwee, sender_liabilities_ngwee, merchant_payables_ngwee,
    fees_accrued_ngwee, operating_ngwee,
    drift_ngwee, internal_imbalance_ngwee, status, tolerance_ngwee, movements
  )
  VALUES (
    v_as_of, (v_as_of AT TIME ZONE 'Africa/Lusaka')::date, p_bank_balance_ngwee,
    v_client, v_sender, v_merchant, v_fees, v_operating,
    v_drift, v_internal, v_status, v_tolerance, v_movements
  )
  RETURNING id INTO v_id;

  IF v_status <> 'BALANCED' THEN
    INSERT INTO public.transaction_events (event_type, payload)
    VALUES ('RECONCILIATION_ALERT', jsonb_build_object(
      'run_id', v_id, 'status', v_status,
      'drift_ngwee', v_drift, 'internal_imbalance_ngwee', v_internal,
      'bank_balance_ngwee', p_bank_balance_ngwee, 'expected_ngwee', v_expected,
      'movements', v_movements
    ));

    -- Every admin, immediately. §8: alert with the delta and the day's
    -- movements. A control nobody is told about is not a control.
    FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' LOOP
      PERFORM public.create_notification(
        v_admin.id,
        CASE v_status
          WHEN 'INTERNAL_IMBALANCE' THEN
            'LEDGER IMBALANCE: debits and credits differ by '
              || to_char(v_internal / 100.0, 'FM999G999G999D00')
              || ' ZMW. A code path wrote a single-sided entry. Investigate now.'
          WHEN 'BANK_UNAVAILABLE' THEN
            'Reconciliation could not read the client funds account balance. '
              || 'Today''s check did not complete.'
          ELSE
            'RECONCILIATION DRIFT: the client funds account is out by '
              || to_char(v_drift / 100.0, 'FM999G999G999D00') || ' ZMW against the ledger.'
        END,
        'error', v_id::text
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_id,
    'status', v_status,
    'as_of', v_as_of,
    'bank_balance_ngwee', p_bank_balance_ngwee,
    'expected_ngwee', v_expected,
    'drift_ngwee', v_drift,
    'internal_imbalance_ngwee', v_internal,
    'client_funds_ngwee', v_client,
    'sender_liabilities_ngwee', v_sender,
    'merchant_payables_ngwee', v_merchant,
    'fees_accrued_ngwee', v_fees,
    'tolerance_ngwee', v_tolerance,
    'movements', v_movements
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The operational dashboard figure
--
-- What ops needs at a glance, without granting anyone the ability to run the
-- reconciliation itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_position()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_last RECORD;
BEGIN
  SELECT status, drift_ngwee, as_of INTO v_last
  FROM public.reconciliation_runs ORDER BY created_at DESC LIMIT 1;

  RETURN public.ledger_master_invariant() || jsonb_build_object(
    'unswept_fee_ngwee',     public.ledger_account_balance('FEE_ACCRUED'),
    'payouts_awaiting',      (SELECT COUNT(*) FROM public.payout_instructions
                              WHERE status IN ('SCHEDULED', 'FAILED')),
    'payouts_stuck',         (SELECT COUNT(*) FROM public.payout_instructions
                              WHERE status IN ('ABANDONED', 'SENT')),
    'refunds_pending',       (SELECT COUNT(*) FROM public.refund_requests
                              WHERE status IN ('REFUND_PENDING', 'UNCLAIMED')),
    'last_reconciliation',   to_jsonb(v_last)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.propose_fee_sweep(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_fee_sweep(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_fee_sweep(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escrow_reconcile(bigint, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escrow_position() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.propose_fee_sweep(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_fee_sweep(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_fee_sweep(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.escrow_reconcile(bigint, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.escrow_position() TO service_role;

GRANT SELECT ON public.fee_sweeps TO authenticated;
GRANT SELECT ON public.reconciliation_runs TO authenticated;
