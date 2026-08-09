-- =============================================================================
-- One list of supported currencies, and a check that keeps it one
--
-- 20260809150000 added AUD to the fx_quotes CHECK constraint but left the same
-- list hardcoded inside issue_fx_quote. The constraint said AUD was allowed and
-- the function said it was not, so AUD quotes failed with "Unsupported quote
-- currency" while the schema claimed otherwise.
--
-- Two copies of one list is the same defect that produced the
-- SUCCESS/SUCCESSFUL split and the ghost overloads: it is not that either copy
-- is wrong, it is that nothing makes them move together.
--
-- fx_supported_currencies() is now the single runtime source. The CHECK keeps a
-- literal list -- a function inside a constraint is portable-dump hazard and
-- silently fails to revalidate existing rows when it changes -- so instead a CI
-- smoke check asserts the two agree. The duplication remains, but it can no
-- longer drift unnoticed, which is the property that actually matters.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fx_supported_currencies()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE
AS $$
  -- Constrained to 1/100 currencies. The quote arithmetic multiplies ZMW minor
  -- units directly by the rate, which only lands in the target's minor unit
  -- when both have two decimal places. A zero-decimal currency such as JPY
  -- would be silently 100x wrong, so adding one means changing the arithmetic,
  -- not just this list.
  SELECT ARRAY['GBP', 'USD', 'EUR', 'AUD']
$$;

COMMENT ON FUNCTION public.fx_supported_currencies() IS
  'Currencies KithLy can charge natively. The runtime source of truth; the '
  'fx_quotes CHECK constraint carries a matching literal, and '
  'ci_smoke_checks.sql fails the build if the two disagree.';

REVOKE ALL ON FUNCTION public.fx_supported_currencies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fx_supported_currencies() TO service_role;

-- ---------------------------------------------------------------------------
-- Point the issuer at it.
--
-- Patched in place from the live definition rather than retyped, so the rest of
-- the pricing logic is provably untouched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src TEXT;
  v_new TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'issue_fx_quote';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'issue_fx_quote not found';
  END IF;

  IF position('NOT IN (''GBP'', ''USD'', ''EUR'')' IN v_src) = 0 THEN
    RAISE NOTICE 'issue_fx_quote no longer carries the hardcoded list -- nothing to do';
    RETURN;
  END IF;

  v_new := replace(
    v_src,
    'IF v_currency NOT IN (''GBP'', ''USD'', ''EUR'') THEN',
    'IF NOT (v_currency = ANY (public.fx_supported_currencies())) THEN'
  );

  IF v_new = v_src THEN
    RAISE EXCEPTION 'could not rewrite the currency check in issue_fx_quote';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'issue_fx_quote now reads fx_supported_currencies()';
END $$;

REVOKE ALL ON FUNCTION public.issue_fx_quote(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_fx_quote(UUID, TEXT, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Verify: the function accepts every currency the constraint does, and the
-- constraint accepts every currency the function does.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src      TEXT;
  v_def      TEXT;
  v_currency TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'issue_fx_quote';

  IF v_src LIKE '%''GBP'', ''USD'', ''EUR''%' THEN
    RAISE EXCEPTION 'issue_fx_quote still carries its own currency list';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.fx_quotes'::regclass AND conname = 'fx_quotes_currency_supported';

  FOREACH v_currency IN ARRAY public.fx_supported_currencies() LOOP
    IF position(v_currency IN v_def) = 0 THEN
      RAISE EXCEPTION
        'fx_supported_currencies() allows % but the fx_quotes constraint does not: %',
        v_currency, v_def;
    END IF;
  END LOOP;

  RAISE NOTICE 'supported currencies: % -- function and constraint agree',
    array_to_string(public.fx_supported_currencies(), ', ');
END $$;
