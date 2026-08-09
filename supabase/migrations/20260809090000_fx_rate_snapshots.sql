-- =============================================================================
-- FX layer 1: rates are pulled on a schedule, never during checkout
--
-- WHY NOT FETCH AT CHECKOUT
-- -------------------------
-- The existing fx-rate-lock calls an exchange-rate API while a buyer waits at
-- the payment step, and falls back to rates hardcoded in source when that call
-- fails. Both halves are wrong. A third party's latency and uptime should not
-- sit in the checkout path at all, and a constant compiled into a function is
-- the worst possible fallback: it is invisible when it goes stale, and it goes
-- stale silently.
--
-- Rates are now pulled hourly into this table and checkout reads the table.
-- Checkout never waits on anyone, never fails because a rate provider is down,
-- and always knows exactly how old the number it is using is.
--
-- This is the same shape as the payout sweeper and the redemption sweeper: a
-- scheduled job doing the outside-world work, and the request path reading
-- what it left behind.
--
-- WHY A TABLE AND NOT A CACHE
-- ---------------------------
-- Append-only, never overwritten. The cache is a side effect; the point is the
-- history. Reconciling what a buyer was quoted against what the payment
-- processor actually settled requires knowing the rate that was live at the
-- moment of the quote, months later. A cache that overwrites cannot answer
-- that, and a dispute is exactly when it gets asked.
--
-- WHY THE RATES ARE USD-BASED
-- ---------------------------
-- OpenExchangeRates only allows base switching on paid plans -- verified
-- against the live account, which returns 403 not_allowed for base=ZMW. So the
-- payload is USD-based and every rate this platform needs is a cross-rate
-- computed through USD. That is not a workaround; it is the shape of the free
-- tier, and fx_zmw_rate below is where it is handled once.
--
-- QUOTA
-- -----
-- The free tier allows ~1,000 calls/month. Hourly is 720, which fits with room
-- to spare, and is deliberately decoupled from traffic: a per-checkout fetch
-- would scale with orders and exhaust the month during the first good week.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fx_rate_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /** Always 'USD' on the current plan. Recorded rather than assumed. */
  base_currency  TEXT NOT NULL,

  /**
   * The provider's rates, base-relative. Stored whole rather than as extracted
   * columns: a currency added later needs no migration, and a dispute about an
   * old quote can be answered from exactly what the provider said at the time.
   */
  rates          JSONB NOT NULL,

  /**
   * When the PROVIDER published these rates, not when we fetched them. The two
   * differ, and it is the former that says whether a rate is stale -- a fetch
   * that succeeds against an hours-old publication is still an hours-old rate.
   */
  oer_timestamp  TIMESTAMPTZ NOT NULL,

  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  /** 'openexchangerates' today. Present so a provider change stays auditable. */
  rate_source    TEXT NOT NULL DEFAULT 'openexchangerates',

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fx_rate_snapshots_base_check CHECK (base_currency = upper(base_currency)),
  CONSTRAINT fx_rate_snapshots_rates_check CHECK (jsonb_typeof(rates) = 'object')
);

-- The only query that matters on the hot path: newest first.
CREATE INDEX IF NOT EXISTS fx_rate_snapshots_recent_idx
  ON public.fx_rate_snapshots (oer_timestamp DESC);

ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

-- No policies: RLS enabled with none defined denies anon and authenticated
-- outright. service_role bypasses RLS and is the only writer. Rates reach the
-- browser through a quote, not by reading this table.

COMMENT ON TABLE public.fx_rate_snapshots IS
  'Hourly exchange-rate pulls. Append-only: checkout reads the newest row and '
  'never calls a rate provider itself. History is retained because reconciling '
  'a months-old quote against what the processor settled needs the rate that '
  'was live when the quote was issued.';

-- ---------------------------------------------------------------------------
-- The cross-rate, computed in one place.
--
-- Returns how many units of p_target one ZMW buys, derived through the USD
-- base. Defined once so no caller has to remember which way round the division
-- goes -- getting that backwards silently prices every international order in
-- the buyer's favour, and it would not look obviously wrong on a receipt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_zmw_rate(p_target_currency TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rates  JSONB;
  v_target NUMERIC;
  v_zmw    NUMERIC;
BEGIN
  SELECT rates INTO v_rates
  FROM public.fx_rate_snapshots
  ORDER BY oer_timestamp DESC
  LIMIT 1;

  IF v_rates IS NULL THEN
    RAISE EXCEPTION 'No FX snapshot available -- has the fx-snapshot job run?';
  END IF;

  v_target := (v_rates ->> upper(p_target_currency))::NUMERIC;
  v_zmw    := (v_rates ->> 'ZMW')::NUMERIC;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Snapshot carries no rate for %', upper(p_target_currency);
  END IF;

  -- Guarded rather than assumed: a zero or absent ZMW rate would divide by zero
  -- or return NULL, and a NULL rate flowing into a price is worse than a loud
  -- failure at the point the snapshot is read.
  IF v_zmw IS NULL OR v_zmw <= 0 THEN
    RAISE EXCEPTION 'Snapshot carries no usable ZMW rate (got %)', v_zmw;
  END IF;

  -- Both are "units per USD", so the USD cancels: target-per-ZMW.
  RETURN v_target / v_zmw;
END;
$$;

-- ---------------------------------------------------------------------------
-- How old the newest snapshot is, by the provider's own publication time.
--
-- NULL when there is no snapshot at all, which callers must treat as "cannot
-- quote" rather than "fresh".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_snapshot_age_minutes()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (EXTRACT(EPOCH FROM (now() - oer_timestamp)) / 60)::INTEGER
  FROM public.fx_rate_snapshots
  ORDER BY oer_timestamp DESC
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- Pricing policy lives beside the fees, not in a deploy artifact.
--
-- The spread was previously a constant in an edge function while the fee was a
-- database row, so no single query could answer "what does a diaspora buyer
-- pay?" -- which is how a 30% margin sat on top of a 10% fee unnoticed. Both
-- knobs now live here, changeable with an UPDATE and no redeploy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS fx_spread_percent NUMERIC NOT NULL DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS fx_max_snapshot_age_minutes INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS fx_quote_ttl_seconds INTEGER NOT NULL DEFAULT 120;

COMMENT ON COLUMN public.platform_settings.fx_spread_percent IS
  'Applied as mid x (1 + spread/100). The ZMW basket is the pinned side -- the '
  'merchant is owed a fixed kwacha amount regardless of sterling -- so the '
  'spread must INCREASE what the buyer pays. Deducting it would lose money on '
  'every international order.';

COMMENT ON COLUMN public.platform_settings.fx_max_snapshot_age_minutes IS
  'Beyond this, refuse to issue a quote rather than pricing against a stale '
  'rate. Three hours allows two consecutive hourly pulls to fail before '
  'international checkout stops, which is the intended trade: declining is '
  'recoverable, quoting at a rate nobody can honour is not.';

COMMENT ON COLUMN public.platform_settings.fx_quote_ttl_seconds IS
  'How long an issued quote stays valid. Long enough to complete a payment, '
  'short enough that the platform is not holding an open option on the rate.';

-- ---------------------------------------------------------------------------
-- The agreed diaspora fee.
--
-- 10.00 was the default; the agreed figure is 8. With Flutterwave taking 4.8%
-- of the charge, 8% leaves roughly 3.2% plus the ~1.5% spread -- which is why
-- the spread is load-bearing revenue here rather than a hedge, and why the
-- variance tracking that follows is not optional.
-- ---------------------------------------------------------------------------
UPDATE public.platform_settings
SET international_buyer_fee_percent = 8.00
WHERE id = 1;

-- ---------------------------------------------------------------------------
-- Grants. Both helpers are read-only and disclose a public exchange rate, but
-- they are reached through the quote path rather than the browser.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fx_zmw_rate(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_zmw_rate(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fx_snapshot_age_minutes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_snapshot_age_minutes() TO service_role;

-- ---------------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rate NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fx_rate_snapshots'
  ) THEN
    RAISE EXCEPTION 'fx_rate_snapshots was not created';
  END IF;

  IF (SELECT international_buyer_fee_percent FROM public.platform_settings WHERE id = 1) <> 8.00 THEN
    RAISE EXCEPTION 'international_buyer_fee_percent was not set to 8';
  END IF;

  -- Prove the cross-rate arithmetic on a known snapshot, then remove it. Real
  -- values from the live provider: 1 USD buys 0.742583 GBP and 18.818492 ZMW,
  -- so one ZMW buys 0.742583/18.818492 = 0.03946027 GBP, i.e. 0.039460 to
  -- six places.
  INSERT INTO public.fx_rate_snapshots (base_currency, rates, oer_timestamp, rate_source)
  VALUES ('USD', '{"GBP":0.742583,"ZMW":18.818492}'::JSONB, now(), 'verification-probe');

  v_rate := public.fx_zmw_rate('GBP');

  IF round(v_rate, 6) <> 0.039460 THEN
    RAISE EXCEPTION 'Cross-rate is wrong: expected 0.039460 GBP per ZMW, got %', round(v_rate, 6);
  END IF;

  DELETE FROM public.fx_rate_snapshots WHERE rate_source = 'verification-probe';

  RAISE NOTICE 'fx snapshots ready; cross-rate verified at % GBP per ZMW', round(v_rate, 6);
END $$;
