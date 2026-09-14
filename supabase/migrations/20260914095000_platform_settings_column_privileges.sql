-- =============================================================================
-- platform_settings: stop publishing the commercial model
--
-- THE PROBLEM
-- -----------
-- 20260620000000 gave this table `FOR SELECT USING (true)` and it has stayed
-- that way through nineteen added columns. Any visitor -- signed in or not --
-- can read the whole settings row, which now includes:
--
--   merchant_fee_percent            what the platform takes from each merchant
--   dispute_window_minutes          how long before settlement is irreversible
--   fx_spread_percent               the margin taken on currency conversion
--   expiry_sender_refund_percent    what is withheld on an expired voucher
--   settlement_flag_failure_threshold, payout_max_attempts,
--   reconciliation_tolerance_ngwee  operational tolerances
--
-- Two different problems in one row. The fee and spread columns are the
-- commercial model, readable by any competitor with a browser console. The
-- window and threshold columns are an attacker's timetable: dispute_window_
-- minutes says precisely how long there is to act before a fraudulent
-- redemption settles and the money is gone.
--
-- WHY COLUMN GRANTS AND NOT RLS
-- -----------------------------
-- RLS is row-level, and this table has exactly one row -- there is no
-- predicate that separates "the fee percent" from "the dispute window". A
-- policy can only allow or deny the whole row. Column-level GRANT is the
-- matching tool, and PostgREST honours it: a select naming a column the role
-- lacks is refused rather than silently blanked.
--
-- WHAT STAYS READABLE, AND WHY EACH ONE
-- -------------------------------------
-- Derived from what the client actually reads, not from what looks harmless.
-- Every caller was checked:
--
--   id                              every read filters .eq('id', 1)
--   local_buyer_fee_percent         usePlatformPricing — shown to the buyer
--   international_buyer_fee_percent usePlatformPricing — shown to the buyer
--   current_usd_zmw_rate            AdminItemForm; also a public FX reference
--   escrow_mode                     useEscrowMode / useEscrowAdmin
--
-- The buyer fee percents are disclosed to the buyer at checkout by design --
-- that is the transparency the table was created for (20260620000000 is named
-- kyc_and_transparency). Hiding them would break the disclosure, not improve
-- it.
--
-- `current_usd_zmw_rate` and `escrow_mode` go to signed-in users only. Neither
-- is secret, but neither has an anonymous reader either, and an internal mode
-- flag is not something to hand a passer-by.
--
-- Nothing in src/ reads any other column. Verified by search: the only hits
-- for merchant_fee_percent, dispute_window_minutes, reconciliation_tolerance_
-- ngwee and low_stock_percent outside migrations are in the generated
-- src/types/database.types.ts, which describes the schema and does not query
-- it. The Edge Functions read this table under the service role, which is
-- unaffected by column grants.
--
-- BLAST RADIUS 🟡
-- ---------------
-- A client that starts needing a restricted column will get an explicit
-- "permission denied for column" rather than a wrong answer -- which is the
-- failure mode to want. The fix in that case is a SECURITY DEFINER accessor
-- that checks the caller's role, not a re-widening of this grant.
--
-- Admins are `authenticated` at the database level -- the admin role lives in
-- public.users.role, not in a Postgres role -- so an admin screen needing the
-- full row needs such an accessor too. None exists today because no screen
-- reads those columns.
-- =============================================================================

-- Column lists are intersected with what actually exists, not hardcoded.
--
-- `escrow_mode` is added by 20260915000000_ledger_entries.sql, which sorts
-- AFTER this file. Naming it in a plain GRANT here fails with "column
-- escrow_mode does not exist" on every database where the escrow work has not
-- been applied -- which is all of them today, since that migration is still
-- staged. So the list is intersected with the live schema and the column is
-- simply skipped when absent.
--
-- CONSEQUENCE, AND IT IS NOT AUTOMATIC: nothing re-runs this migration when
-- the column later appears. Whoever cuts the escrow work over must grant it
-- in the same migration that adds it --
--
--     GRANT SELECT (escrow_mode) ON public.platform_settings TO authenticated;
--
-- otherwise useEscrowMode and useEscrowAdmin will read it as "permission
-- denied for column escrow_mode" the moment escrow ships. The escrow-mode
-- entry is kept in the list below so that this file still documents the
-- intended end state rather than silently forgetting the column exists.
--
-- The same intersection protects the other direction: a column dropped later
-- does not turn this migration into the reason a schema change fails.
DO $$
DECLARE
  v_anon_cols          TEXT;
  v_authenticated_cols TEXT;

BEGIN
  SELECT string_agg(quote_ident(c), ', ')
    INTO v_anon_cols
  FROM unnest(ARRAY['id', 'local_buyer_fee_percent', 'international_buyer_fee_percent']) AS c
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = c
  );

  SELECT string_agg(quote_ident(c), ', ')
    INTO v_authenticated_cols
  FROM unnest(ARRAY[
    'id', 'local_buyer_fee_percent', 'international_buyer_fee_percent',
    'current_usd_zmw_rate', 'escrow_mode'
  ]) AS c
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = c
  );

  IF v_anon_cols IS NULL OR v_authenticated_cols IS NULL THEN
    RAISE EXCEPTION 'platform_settings has none of the expected buyer-facing columns';
  END IF;

  -- PUBLIC first: a grant to PUBLIC would make the per-role revokes below
  -- cosmetic, since every role inherits it.
  EXECUTE 'REVOKE SELECT ON TABLE public.platform_settings FROM PUBLIC';

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE SELECT ON TABLE public.platform_settings FROM anon';
    EXECUTE format('GRANT SELECT (%s) ON TABLE public.platform_settings TO anon', v_anon_cols);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE SELECT ON TABLE public.platform_settings FROM authenticated';
    EXECUTE format('GRANT SELECT (%s) ON TABLE public.platform_settings TO authenticated', v_authenticated_cols);
  END IF;

  -- Unchanged: the service role reads and writes the whole row, and the admin
  -- UPDATE policy from 20260620000000 still governs writes.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.platform_settings TO service_role';
  END IF;
END;
$$;

COMMENT ON TABLE public.platform_settings IS
  'Single-row platform configuration. Column-level SELECT grants since '
  '20260914095000: buyer-facing fee percents are public by design, the '
  'commercial model (merchant fee, FX spread) and the operational timings '
  '(dispute window, payout thresholds) are not.';

-- ---------------------------------------------------------------------------
-- Assert the boundary in both directions.
--
-- A grant migration that only checks what it opened is half a test: the
-- failure that matters is a sensitive column still being readable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role      TEXT;
  v_col       TEXT;
  v_leaked    TEXT := '';
  v_broke     TEXT := '';
  -- Columns that must never be readable without the service role.
  v_secret    TEXT[] := ARRAY[
    'merchant_fee_percent', 'dispute_window_minutes', 'fx_spread_percent',
    'expiry_sender_refund_percent', 'payout_max_attempts',
    'settlement_flag_failure_threshold', 'reconciliation_tolerance_ngwee'
  ];
  -- Columns the application genuinely reads and must keep.
  v_needed    TEXT[] := ARRAY[
    'id', 'local_buyer_fee_percent', 'international_buyer_fee_percent'
  ];
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role);

    FOREACH v_col IN ARRAY v_secret
    LOOP
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings'
          AND column_name = v_col
      );
      IF has_column_privilege(v_role, 'public.platform_settings', v_col, 'SELECT') THEN
        v_leaked := v_leaked || format('%s.%s ', v_role, v_col);
      END IF;
    END LOOP;

    FOREACH v_col IN ARRAY v_needed
    LOOP
      IF NOT has_column_privilege(v_role, 'public.platform_settings', v_col, 'SELECT') THEN
        v_broke := v_broke || format('%s.%s ', v_role, v_col);
      END IF;
    END LOOP;
  END LOOP;

  IF v_leaked <> '' THEN
    RAISE EXCEPTION 'platform_settings still exposes: %', v_leaked;
  END IF;
  IF v_broke <> '' THEN
    RAISE EXCEPTION 'platform_settings no longer exposes columns the app needs: % -- checkout pricing would break', v_broke;
  END IF;

  RAISE NOTICE 'platform_settings: commercial and operational columns closed, buyer-facing pricing still readable.';
END;
$$;
