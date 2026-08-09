-- =============================================================================
-- P0: an abandoned checkout destroyed the buyer's wallet credits
--
-- SYMPTOM
-- -------
-- Apply wallet credits covering the goods, start the payment, close the
-- Flutterwave page. The credits are gone, the order was never confirmed, and
-- nothing ever gives them back.
--
-- CAUSE
-- -----
-- checkout_init_atomic debits the wallet at INITIATION:
--
--   INSERT INTO wallet_ledger (wallet_id, amount, transaction_id, description)
--   VALUES (v_wallet_id, -v_credits_to_apply, v_transaction_id, ...)
--
-- That write happens before Flutterwave is contacted, and the only thing that
-- would justify it -- a confirmed payment -- may never arrive. The transaction
-- sits in GATEWAY_PROCESSING forever. Nothing in the schema reclaims it:
-- sweep_hanging_payments was dead V1 code, dropped by 20260725000002, and no
-- other function references the abandoned state.
--
-- This is the same shape as the balance-drift bug fixed an hour earlier in
-- 20260809180000: money moved before the thing it paid for was certain.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not move the debit later. Debiting at initiation is what stops the
-- same credits being spent twice on two concurrent checkouts, and that
-- protection is worth keeping. What was missing is the other half: a
-- compensating entry when the checkout it funded never completes.
--
-- FOUR THINGS HAD TO EXIST FOR THAT TO BE SAFE
-- --------------------------------------------
-- 1. A clock that measures THIS payment attempt, not the order's age.
--    checkout-retry reuses the same transaction row, so created_at is the age
--    of the first attempt. Sweeping on it would cancel a retry seconds after
--    the buyer opened the new payment link.
--
-- 2. A structural guarantee of one reversal per debit. The transaction-status
--    guard alone is not enough, because checkout-retry sets a released
--    transaction back to GATEWAY_PROCESSING -- so "cancel, retry, abandon"
--    would credit twice against a single debit. wallet_ledger.reversal_of
--    makes a second reversal impossible at the index level rather than by
--    remembering to check. (checkout-retry is also taught to refuse a
--    cancelled transaction, in the same change; this is the layer that holds
--    if some future caller forgets.)
--
-- 3. Stock returned to the shelf. checkout_init_atomic reserves it in the same
--    breath as the debit and it was stranded by exactly the same gap.
--
-- 4. Append-only compensation. wallet_ledger is immutable
--    (enforce_immutable_ledger); the debit cannot be deleted and must not be.
--    The history should say "credits were taken, then given back", because
--    that is what happened.
--
-- THE RESIDUAL RACE, STATED PLAINLY
-- ---------------------------------
-- A payment that confirms AFTER its transaction is released will be refused by
-- confirm_payment_atomic, which rejects any status but GATEWAY_PROCESSING --
-- money taken, order cancelled. The timeout is set at two hours to make that
-- essentially unreachable: Flutterwave's hosted links expire well inside it and
-- mobile-money flows resolve in minutes. It is not eliminated. Eliminating it
-- means asking the gateway what actually happened before releasing, which is an
-- Edge Function with the Flutterwave secret, not a database function.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. When did THIS payment attempt start?
--
--    Derived by trigger rather than written by each caller, for the reason
--    20260809180000 spells out: a value that depends on every writer
--    remembering is a value that will eventually be wrong. checkout-retry
--    already forgets things of this kind, and a future third writer would too.
--
--    The clock restarts on a new gateway reference as well as on a status
--    change into GATEWAY_PROCESSING, because checkout-retry writes the same
--    status again with a fresh tx_ref -- a status-only test would leave a
--    retried payment carrying the original attempt's clock and see it swept
--    immediately.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS gateway_initiated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.transactions.gateway_initiated_at IS
  'When the current payment attempt was handed to the gateway. Reset by '
  'trg_stamp_gateway_initiated_at on every new attempt, including retries, so '
  'the abandoned-checkout sweeper measures the attempt rather than the order.';

CREATE OR REPLACE FUNCTION public.stamp_gateway_initiated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'GATEWAY_PROCESSING'
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'GATEWAY_PROCESSING'
       -- A new gateway reference is a new attempt, even at the same status.
       OR NEW.gateway_tx_ref IS DISTINCT FROM OLD.gateway_tx_ref
     )
  THEN
    NEW.gateway_initiated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_gateway_initiated_at ON public.transactions;
CREATE TRIGGER trg_stamp_gateway_initiated_at
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_gateway_initiated_at();

-- Rows that predate the column. created_at is the best evidence available for
-- them, and it is the right answer for everything except a transaction that was
-- retried before this migration -- which the sweeper will then reclaim on its
-- first pass. That is the correct outcome: those attempts are hours old.
UPDATE public.transactions
SET gateway_initiated_at = created_at
WHERE gateway_initiated_at IS NULL
  AND created_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. One reversal per ledger entry. Ever.
--
--    Keyed on the debit row rather than on the transaction, because a
--    transaction can legitimately be paid at more than once (retry) while a
--    given debit can be given back exactly once. A unique index says that in a
--    way no caller can be careless about.
-- ---------------------------------------------------------------------------
ALTER TABLE public.wallet_ledger
  ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES public.wallet_ledger(id);

COMMENT ON COLUMN public.wallet_ledger.reversal_of IS
  'The entry this one compensates. The ledger is append-only, so an entry that '
  'should not have stood is answered with its opposite rather than removed. '
  'Unique: an entry can be reversed at most once.';

CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_one_reversal_per_entry
  ON public.wallet_ledger (reversal_of)
  WHERE reversal_of IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. How long an unpaid attempt is left alone.
--
--    In platform_settings with the other operational tunables, so it can be
--    changed without a migration if real payment durations turn out to differ
--    from the assumption above.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS abandoned_checkout_timeout_minutes INTEGER DEFAULT 120;

COMMENT ON COLUMN public.platform_settings.abandoned_checkout_timeout_minutes IS
  'How long a transaction may sit in GATEWAY_PROCESSING before its wallet '
  'credits and stock are released. Long by design: releasing early races a '
  'payment that is still in flight, and that failure takes the buyer''s money.';

-- ---------------------------------------------------------------------------
-- 4. The release itself.
--
--    Idempotent three times over: the status guard under a row lock, the
--    PENDING_PAYMENT filter on the stock restore, and the unique index on
--    reversal_of. Each of the three is sufficient on its own for the ordinary
--    case; they fail differently, which is the point.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_abandoned_checkout(
  p_transaction_id UUID,
  p_reason TEXT DEFAULT 'ABANDONED'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_txn              RECORD;
  v_debit            RECORD;
  v_credited         INTEGER := 0;
  v_items_restored   INTEGER := 0;
  v_orders_cancelled INTEGER := 0;
BEGIN
  SELECT transaction_id, status, buyer_id
    INTO v_txn
  FROM public.transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % not found', p_transaction_id;
  END IF;

  -- The single most important line in this function.
  --
  -- SUCCESS means the buyer paid and the goods are theirs; releasing would
  -- hand back credits AND leave the order standing. CANCELLED means this
  -- already ran. Anything else is a state this has no opinion about. Held
  -- under the row lock taken above, so two concurrent callers cannot both pass.
  IF v_txn.status <> 'GATEWAY_PROCESSING' THEN
    RETURN jsonb_build_object(
      'released', false,
      'reason',   'not_awaiting_payment',
      'status',   v_txn.status
    );
  END IF;

  -- Give the credits back.
  --
  -- Every unreversed debit against this transaction, though in practice there
  -- is exactly one -- checkout_init_atomic writes a single entry. Looping
  -- rather than assuming means a future second debit is not silently skipped.
  --
  -- A negative entry carrying a transaction_id can only be the checkout debit:
  -- withdrawals (request_withdrawal_atomic) write no transaction_id, and every
  -- other writer credits. Keyed on that structure rather than on the
  -- description text, which is prose and can be reworded.
  FOR v_debit IN
    SELECT l.id, l.wallet_id, l.amount
    FROM public.wallet_ledger l
    WHERE l.transaction_id = p_transaction_id
      AND l.amount < 0
      AND NOT EXISTS (
        SELECT 1 FROM public.wallet_ledger r WHERE r.reversal_of = l.id
      )
    ORDER BY l.created_at
  LOOP
    INSERT INTO public.wallet_ledger (wallet_id, amount, transaction_id, description, reversal_of)
    VALUES (
      v_debit.wallet_id,
      -v_debit.amount,
      p_transaction_id,
      'Wallet credits returned — the order was not completed',
      v_debit.id
    );

    v_credited := v_credited + (-v_debit.amount);
  END LOOP;

  -- Put the reserved units back on the shelf.
  --
  -- Filtered on PENDING_PAYMENT, which is the state checkout_init_atomic left
  -- these orders in and which the flip below removes -- so this cannot run
  -- twice against the same order even if the status guard above were somehow
  -- passed twice.
  --
  -- Restored only where stock is tracked, mirroring the reservation exactly:
  -- checkout decremented nothing for an untracked item, so nothing is owed
  -- back. An item switched from untracked to tracked mid-flight gets nothing,
  -- which errs toward not inventing stock that was never taken.
  WITH reserved AS (
    SELECT oi.item_id, count(*)::INTEGER AS qty
    FROM public.order_items oi
    JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
    WHERE so.transaction_id = p_transaction_id
      AND so.claim_status = 'PENDING_PAYMENT'
    GROUP BY oi.item_id
  )
  UPDATE public.items i
  SET stock_quantity = i.stock_quantity + r.qty
  FROM reserved r
  WHERE i.id = r.item_id
    AND i.stock_quantity IS NOT NULL;

  GET DIAGNOSTICS v_items_restored = ROW_COUNT;

  UPDATE public.shop_orders
  SET claim_status = 'CANCELLED'
  WHERE transaction_id = p_transaction_id
    AND claim_status = 'PENDING_PAYMENT';

  GET DIAGNOSTICS v_orders_cancelled = ROW_COUNT;

  -- CANCELLED also takes these orders out of process_expired_vouchers' reach,
  -- which excludes CANCELLED explicitly. Without it an unpaid order would
  -- eventually "expire" and pay the buyer an 80% refund out of money that was
  -- never collected.
  UPDATE public.transactions
  SET status = 'CANCELLED'
  WHERE transaction_id = p_transaction_id;

  INSERT INTO public.transaction_events (transaction_id, event_type, payload)
  VALUES (
    p_transaction_id,
    'CHECKOUT_RELEASED',
    jsonb_build_object(
      'reason',             p_reason,
      'credits_returned',   v_credited,
      'items_restocked',    v_items_restored,
      'shop_orders_cancelled', v_orders_cancelled
    )
  );

  -- Told only when there is money to tell them about. A buyer who walked away
  -- from a checkout knows they walked away; a buyer whose credits vanished and
  -- came back needs to see the second half.
  IF v_credited > 0 AND v_txn.buyer_id IS NOT NULL THEN
    PERFORM public.create_notification(
      v_txn.buyer_id,
      'Your order was not completed, so the ' || v_credited::TEXT
        || ' ngwee of wallet credit you applied has been returned to your wallet.',
      'info',
      p_transaction_id::TEXT
    );
  END IF;

  RETURN jsonb_build_object(
    'released',              true,
    'reason',                p_reason,
    'credits_returned',      v_credited,
    'items_restocked',       v_items_restored,
    'shop_orders_cancelled', v_orders_cancelled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_abandoned_checkout(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_abandoned_checkout(UUID, TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The sweeper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reclaim_abandoned_checkouts(
  p_older_than_minutes INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_minutes  INTEGER;
  v_row      RECORD;
  v_result   JSONB;
  v_released INTEGER := 0;
BEGIN
  SELECT COALESCE(p_older_than_minutes, ps.abandoned_checkout_timeout_minutes)
    INTO v_minutes
  FROM public.platform_settings ps
  WHERE ps.id = 1;

  v_minutes := COALESCE(v_minutes, p_older_than_minutes, 120);

  FOR v_row IN
    SELECT t.transaction_id
    FROM public.transactions t
    WHERE t.status = 'GATEWAY_PROCESSING'
      AND COALESCE(t.gateway_initiated_at, t.created_at)
          < now() - make_interval(mins => v_minutes)
    ORDER BY COALESCE(t.gateway_initiated_at, t.created_at)
    LIMIT 500
  LOOP
    -- Each release in its own subtransaction. This runs unattended on a
    -- schedule, and one transaction that cannot be released -- a constraint
    -- nobody anticipated, a row locked by something else -- must not strand
    -- every transaction behind it in the queue.
    BEGIN
      v_result := public.release_abandoned_checkout(v_row.transaction_id, 'ABANDONED_TIMEOUT');
      IF COALESCE((v_result->>'released')::BOOLEAN, false) THEN
        v_released := v_released + 1;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'could not release abandoned checkout %: %', v_row.transaction_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.reclaim_abandoned_checkouts(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_abandoned_checkouts(INTEGER)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Schedule it.
--
--    Every fifteen minutes against a two-hour timeout: the granularity of the
--    sweep is irrelevant next to the size of the window, and a quarter-hourly
--    job that usually finds nothing is cheap. Unscheduled first so re-applying
--    this migration cannot leave two jobs racing.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('kithly-reclaim-abandoned-checkouts')
  FROM cron.job WHERE jobname = 'kithly-reclaim-abandoned-checkouts';

SELECT cron.schedule(
  'kithly-reclaim-abandoned-checkouts',
  '*/15 * * * *',
  $$SELECT public.reclaim_abandoned_checkouts()$$
);

-- ---------------------------------------------------------------------------
-- 7. Verify.
--
--    Structural only. The behaviour is asserted in
--    tests/integration/money-path.destructive.test.ts, against a disposable
--    database -- this file runs against production, where wallet_ledger is
--    append-only and a probe row could never be taken back out.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_jobs INT;
BEGIN
  IF to_regprocedure('public.release_abandoned_checkout(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'release_abandoned_checkout was not created';
  END IF;

  IF to_regprocedure('public.reclaim_abandoned_checkouts(integer)') IS NULL THEN
    RAISE EXCEPTION 'reclaim_abandoned_checkouts was not created';
  END IF;

  -- A new signature does NOT inherit grants: PostgreSQL grants EXECUTE to
  -- PUBLIC by default, and anon inherits PUBLIC. Both of these cancel orders
  -- and write to the ledger.
  IF has_function_privilege('anon', 'public.release_abandoned_checkout(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.release_abandoned_checkout(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reclaim_abandoned_checkouts(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reclaim_abandoned_checkouts(integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'the release functions are reachable by anon or authenticated';
  END IF;

  -- The guard that keeps a paid order paid.
  IF (SELECT prosrc FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'release_abandoned_checkout')
     NOT LIKE '%status <> ''GATEWAY_PROCESSING''%'
  THEN
    RAISE EXCEPTION 'release_abandoned_checkout lost its status guard';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'wallet_ledger_one_reversal_per_entry'
  ) THEN
    RAISE EXCEPTION 'the one-reversal-per-entry index is missing -- a retried '
                    'checkout could be credited twice against one debit';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.transactions'::regclass
      AND tgname = 'trg_stamp_gateway_initiated_at'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'the gateway_initiated_at trigger is missing -- the sweeper '
                    'would measure the order''s age and cancel live retries';
  END IF;

  SELECT count(*) INTO v_jobs
  FROM cron.job WHERE jobname = 'kithly-reclaim-abandoned-checkouts';

  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 kithly-reclaim-abandoned-checkouts job, found %', v_jobs;
  END IF;

  RAISE NOTICE 'abandoned checkouts are reclaimed every 15 minutes after a % minute timeout',
    (SELECT abandoned_checkout_timeout_minutes FROM public.platform_settings WHERE id = 1);
END $verify$;
