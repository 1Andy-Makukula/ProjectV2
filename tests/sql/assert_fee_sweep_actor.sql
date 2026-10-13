\set ON_ERROR_STOP on
\pset pager off

-- 20261013000000: a fee sweep is attributed to the CALLER, never to the id the
-- caller names. Before it, `confirm_fee_sweep` and `cancel_fee_sweep` checked
-- only that p_admin_id belonged to an admin -- a value the browser supplies in
-- `useEscrowAdmin.ts` -- so anyone who knew an admin's user id could move the
-- platform's fees and have admin_action_log name that admin as the actor.
-- `propose_fee_sweep` checked nothing at all.
--
-- WHAT THIS FILE CANNOT TEST, and it is the more serious half: the GRANTS.
-- The hole was that `anon` and `authenticated` held EXECUTE on all 28 escrow
-- money functions, because Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE
-- to those roles on every new function owned by `postgres`, and the migrations
-- only revoked PUBLIC. This scaffold never issues those default grants, so the
-- roles never hold EXECUTE here and the bug is invisible -- which is exactly
-- why `pnpm sql:test` stayed green from 15 Sep while CI's from-empty replay on
-- a real Supabase stack failed on it. Grants are asserted in
-- supabase/tests/ci_smoke_checks.sql, check 4, against a real stack. Do not
-- "fix" that gap by granting to anon in the scaffold: a scaffold that invents
-- privileges is the same class of fiction as one that invents a column.
--
-- Self-cleaning: admin_action_log refuses deletes, so assertions count rows by
-- the sweep id rather than expecting an empty table.

DELETE FROM public.fee_sweeps WHERE bank_reference LIKE 'ACTOR-TEST-%';
DELETE FROM public.users WHERE id IN (
  'ac700000-0000-0000-0000-0000000000a1',
  'ac700000-0000-0000-0000-0000000000a2',
  'ac700000-0000-0000-0000-0000000000b1'
);

INSERT INTO public.users (id, role) VALUES
  ('ac700000-0000-0000-0000-0000000000a1', 'admin'),
  ('ac700000-0000-0000-0000-0000000000a2', 'admin'),
  ('ac700000-0000-0000-0000-0000000000b1', 'sender');

\echo '--- 1. an unidentified caller cannot open, confirm or cancel a sweep ---'
DO $$
DECLARE v_fn text;
BEGIN
  PERFORM set_config('test.uid', '', true);

  BEGIN
    PERFORM public.propose_fee_sweep(current_date);
    RAISE EXCEPTION 'FAIL: an unauthenticated caller opened a sweep';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.confirm_fee_sweep(gen_random_uuid(), 'ACTOR-TEST-1',
                                     'ac700000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'FAIL: an unauthenticated caller confirmed a sweep';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.cancel_fee_sweep(gen_random_uuid(), 'because',
                                    'ac700000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'FAIL: an unauthenticated caller cancelled a sweep';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: all three refuse a caller with no identity';
END $$;

\echo '--- 2. a signed-in non-admin is refused ---'
DO $$
BEGIN
  PERFORM set_config('test.uid', 'ac700000-0000-0000-0000-0000000000b1', true);
  BEGIN
    PERFORM public.propose_fee_sweep(current_date);
    RAISE EXCEPTION 'FAIL: a sender opened a sweep';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: a sender cannot open a sweep';
END $$;

-- Tests 3 and 4 pass a sweep id that does not exist, deliberately. The actor
-- guard runs at the top of the function, before the sweep is looked up, so the
-- identity decision is observable without any accrued fees to sweep -- and the
-- ERROR TEXT is what distinguishes the two outcomes. Asserting the message
-- rather than merely "it raised" is the point: a test that accepts any
-- exception would pass just as happily on 'No such sweep', and would then have
-- proved nothing about who may act.
\echo '--- 3. an admin cannot act in another admin''s name ---'
DO $$
DECLARE v_err text;
BEGIN
  -- a1 is a genuine admin and genuinely signed in. a2 is also a genuine admin.
  -- The old check passed on exactly this input, because a2 IS an admin; what it
  -- never asked was whether a2 was the one calling.
  PERFORM set_config('test.uid', 'ac700000-0000-0000-0000-0000000000a1', true);

  BEGIN
    PERFORM public.confirm_fee_sweep(gen_random_uuid(), 'ACTOR-TEST-SPOOF',
                                     'ac700000-0000-0000-0000-0000000000a2');
    RAISE EXCEPTION 'FAIL: an admin confirmed a sweep in another admin''s name';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    v_err := SQLERRM;
  END;

  IF v_err <> 'The acting admin must be the caller' THEN
    RAISE EXCEPTION 'FAIL: refused, but not on identity -- got "%"', v_err;
  END IF;
  RAISE NOTICE 'PASS: naming an admin you are not is refused, on identity';
END $$;

\echo '--- 4. the admin who IS the caller gets past the identity guard ---'
DO $$
DECLARE v_err text; v_prop jsonb;
BEGIN
  PERFORM set_config('test.uid', 'ac700000-0000-0000-0000-0000000000a1', true);

  -- Reaches the body: an admin may ask, and is told there is nothing to sweep
  -- rather than being refused. (The real sweep, and the audit row naming the
  -- actor, are asserted in assert_escrow_lifecycle where fees have accrued.)
  v_prop := public.propose_fee_sweep(current_date);
  IF v_prop IS NULL OR NOT (v_prop ? 'created') THEN
    RAISE EXCEPTION 'FAIL: an admin did not reach the body of propose_fee_sweep';
  END IF;

  BEGIN
    PERFORM public.confirm_fee_sweep(gen_random_uuid(), 'ACTOR-TEST-OK',
                                     'ac700000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'FAIL: a sweep that does not exist was confirmed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    v_err := SQLERRM;
  END;

  -- Refused for the right reason: the sweep, not the person.
  IF v_err LIKE '%must be the caller%' OR v_err LIKE '%admin only%'
     OR v_err = 'Not authenticated' THEN
    RAISE EXCEPTION 'FAIL: the rightful admin was refused on identity -- "%"', v_err;
  END IF;
  IF v_err NOT LIKE 'No such sweep%' THEN
    RAISE EXCEPTION 'FAIL: unexpected refusal -- "%"', v_err;
  END IF;
  RAISE NOTICE 'PASS: the rightful admin passes the guard and is stopped by the sweep lookup';
END $$;
