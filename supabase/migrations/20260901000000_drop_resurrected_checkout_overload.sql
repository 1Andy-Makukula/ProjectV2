-- =============================================================================
-- Drop the resurrected twelve-argument checkout_init_atomic.
--
-- 20260809080000_checkout_context_object.sql collapsed this function to five
-- parameters and dropped the twelve-parameter form; ADR 0001 froze that
-- signature, and supabase/tests/ci_smoke_checks.sql pins it.
--
-- 20260810000000_item_options_pricing.sql was authored before that collapse but
-- committed after it (537fbef, 2026-08-27). Its filename sorts last, so a
-- from-empty replay re-creates the twelve-parameter form at the end of the
-- chain and re-GRANTs it to `authenticated` -- undoing, for this one function,
-- the money-RPC lockdown that 20260809050000 put in place after production was
-- found in 2026-08-09 to be exposing money RPCs to any holder of the anon key.
--
-- That is what the db-migrations job has failed on since 2026-08-27:
--   check 4 -- no money function reachable by anon/authenticated
--   check 5 -- no overloaded functions in public
--   check 7 -- checkout_init_atomic's signature is frozen (ADR 0001)
-- The first raises, ON_ERROR_STOP aborts psql, and the money-path integration
-- tests in the same job never run at all.
--
-- Dropping the twelve-parameter form removes nothing that is reachable:
-- supabase/functions/checkout-init calls the five-parameter form with
-- p_context, and both integration suites do the same. p_context carries
-- DEFAULT '{}'::jsonb, so the four-argument call in
-- tests/integration/rpc-contract.test.ts still resolves.
--
-- NOT DONE HERE: the item-options pricing that 20260810000000 wrote lives in
-- the twelve-parameter body, so it has never been reachable from the live
-- checkout path. Porting it into the p_context form is a money-path change and
-- needs its own migration and tests. This migration only stops the chain from
-- replaying an overloaded, over-granted checkout function.
-- =============================================================================

DROP FUNCTION IF EXISTS public.checkout_init_atomic(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ
);

-- Restate the surviving form's ACL. CREATE OR REPLACE preserves an ACL, but a
-- DROP and CREATE does not -- which is exactly how the leak above happened.
-- Matches 20260809140000 verbatim so a lone replay of either file agrees.
REVOKE ALL ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_init_atomic(UUID, TEXT, TEXT, JSONB, JSONB)
  TO service_role;

-- Fail loudly here rather than 200 lines into the smoke checks.
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'checkout_init_atomic';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'checkout_init_atomic is still overloaded after this migration: % signatures', v_count;
  END IF;
END $$;
