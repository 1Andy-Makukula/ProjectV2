-- =============================================================================
-- A withdrawal whose outcome is unknown must not be reversed
--
-- WHY
-- ---
-- batch-payout-sweeper wraps the Flutterwave transfer in a single try/catch and
-- routes everything that lands there to fail_withdrawal, which credits the
-- merchant's balance back. Two very different things arrive at that handler:
--
--   * an error RESPONSE from Flutterwave -- a definite rejection. Reversing is
--     correct.
--   * a THROWN error -- socket timeout, dropped connection, DNS failure. The
--     request may well have reached Flutterwave and be in flight. Reversing is
--     wrong.
--
-- In the second case the merchant's balance is restored while the transfer
-- still disburses: paid, and credited for it. The deterministic reference
-- (kithly-withdrawal-<id>) stops Flutterwave accepting a duplicate REQUEST, but
-- nothing stops the platform reversing a debit for a transfer that succeeded.
--
-- CLAUDE.md's rule is that money-moving operations use explicit idempotency.
-- The reference satisfies that at the API boundary. This closes the other half:
-- not knowing an outcome is a distinct state from knowing it failed, and the
-- ledger must be able to say so.
--
-- SHAPE
-- -----
-- A fourth status, `unverified`: the transfer was dispatched, the outcome is
-- unknown, the debit STAYS in place. Resolution happens out of band by asking
-- Flutterwave what actually happened to that reference.
--
-- complete_withdrawal and fail_withdrawal are deliberately NOT modified.
-- Widening their status guards would mean CREATE OR REPLACE on two functions
-- whose full bodies would have to be retyped -- the same transcription risk
-- that makes rewriting a large function to change one line a bad trade.
-- Instead the resolver moves the row back to `processing` and calls them
-- exactly as they already are.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The new state.
-- ---------------------------------------------------------------------------
ALTER TABLE public.merchant_withdrawals
  DROP CONSTRAINT IF EXISTS merchant_withdrawals_status_check;

ALTER TABLE public.merchant_withdrawals
  ADD CONSTRAINT merchant_withdrawals_status_check
  CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'unverified'));

COMMENT ON COLUMN public.merchant_withdrawals.status IS
  'pending -> claimed as processing -> paid | failed. `unverified` means the '
  'transfer was dispatched but the platform never learned the outcome: the '
  'debit stands, and it must be resolved against the provider before it can '
  'become paid or failed. Never reverse an unverified withdrawal blindly.';

-- Small and hot: this is a work queue for the resolver, and it should stay
-- empty. A non-empty result is itself the alert.
CREATE INDEX IF NOT EXISTS merchant_withdrawals_unverified_idx
  ON public.merchant_withdrawals (created_at)
  WHERE status = 'unverified';

-- ---------------------------------------------------------------------------
-- 2. Park a withdrawal whose outcome is unknown.
--
--    Records the reason and stamps updated_at, but touches no balance and no
--    ledger -- there is nothing truthful to write yet. The money is neither
--    confirmed gone nor confirmed returned, and the ledger should not pretend
--    otherwise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_withdrawal_unverified(
  p_withdrawal_id uuid,
  p_reason        text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_reason text := COALESCE(nullif(btrim(coalesce(p_reason, '')), ''), 'Transfer outcome unknown');
BEGIN
  SELECT id, status INTO v_row
  FROM public.merchant_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  -- Idempotent: a retried sweep that hits the same ambiguity twice should not
  -- error, it should find the row already parked.
  IF v_row.status = 'unverified' THEN
    RETURN jsonb_build_object('success', true, 'already_unverified', true);
  END IF;

  IF v_row.status <> 'processing' THEN
    RAISE EXCEPTION 'Withdrawal is %, not processing -- cannot mark unverified', v_row.status;
  END IF;

  UPDATE public.merchant_withdrawals
  SET status = 'unverified',
      failure_reason = v_reason,
      updated_at = now()
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Hand a resolved withdrawal back to the existing state machine.
--
--    Only ever called once the provider has been asked what happened. The
--    caller then invokes complete_withdrawal or fail_withdrawal, which are
--    unchanged and still expect `processing`.
--
--    Kept as a separate deliberate step rather than folded into the resolver's
--    RPCs: moving out of `unverified` should be hard to do by accident, and a
--    caller that reopens without then resolving leaves the row in `processing`
--    where the existing sweep can see it, rather than silently paid or failed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_unverified_withdrawal(
  p_withdrawal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT id, status INTO v_row
  FROM public.merchant_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  IF v_row.status <> 'unverified' THEN
    RAISE EXCEPTION 'Withdrawal is %, not unverified', v_row.status;
  END IF;

  UPDATE public.merchant_withdrawals
  SET status = 'processing',
      updated_at = now()
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants.
--
--    Both are money-state functions: service_role only, never the browser.
--    Stated explicitly because a newly created function inherits the PUBLIC
--    default EXECUTE grant -- the defect 20260809000000 was written to fix.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mark_withdrawal_unverified(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_unverified(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.reopen_unverified_withdrawal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_unverified_withdrawal(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Verify, or fail the migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['mark_withdrawal_unverified', 'reopen_unverified_withdrawal'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    ) THEN
      RAISE EXCEPTION '% was not created', v_fn;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
        AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    ) THEN
      RAISE EXCEPTION '% is reachable by anon or authenticated', v_fn;
    END IF;
  END LOOP;

  -- The constraint must actually admit the new value, or the sweeper's first
  -- ambiguous transfer fails on a CHECK violation instead of parking safely.
  BEGIN
    ALTER TABLE public.merchant_withdrawals
      ADD CONSTRAINT tmp_unverified_probe CHECK (status <> 'unverified') NOT VALID;
    ALTER TABLE public.merchant_withdrawals DROP CONSTRAINT tmp_unverified_probe;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Could not verify the status constraint accepts unverified: %', SQLERRM;
  END;

  RAISE NOTICE 'withdrawal unverified state ready: park, reopen, service_role only';
END $$;
