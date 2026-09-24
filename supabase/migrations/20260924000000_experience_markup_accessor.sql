-- =============================================================================
-- platform_settings.experience_markup_bps: an admin accessor, not a wider grant
--
-- THE BUG
-- -------
-- 20260914095000 replaced the blanket `GRANT SELECT ON platform_settings` with
-- column-level grants. `authenticated` may read exactly:
--
--   id, local_buyer_fee_percent, international_buyer_fee_percent,
--   current_usd_zmw_rate, escrow_mode   (the last via 20260915080000)
--
-- That file states, and had verified, that "nothing in src/ reads any other
-- column". It was true on 2026-09-14. It stopped being true on 2026-09-21,
-- when the curated-catalogue work added `bundle_markup_bps` (renamed to
-- `experience_markup_bps` by 20260921050000) and `usePriceBook` began reading
-- it straight from the browser.
--
-- It has never been granted, so that read has never succeeded.
--
-- WHY THIS IS A MONEY BUG AND NOT A BLANK FIELD
-- ---------------------------------------------
-- usePriceBook swallows the failure. The settings read destructures `data` and
-- discards `error`, so the denial is invisible and `markupBps` keeps its
-- hardcoded initial value of 500 (5%).
--
-- `markupBps` is not decoration. On publish it computes
--
--     sell = round(cost * (1 + markupBps / 10_000))
--
-- and writes that to `items.price_zmw` -- which is what `checkout_init_atomic`
-- charges, because it prices server-side from `items.price_zmw` via
-- `unit_price_for` and ignores whatever the client sends. So every weekly price
-- run has applied 5% regardless of what an admin configured. If
-- experience_markup_bps has ever been set to anything other than 500, the house
-- shop has been selling at the wrong margin, silently, since 2026-09-21.
--
-- Anything already published carries the wrong locked_price_zmw. This migration
-- does not rewrite those rows: a published price is the audit record of what was
-- promised that week, and `experience_price_health` exists precisely so the
-- drift is visible rather than corrected away. Re-run a price week if the margin
-- needs changing.
--
-- WHY AN ACCESSOR AND NOT `GRANT SELECT (experience_markup_bps)`
-- --------------------------------------------------------------
-- Because 20260914095000 says so, and it is right:
--
--     "A client that starts needing a restricted column will get an explicit
--      permission denied rather than a wrong answer -- which is the failure
--      mode to want. The fix in that case is a SECURITY DEFINER accessor that
--      checks the caller's role, not a re-widening of this grant."
--
-- The markup KithLy adds to what it sources is the commercial model -- the same
-- category as merchant_fee_percent and fx_spread_percent, which that migration
-- was written to stop publishing. `authenticated` is every signed-in shopper and
-- every merchant, including competitors. Granting the column would hand them the
-- house margin.
--
-- Only `usePriceBook` reads it, only Admin > Price Book uses usePriceBook, and
-- admins are `authenticated` at the database level -- the admin role lives in
-- public.users.role. So the role check has to happen inside a definer function.
-- 20260914095000 anticipated exactly this ("an admin screen needing the full row
-- needs such an accessor too. None exists today"). This is that accessor.
--
-- A CORRECTION TO THE RECORD, BECAUSE SOMEONE WILL DEBUG THIS AGAIN
-- -----------------------------------------------------------------
-- 20260914095000 and 20260915080000 both predict the symptom as
-- "permission denied for column <name>". That is not what Postgres emits.
-- Verified against PostgreSQL 18.1: a SELECT naming a column the role lacks,
-- on a table where it holds column grants on OTHER columns, fails with
--
--     ERROR:  permission denied for table platform_settings
--
-- The table is named; the column is not. `SELECT *` gives the same message, as
-- does a role with no grants at all. Both files are applied and therefore
-- immutable, so the correction lives here: when that error appears, do not
-- conclude the whole table was revoked. Check the column list --
--
--     SELECT grantee, column_name FROM information_schema.column_privileges
--     WHERE table_schema = 'public' AND table_name = 'platform_settings'
--       AND privilege_type = 'SELECT' AND grantee IN ('anon', 'authenticated')
--     ORDER BY grantee, column_name;
--
-- BLAST RADIUS 🟡
-- ---------------
-- One new function, executable by authenticated, admin-gated. No column grant
-- changes, so nothing 20260914095000 closed is reopened, and no existing reader
-- is affected. The only caller is usePriceBook.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_experience_markup_bps()
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bps integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may read the experience markup';
  END IF;

  SELECT experience_markup_bps INTO v_bps
  FROM public.platform_settings
  WHERE id = 1;

  -- Null is not a number to price with. The caller must refuse to publish
  -- rather than substitute a default -- see the money note above.
  IF v_bps IS NULL THEN
    RAISE EXCEPTION 'platform_settings.experience_markup_bps is not set';
  END IF;

  RETURN v_bps;
END;
$$;

COMMENT ON FUNCTION public.admin_experience_markup_bps() IS
  'Admin-only read of platform_settings.experience_markup_bps, which is a
   commercial term and is therefore not column-granted to authenticated. Raises
   rather than returning a default: the value sets items.price_zmw on a price
   publish, so a guess becomes a real mispriced sale. See 20260924000000.';

REVOKE ALL ON FUNCTION public.admin_experience_markup_bps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_experience_markup_bps() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_experience_markup_bps() TO service_role;

-- ---------------------------------------------------------------------------
-- Assert both halves: the accessor exists and is callable, and adding it did
-- not reopen what 20260914095000 closed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leaked TEXT := '';
  v_col    TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_experience_markup_bps'
  ) THEN
    RAISE EXCEPTION 'admin_experience_markup_bps was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_settings'
      AND column_name = 'experience_markup_bps'
  ) THEN
    RAISE EXCEPTION
      'platform_settings.experience_markup_bps does not exist -- 20260921050000 should have renamed it before this runs';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'No authenticated role on this cluster; privilege assertions skipped.';
    RETURN;
  END IF;

  IF has_column_privilege('authenticated', 'public.platform_settings', 'experience_markup_bps', 'SELECT') THEN
    RAISE EXCEPTION
      'experience_markup_bps is column-granted to authenticated -- the accessor exists so that it need not be';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.admin_experience_markup_bps()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute admin_experience_markup_bps -- Admin > Price Book will fail';
  END IF;

  -- The columns the app genuinely reads must still be readable.
  FOREACH v_col IN ARRAY ARRAY[
    'id', 'local_buyer_fee_percent', 'international_buyer_fee_percent', 'current_usd_zmw_rate'
  ]
  LOOP
    IF NOT has_column_privilege('authenticated', 'public.platform_settings', v_col, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated can no longer read platform_settings.% -- pricing surfaces would break', v_col;
    END IF;
  END LOOP;

  -- And the closed ones must still be closed.
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
    RAISE EXCEPTION 'adding the markup accessor reopened: %', v_leaked;
  END IF;

  RAISE NOTICE 'experience markup readable by admins through the accessor; commercial columns still closed.';
END;
$$;
