-- =============================================================================
-- Two paths for a diaspora buyer, and they must not be confusable
--
-- NATIVE (preferred): the buyer is charged in their own currency against a
-- locked quote. KithLy performs the conversion and captures the spread.
--
-- FALLBACK: the currency is not enabled for collection, so the card is charged
-- in ZMW and the buyer's own bank converts. KithLy takes no FX risk and earns
-- no spread.
--
-- The fallback is not a degraded version of the same thing -- it is a different
-- commercial arrangement, and the UI has to say so. A buyer who is quoted "A$88"
-- and then sees "ZMW 1,080" on their statement does not think "ah, the exchange
-- rate"; they think they have been defrauded, and they call their bank. A
-- chargeback costs the platform the goods, the fee and the dispute. So the
-- fallback shows the kwacha total as the real figure and the local amount as an
-- estimate, explicitly labelled.
--
-- WHY AN ESTIMATE IS NOT A QUOTE
-- ------------------------------
-- issue_fx_quote returns a commitment: locked, single-use, expiring, and
-- enforceable at checkout. This returns a number to put on a screen. Nothing
-- about it is binding, because the rate the buyer actually gets is set by their
-- bank hours later and KithLy never sees it.
--
-- They are deliberately separate functions with different return shapes rather
-- than one function with a flag. A flag is how an estimate ends up being
-- charged: someone reads `amount` from the wrong branch and the buyer is billed
-- against a number nobody guaranteed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. AUD joins the natively-supported set.
--
--    Australia is a named target market alongside the UK and the USA. EUR is
--    kept although it is not currently a target: it is already built, already
--    tested, and removing a working currency to tidy a list is churn.
--
--    Still 1/100 currencies only -- see the minor-unit note on fx_quotes. AUD
--    qualifies; a zero-decimal currency like JPY would be 100x wrong and is
--    excluded by this same constraint.
-- ---------------------------------------------------------------------------
ALTER TABLE public.fx_quotes
  DROP CONSTRAINT IF EXISTS fx_quotes_currency_supported;

ALTER TABLE public.fx_quotes
  ADD CONSTRAINT fx_quotes_currency_supported
  CHECK (target_currency IN ('GBP', 'USD', 'EUR', 'AUD'));

-- ---------------------------------------------------------------------------
-- 2. What a fallback buyer is likely to pay, and who decides it.
--
--    A bank's card conversion typically costs 2-4% over mid: the network rate
--    plus a foreign transaction fee. 3% is the middle of that and configurable,
--    because it is an assumption about somebody else's pricing and will need
--    revising when real buyers report what they were actually charged.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS fx_fallback_bank_fee_percent NUMERIC NOT NULL DEFAULT 3.00;

COMMENT ON COLUMN public.platform_settings.fx_fallback_bank_fee_percent IS
  'Assumed cost of a buyer''s own bank converting a ZMW card charge, used only '
  'to show an estimate when native collection is unavailable. An assumption '
  'about a third party''s pricing, not a figure KithLy controls or earns -- '
  'revise it when real buyers report what they were charged.';

-- ---------------------------------------------------------------------------
-- 3. The estimate.
--
--    Returns is_estimate: true and no quote id, no expiry and no rate that
--    anything downstream could bind to. There is deliberately nothing here that
--    checkout could accept.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_estimate_local_cost(
  p_target_currency  TEXT,
  p_total_zmw_minor  INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_currency  TEXT := upper(btrim(coalesce(p_target_currency, '')));
  v_mid       NUMERIC;
  v_bank_fee  NUMERIC;
  v_age       INTEGER;
  v_max_age   INTEGER;
  v_estimate  INTEGER;
BEGIN
  IF p_total_zmw_minor IS NULL OR p_total_zmw_minor <= 0 THEN
    RAISE EXCEPTION 'Total must be positive, got %', p_total_zmw_minor;
  END IF;

  SELECT fx_fallback_bank_fee_percent, fx_max_snapshot_age_minutes
    INTO v_bank_fee, v_max_age
  FROM public.platform_settings WHERE id = 1;

  v_age := public.fx_snapshot_age_minutes();

  -- No rate, or one too old to be worth showing, means no estimate. Returned
  -- rather than raised: the caller's job is to fall back to showing kwacha
  -- alone, which is complete on its own. An international checkout must not
  -- fail because a decorative figure could not be produced.
  IF v_age IS NULL OR v_age > v_max_age THEN
    RETURN jsonb_build_object(
      'is_estimate', true,
      'available', false,
      'reason', CASE WHEN v_age IS NULL THEN 'no rate snapshot' ELSE 'rate too old' END,
      'total_zmw_minor', p_total_zmw_minor
    );
  END IF;

  BEGIN
    v_mid := public.fx_zmw_rate(v_currency);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object(
      'is_estimate', true,
      'available', false,
      'reason', 'no rate for ' || v_currency,
      'total_zmw_minor', p_total_zmw_minor
    );
  END;

  -- Mid rate plus the assumed bank cost. KithLy's own spread is deliberately
  -- absent: in this path KithLy performs no conversion and earns nothing from
  -- one, so adding it would inflate the estimate against the buyer for revenue
  -- that is never collected.
  v_estimate := ceil(p_total_zmw_minor * v_mid * (1 + (v_bank_fee / 100.0)))::INTEGER;

  RETURN jsonb_build_object(
    'is_estimate', true,
    'available', true,
    -- The figure the buyer is actually charged, and the one that appears on
    -- their statement. First, because it is the only number that is certain.
    'total_zmw_minor', p_total_zmw_minor,
    'estimated_currency', v_currency,
    'estimated_amount_minor', v_estimate,
    'assumed_bank_fee_percent', v_bank_fee,
    'rate_age_minutes', v_age
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fx_estimate_local_cost(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_estimate_local_cost(TEXT, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Verify both paths, including that they cannot be confused.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_est JSONB;
  v_aud_ok BOOLEAN;
BEGIN
  -- AUD must now be accepted by the constraint.
  BEGIN
    ALTER TABLE public.fx_quotes ADD CONSTRAINT tmp_aud_probe CHECK (target_currency <> 'AUD') NOT VALID;
    ALTER TABLE public.fx_quotes DROP CONSTRAINT tmp_aud_probe;
    v_aud_ok := TRUE;
  EXCEPTION WHEN others THEN
    v_aud_ok := FALSE;
  END;
  IF NOT v_aud_ok THEN
    RAISE EXCEPTION 'could not verify the AUD constraint change';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fx_rate_snapshots) THEN
    RAISE NOTICE 'no snapshot; skipping the estimate probe';
    RETURN;
  END IF;

  v_est := public.fx_estimate_local_cost('AUD', 108000);

  -- The estimate must never look like something spendable.
  IF v_est ? 'quote_id' OR v_est ? 'expires_at' OR v_est ? 'applied_rate' THEN
    RAISE EXCEPTION 'the estimate exposes fields that make it look like a quote: %', v_est;
  END IF;

  IF (v_est->>'is_estimate')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'the estimate is not flagged as one';
  END IF;

  IF (v_est->>'available')::BOOLEAN THEN
    IF (v_est->>'total_zmw_minor')::INTEGER <> 108000 THEN
      RAISE EXCEPTION 'the estimate lost the kwacha total, which is the certain figure';
    END IF;
    RAISE NOTICE 'fallback estimate: K% charged, about % % (assuming %%% bank fee)',
      108000 / 100.0,
      (v_est->>'estimated_amount_minor')::INTEGER / 100.0,
      v_est->>'estimated_currency',
      v_est->>'assumed_bank_fee_percent';
  ELSE
    RAISE NOTICE 'estimate unavailable (%), which callers must treat as "show kwacha only"',
      v_est->>'reason';
  END IF;

  RAISE NOTICE 'AUD supported natively; fallback estimate is structurally not a quote';
END $$;
