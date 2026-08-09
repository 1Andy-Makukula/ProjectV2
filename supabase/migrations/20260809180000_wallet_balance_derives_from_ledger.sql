-- =============================================================================
-- P0: wallet credits could not be spent, because the cached balance was a lie
--
-- SYMPTOM
-- -------
-- Applying wallet credits at checkout failed with
--   new row for relation "kithly_wallets" violates check constraint
--   "kithly_wallets_balance_check"
-- so no customer could spend a credit balance at all.
--
-- CAUSE
-- -----
-- kithly_wallets.balance is a cache of sum(wallet_ledger.amount), maintained by
-- trg_sync_wallet_balance. That trigger INCREMENTED:
--
--   SET balance = balance + NEW.amount
--
-- An increment is only correct if it happens exactly once per ledger row. In
-- production it happened twice: one wallet holds a single +3994 ledger row from
-- a PARTIAL_REFUND and a cached balance of 7988 -- precisely double.
--
-- Checkout then trusted the cache. It let the buyer apply 7988 of credits they
-- did not have, the ledger insert of -7988 took the true sum to -3994, and the
-- non-negative constraint did what it exists to do. The constraint was not the
-- bug; it was the only thing that noticed.
--
-- FIX
-- ---
-- The trigger now RECOMPUTES from the ledger rather than adjusting by a delta:
--
--   SET balance = (SELECT coalesce(sum(amount), 0) FROM wallet_ledger WHERE ...)
--
-- That makes balance equal to the ledger by construction, and it is idempotent
-- -- running it twice gives the same answer. So it repairs the class of fault
-- rather than one instance: a duplicated trigger, a double write, a retried
-- statement, all become harmless. An increment can never offer that guarantee,
-- because being correct depends on being called exactly once, and nothing in
-- the schema was enforcing that.
--
-- The immutable ledger is what makes this safe. wallet_ledger is append-only
-- (enforce_immutable_ledger), so the sum is a stable historical fact rather
-- than something that can be edited out from under the cache.
--
-- WHY NOT DROP THE CACHE ENTIRELY
-- -------------------------------
-- Because balance is read on hot paths and by RLS-facing queries, and a SUM
-- over a growing append-only table on every read is a different problem. The
-- cache stays; it just stops being able to disagree.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Report the damage before repairing it.
--
--    Printed rather than silently corrected, because a balance that was wrong
--    may already have been shown to a customer, and someone should know how
--    many and by how much.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_row   RECORD;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT w.id,
           w.balance AS cached,
           coalesce((SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = w.id), 0) AS truth
    FROM public.kithly_wallets w
  LOOP
    IF v_row.cached <> v_row.truth THEN
      v_count := v_count + 1;
      RAISE WARNING 'wallet % drifted: cached % but ledger says % (out by %)',
        v_row.id, v_row.cached, v_row.truth, v_row.cached - v_row.truth;
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RAISE NOTICE 'no wallet balances had drifted';
  ELSE
    RAISE NOTICE '% wallet(s) drifted from the ledger; correcting to the ledger', v_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The ledger wins.
--
--    The ledger is append-only and every entry states why it exists; the cache
--    is derived and has no independent authority. Where they disagree the
--    ledger is right by definition.
-- ---------------------------------------------------------------------------
UPDATE public.kithly_wallets w
SET balance = coalesce(
      (SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = w.id), 0),
    updated_at = now()
WHERE w.balance <> coalesce(
      (SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = w.id), 0);

-- ---------------------------------------------------------------------------
-- 3. Make it derived, so it cannot drift again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_wallet_balance_from_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Recomputed, not adjusted. The previous version did balance = balance +
  -- NEW.amount, which is correct only when it runs exactly once per row --
  -- a property nothing enforced, and which production violated.
  UPDATE public.kithly_wallets
  SET balance = coalesce(
        (SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = NEW.wallet_id), 0),
      updated_at = now()
  WHERE id = NEW.wallet_id;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Verify, including the case that failed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.kithly_wallets w
  WHERE w.balance <> coalesce(
        (SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = w.id), 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION '% wallet(s) still disagree with the ledger after reconciliation', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'sync_wallet_balance_from_ledger'
      AND prosrc LIKE '%balance + NEW.amount%'
  ) THEN
    RAISE EXCEPTION 'the trigger still increments rather than recomputing';
  END IF;

  -- Exactly one sync trigger. Two would have been harmless under the new
  -- recomputing version, but it is still not what anyone intends.
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgfoid = 'public.sync_wallet_balance_from_ledger'::regproc
        AND NOT tgisinternal) <> 1 THEN
    RAISE WARNING 'wallet_ledger has more than one balance-sync trigger; harmless now, but unintended';
  END IF;

  RAISE NOTICE 'wallet balances now derive from the ledger and cannot drift';
END $$;
