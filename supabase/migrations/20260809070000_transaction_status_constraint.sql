-- =============================================================================
-- Pin transactions.status to the values that actually exist
--
-- PUSH THIS AFTER DEPLOYING THE EDGE FUNCTIONS
-- --------------------------------------------
-- 20260809060000 normalised the data and the database functions.
-- admin-confirm-payment wrote 'SUCCESSFUL' until it was redeployed alongside
-- that migration. If this constraint lands while a stale copy of that function
-- is still running, every admin payment confirmation fails at the CHECK.
--
-- Nothing is corrupted either way -- a rejected write is a rejected write --
-- but the order that avoids downtime is: 060000, deploy functions, then this.
--
-- WHY A CONSTRAINT AT ALL
-- -----------------------
-- The whole point of collapsing 'SUCCESS' and 'SUCCESSFUL' is that no future
-- reader has to remember both. Normalising the data and the writers achieves
-- that today; only a constraint keeps it true. Without one, the next person to
-- copy an old snippet reintroduces the second spelling and every single-value
-- reader silently treats a paid transaction as unpaid -- which fails quietly,
-- in the direction of telling a buyer their money did not arrive.
--
-- THE VALUE LIST
-- --------------
-- Derived from what is actually written, not from the TypeScript union:
--
--   GATEWAY_PROCESSING  checkout_init_atomic, checkout-init, checkout-retry
--   SUCCESS             confirm_payment_atomic, checkout_init_atomic's
--                       cash-zero path, admin-confirm-payment
--
-- FAILED, CANCELLED and EXPIRED are included even though nothing writes them
-- today. They are declared in TransactionStatus, they are the obvious terminal
-- states for a payment that does not complete, and admitting them costs
-- nothing. Leaving them out would turn a plausible future write into a
-- production error rather than a design decision.
--
-- NOT NULL is deliberately not asserted here. Existing rows are all populated,
-- but that is a separate change with a separate blast radius, and bundling it
-- would make this constraint's failure mode ambiguous.
-- =============================================================================

DO $$
DECLARE
  v_bad RECORD;
  v_offenders TEXT[] := '{}';
BEGIN
  -- Fail with the actual offending values rather than a bare constraint
  -- violation, so a failure here is immediately actionable.
  FOR v_bad IN
    SELECT DISTINCT status
    FROM public.transactions
    WHERE status IS NOT NULL
      AND status NOT IN ('GATEWAY_PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED')
  LOOP
    v_offenders := array_append(v_offenders, v_bad.status);
  END LOOP;

  IF array_length(v_offenders, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot add the status constraint: transactions hold unexpected value(s) %. '
      'Normalise them first -- see 20260809060000.', v_offenders;
  END IF;
END $$;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_status_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IS NULL OR status IN (
    'GATEWAY_PROCESSING',
    'SUCCESS',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
  ));

COMMENT ON CONSTRAINT transactions_status_check ON public.transactions IS
  'SUCCESSFUL is deliberately absent. It was a second spelling of SUCCESS that '
  'coexisted with it for months, forcing every reader to check both -- and a '
  'reader that checked only one silently reported a paid transaction as unpaid.';

-- ---------------------------------------------------------------------------
-- Verify the constraint actually rejects the value it exists to prevent.
--
-- Asserted rather than assumed: a CHECK with a subtly wrong expression is
-- indistinguishable from a working one until the day it matters.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    -- Rolled back regardless of outcome; this only probes the constraint.
    INSERT INTO public.transactions (buyer_id, total_amount, status, origin_type)
    VALUES (NULL, 0, 'SUCCESSFUL', 'LOCAL');
    RAISE EXCEPTION 'CONSTRAINT NOT ENFORCED: a SUCCESSFUL row was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'verified: SUCCESSFUL is rejected by transactions_status_check';
    WHEN not_null_violation OR foreign_key_violation THEN
      -- Another constraint rejected the probe row first, so this tells us
      -- nothing either way. Not treated as success.
      RAISE EXCEPTION
        'Could not probe the status constraint: the test row failed on a different constraint first';
  END;
  -- Nothing to undo: the INSERT never committed.
END $$;
