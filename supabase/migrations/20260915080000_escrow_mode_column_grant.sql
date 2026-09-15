-- =============================================================================
-- Grant SELECT on platform_settings.escrow_mode
--
-- WHY THIS EXISTS AS A SEPARATE FILE
-- ----------------------------------
-- 20260914095000 replaced the blanket `GRANT SELECT ON platform_settings` with
-- column-level grants, so the table stops publishing merchant_fee_percent,
-- fx_spread_percent and dispute_window_minutes to anyone with a browser
-- console.
--
-- Column grants are enumerated, not wildcards. A column added AFTER that
-- migration is not covered by it, and `escrow_mode` is added by
-- 20260915000000_ledger_entries.sql -- which sorts later. So at the moment
-- 20260914095000 runs, the column does not exist and cannot be named; by the
-- time it does exist, nothing grants it.
--
-- Left alone, the symptom is not subtle: useEscrowMode and useEscrowAdmin both
-- read this column from the browser, and both would fail with
--
--     permission denied for column escrow_mode
--
-- the moment the escrow work deploys. The storefront reads escrow mode on the
-- customer dashboard and the merchant dashboard, so this is a visible break on
-- two of the three main surfaces, caused by a privilege migration written a day
-- earlier -- exactly the kind of interaction that is invisible in either file
-- on its own.
--
-- It is a separate migration rather than an edit to either neighbour because
-- both are self-asserting and both have been verified as they stand. This is
-- the smaller, more legible change.
--
-- WHY THE COLUMN IS SAFE TO EXPOSE
-- --------------------------------
-- escrow_mode is an operational switch (legacy | dual_write | escrow_v2), not
-- a commercial term. It says which settlement path is live, which the UI has
-- to know in order to stop offering a Withdraw button the database will refuse.
-- It is granted to `authenticated` only -- there is no anonymous reader, and an
-- internal mode flag is not something to hand a passer-by.
--
-- BLAST RADIUS 🟢 Additive. One column, one role.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'platform_settings'
      AND column_name = 'escrow_mode'
  ) THEN
    RAISE EXCEPTION
      'platform_settings.escrow_mode does not exist -- 20260915000000 should have added it before this migration runs';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT (escrow_mode) ON TABLE public.platform_settings TO authenticated';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Assert both halves: the column is now readable by the app, and closing the
-- gap did not reopen the one 20260914095000 was written to close.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leaked TEXT := '';
  v_col    TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'No authenticated role on this cluster; grant skipped.';
    RETURN;
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.platform_settings', 'escrow_mode', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated still cannot read escrow_mode -- useEscrowMode will fail';
  END IF;

  FOREACH v_col IN ARRAY ARRAY[
    'merchant_fee_percent', 'dispute_window_minutes', 'fx_spread_percent'
  ]
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = v_col
    );
    IF has_column_privilege('authenticated', 'public.platform_settings', v_col, 'SELECT') THEN
      v_leaked := v_leaked || v_col || ' ';
    END IF;
  END LOOP;

  IF v_leaked <> '' THEN
    RAISE EXCEPTION 'granting escrow_mode reopened: %', v_leaked;
  END IF;

  RAISE NOTICE 'escrow_mode readable by authenticated; commercial columns still closed.';
END;
$$;
