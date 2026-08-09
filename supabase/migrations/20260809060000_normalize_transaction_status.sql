-- =============================================================================
-- One spelling for a paid transaction
--
-- WHY
-- ---
-- `transactions.status` has carried two values meaning the same thing since the
-- V2 schema: 'SUCCESS' and 'SUCCESSFUL'. Both are written today --
-- confirm_payment_atomic sets 'SUCCESS', checkout_init_atomic sets 'SUCCESSFUL'
-- on the cash-zero path, and the admin-confirm-payment edge function sets
-- 'SUCCESSFUL'. Roughly eight readers across src/ and the edge functions
-- defensively check for both.
--
-- Every one of those checks is a place someone can forget one. A reader that
-- tests only `=== 'SUCCESS'` silently treats a paid transaction as unpaid, and
-- nothing fails loudly -- PaymentProcessingScreen already compares against
-- 'SUCCESS' alone, so a wallet-funded order reaching it would sit there looking
-- unpaid.
--
-- 'SUCCESS' is the survivor. It is what the main payment path already writes,
-- it is what the existing rows hold, and it is the first value listed in
-- TransactionStatus.
--
-- SEQUENCING -- read before pushing
-- ---------------------------------
-- The CHECK constraint is deliberately NOT in this migration. The
-- admin-confirm-payment edge function still writes 'SUCCESSFUL' until it is
-- redeployed, and a constraint added now would make every admin payment
-- confirmation fail. Order is:
--
--   1. this migration
--   2. deploy the edge functions
--   3. 20260809070000_transaction_status_constraint.sql
--
-- Applying 070000 early is safe in the sense that it cannot corrupt anything --
-- it will simply reject writes from a stale function until the deploy catches
-- up.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Existing rows.
--
--    Two, at the time of writing, and only one of them SUCCESS -- but this has
--    to be idempotent and correct at any volume, since it also runs on every
--    from-empty replay and on whatever the table looks like when it is applied.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.transactions
  SET status = 'SUCCESS'
  WHERE status = 'SUCCESSFUL';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'normalised % transaction row(s) from SUCCESSFUL to SUCCESS', v_updated;
END $$;

-- ---------------------------------------------------------------------------
-- 2. checkout_init_atomic's cash-zero path.
--
--    Patched by rewriting the live definition rather than retyping it.
--
--    That function is ~190 lines and has been rewritten nine times; CREATE OR
--    REPLACE has no partial form, so changing one literal by hand means
--    reproducing all of it and hoping nothing was transposed. An earlier
--    migration in this series nearly deleted 160 lines of sweep_hanging_payments
--    doing exactly that from a partial read.
--
--    pg_get_functiondef returns the whole thing as executable SQL, so the edit
--    is a single string replacement against the definition Postgres itself
--    holds. The occurrence count is asserted first: if it is not exactly one,
--    the assumption behind this edit is wrong and the migration stops rather
--    than guessing which literal was meant.
--
--    CREATE OR REPLACE preserves the ACL, so the service_role-only grant from
--    20260809000000 survives untouched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src  TEXT;
  v_new  TEXT;
  v_hits INT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'checkout_init_atomic';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'checkout_init_atomic not found';
  END IF;

  v_hits := (length(v_src) - length(replace(v_src, '''SUCCESSFUL''', ''))) / 12;

  IF v_hits = 0 THEN
    RAISE NOTICE 'checkout_init_atomic already writes SUCCESS -- nothing to do';
    RETURN;
  END IF;

  IF v_hits <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one SUCCESSFUL literal in checkout_init_atomic, found % -- refusing to guess',
      v_hits;
  END IF;

  v_new := replace(v_src, '''SUCCESSFUL''', '''SUCCESS''');
  EXECUTE v_new;

  RAISE NOTICE 'checkout_init_atomic now writes SUCCESS on the cash-zero path';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Verify.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rows INT;
  v_fns  TEXT[] := '{}';
  v_row  RECORD;
BEGIN
  SELECT count(*) INTO v_rows FROM public.transactions WHERE status = 'SUCCESSFUL';
  IF v_rows > 0 THEN
    RAISE EXCEPTION '% transaction row(s) still hold SUCCESSFUL', v_rows;
  END IF;

  FOR v_row IN
    SELECT p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosrc LIKE '%''SUCCESSFUL''%'
  LOOP
    v_fns := array_append(v_fns, v_row.proname);
  END LOOP;

  IF array_length(v_fns, 1) > 0 THEN
    RAISE EXCEPTION 'function(s) still write or read SUCCESSFUL: %', v_fns;
  END IF;

  -- The grant must have survived the rewrite in step 2.
  IF has_function_privilege('anon', 'public.checkout_init_atomic(uuid,text,text,jsonb,text,text,text,text,integer,timestamptz,uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'checkout_init_atomic became reachable by anon after the rewrite';
  END IF;

  RAISE NOTICE 'transaction status normalised; no SUCCESSFUL remains in data or functions';
END $$;
