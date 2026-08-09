-- =============================================================================
-- The recomputing balance trigger loses concurrent credits
--
-- 20260809180000 replaced an incrementing balance cache with a recomputing one:
--
--   SET balance = (SELECT coalesce(sum(amount), 0) FROM wallet_ledger WHERE ...)
--
-- That fixed the real bug it was aimed at -- an increment is only correct if it
-- runs exactly once per row, and production had a wallet at precisely double
-- its ledger. But it traded one concurrency property for another, and the
-- suite's own test caught it:
--
--   ledger invariants > applies concurrent credits without losing any of them
--
-- REPRODUCED DIRECTLY
-- -------------------
--   session A: BEGIN; INSERT +1000 into wallet_ledger; (hold)
--   session B:        INSERT  +500 into wallet_ledger; (blocks)
--   session A: COMMIT
--   result:   ledger = 1500, cached balance = 500
--
-- A's credit is in the ledger and absent from the cache.
--
-- WHY
-- ---
-- Under READ COMMITTED a statement's snapshot is taken when the statement
-- begins. B's trigger UPDATE starts before A commits, so its sum subquery
-- cannot see A's ledger row. It then blocks on the wallet's row lock, which A
-- holds. When A commits and B proceeds, B writes the total it computed from the
-- older snapshot -- straight over A's correct figure.
--
-- The increment it replaced did not have this failure: `balance = balance +
-- NEW.amount` re-reads the locked row at write time, so it composes with a
-- concurrent writer. It simply had the other failure instead.
--
-- FIX
-- ---
-- Take the row lock in its OWN statement, before the one that computes the sum.
-- The lock waits out the competing writer, and because each statement in a
-- READ COMMITTED transaction takes a fresh snapshot, the UPDATE that follows
-- sees the ledger rows that writer committed.
--
-- This keeps both properties rather than choosing between them:
--   idempotent   -- recomputed from the ledger, so running twice is harmless
--   serialised   -- concurrent writers queue and each sees its predecessor
--
-- FOR NO KEY UPDATE, NOT FOR UPDATE
-- ---------------------------------
-- This distinction is the whole difference between a fix and an outage, and it
-- was found the hard way: the first attempt used FOR UPDATE and deadlocked
-- every concurrent pair of credits within seconds.
--
-- wallet_ledger.wallet_id is a foreign key onto kithly_wallets, so INSERTing a
-- ledger row takes a KEY SHARE lock on the wallet -- Postgres protecting the
-- parent key for the duration of the transaction. Two transactions crediting
-- the same wallet therefore BOTH hold KEY SHARE on it before either reaches
-- this trigger. FOR UPDATE conflicts with KEY SHARE, so each then waits for the
-- other to release a lock neither can release until it commits:
--
--   deadlock detected ... while locking tuple in relation "kithly_wallets"
--   SQL statement "SELECT 1 FROM public.kithly_wallets ... FOR UPDATE"
--
-- FOR NO KEY UPDATE is compatible with KEY SHARE and still conflicts with
-- itself and with UPDATE. So it serialises exactly the writers that need
-- serialising -- the other balance updaters -- while leaving the FK's own locks
-- alone. It is also precisely the lock level the UPDATE below would take on its
-- own, which is what makes this safe: the trigger acquires nothing stronger
-- than it always did, only earlier.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_wallet_balance_from_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Deliberately a separate statement, and the whole point of this migration.
  --
  -- Folding this into the UPDATE below would reinstate the bug: the sum would
  -- then be computed from the snapshot taken before the wait, which is exactly
  -- how a concurrent credit went missing.
  --
  -- NO KEY, for the reason set out at the top: the insert that fired this
  -- trigger is already holding KEY SHARE on this row via the foreign key, and
  -- so is every other transaction crediting the same wallet. Asking for
  -- FOR UPDATE here deadlocks them against each other.
  PERFORM 1 FROM public.kithly_wallets WHERE id = NEW.wallet_id FOR NO KEY UPDATE;

  UPDATE public.kithly_wallets
  SET balance = coalesce(
        (SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = NEW.wallet_id), 0),
      updated_at = now()
  WHERE id = NEW.wallet_id;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reconcile anything that already drifted.
--
-- The window has been open since 20260809180000 was pushed, so any wallet that
-- took two ledger writes at once in that period is short in the cache -- and
-- short means a buyer cannot spend credit that is genuinely theirs. Reported
-- before correcting, on the same reasoning as the original migration: a wrong
-- balance may already have been shown to someone.
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

UPDATE public.kithly_wallets w
SET balance = coalesce(
      (SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = w.id), 0),
    updated_at = now()
WHERE w.balance <> coalesce(
      (SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = w.id), 0);

-- ---------------------------------------------------------------------------
-- Verify.
--
-- The behavioural proof is the concurrency test in
-- tests/integration/ledger-invariants.destructive.test.ts, which fires eight
-- credits at once and was failing before this change. What is asserted here is
-- that the two properties this trigger has to hold at once are both still
-- expressed in the code.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src TEXT;
  v_bad INT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'sync_wallet_balance_from_ledger';

  IF v_src LIKE '%balance + NEW.amount%' THEN
    RAISE EXCEPTION 'the trigger increments again -- 20260809180000 regressed';
  END IF;

  IF v_src NOT LIKE '%FOR NO KEY UPDATE%' THEN
    RAISE EXCEPTION 'the trigger recomputes without taking the row lock first -- '
                    'concurrent credits will be lost';
  END IF;

  -- Asserted specifically, because the difference is invisible on a quiet
  -- database and total on a busy one: plain FOR UPDATE conflicts with the KEY
  -- SHARE the ledger's own foreign key holds, and deadlocks every concurrent
  -- pair of credits.
  IF v_src ~ 'FOR UPDATE' AND v_src !~ 'FOR NO KEY UPDATE' THEN
    RAISE EXCEPTION 'the trigger uses FOR UPDATE, which deadlocks against the '
                    'foreign key''s KEY SHARE lock';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.kithly_wallets w
  WHERE w.balance <> coalesce(
        (SELECT sum(l.amount) FROM public.wallet_ledger l WHERE l.wallet_id = w.id), 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION '% wallet(s) still disagree with the ledger after reconciliation', v_bad;
  END IF;

  RAISE NOTICE 'wallet balances recompute under the row lock; concurrent credits survive';
END $$;
