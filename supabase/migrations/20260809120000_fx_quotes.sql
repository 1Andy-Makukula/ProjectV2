-- =============================================================================
-- FX layer 3: a quote is a single-use, expiring commitment
--
-- WHY THIS EXISTS
-- ---------------
-- The old fx-rate-lock computed a price in memory and handed it to a browser.
-- Nothing was persisted, so checkout had nothing to validate against: a client
-- could send back any figure it liked, and the "lock" locked nothing. Your own
-- CLAUDE.md says client-side rate timing must be server-validated -- this is
-- the record that makes that possible.
--
-- A quote answers one question and then stops existing: "if this buyer pays for
-- this exact basket, in this currency, within the next two minutes, what do
-- they owe?"
--
-- THE FOUR PROPERTIES THAT MATTER
-- -------------------------------
-- 1. Bound to a basket total. A quote issued against a K10 basket cannot be
--    spent on a K10,000 one. Checkout compares total_zmw_minor against the
--    server-derived total, not against anything the client sends.
--
-- 2. Single-use. consumed_by_transaction_id is UNIQUE, so two concurrent
--    checkouts cannot both spend one quote -- the second loses on the index
--    rather than on a check-then-act race.
--
-- 3. Expiring. A quote outliving its rate is a free option written against the
--    platform: a buyer could hold it, wait for sterling to move, and pay at the
--    old rate.
--
-- 4. Policy snapshotted, never joined. spread_percent_applied and
--    fee_percent_applied are copied in at issue time. Change the spread next
--    month and every historical quote must still explain itself -- a system
--    that joins to live settings can never reconstruct why it charged what it
--    charged, and that question always arrives months later attached to a
--    dispute.
--
-- MINOR UNITS
-- -----------
-- ZMW is stored in ngwee, 1/100 of a kwacha. GBP, USD and EUR are all 1/100
-- currencies too, so minor x rate lands directly in the target's minor unit
-- with no scaling. That convenience is NOT general -- JPY has no minor unit and
-- would silently come out 100x wrong -- so the supported set is constrained
-- below rather than left as an assumption someone later fails to notice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fx_quotes (
  quote_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id                    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  /** The snapshot this was priced from, so the quote is reproducible. */
  snapshot_id                 UUID NOT NULL REFERENCES public.fx_rate_snapshots(id),

  target_currency             TEXT NOT NULL,

  /**
   * What the quote was issued against, in ngwee. The anti-swap check: checkout
   * refuses unless this equals the total it derived itself from the cart.
   */
  basket_zmw_minor            INTEGER NOT NULL,
  platform_fee_minor          INTEGER NOT NULL,
  total_zmw_minor             INTEGER NOT NULL,

  /** Mid-market, and mid x (1 + spread). Both kept so the margin is auditable. */
  mid_rate                    NUMERIC NOT NULL,
  applied_rate                NUMERIC NOT NULL,

  /** Policy as it stood at issue. Never re-derived from platform_settings. */
  spread_percent_applied      NUMERIC NOT NULL,
  fee_percent_applied         NUMERIC NOT NULL,

  /** What the buyer is asked to pay, in the target currency's minor unit. */
  quoted_amount_minor         INTEGER NOT NULL,

  /** Provider publication time, and how stale it already was when quoted. */
  oer_timestamp               TIMESTAMPTZ NOT NULL,
  snapshot_age_minutes_at_issue INTEGER NOT NULL,

  issued_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                  TIMESTAMPTZ NOT NULL,

  /**
   * UNIQUE, so single use is enforced by the index rather than by a check the
   * caller might race. NULL until spent.
   */
  consumed_by_transaction_id  UUID UNIQUE,
  consumed_at                 TIMESTAMPTZ,

  CONSTRAINT fx_quotes_currency_supported
    CHECK (target_currency IN ('GBP', 'USD', 'EUR')),
  CONSTRAINT fx_quotes_amounts_positive
    CHECK (basket_zmw_minor > 0 AND total_zmw_minor > 0 AND quoted_amount_minor > 0),
  CONSTRAINT fx_quotes_fee_non_negative
    CHECK (platform_fee_minor >= 0),
  CONSTRAINT fx_quotes_total_is_basket_plus_fee
    CHECK (total_zmw_minor = basket_zmw_minor + platform_fee_minor),
  CONSTRAINT fx_quotes_rates_positive
    CHECK (mid_rate > 0 AND applied_rate > 0),
  -- The spread must never work in the buyer's favour. This is the direction
  -- error that would otherwise lose money on every order while looking normal.
  CONSTRAINT fx_quotes_spread_increases_price
    CHECK (applied_rate >= mid_rate),
  CONSTRAINT fx_quotes_expiry_after_issue
    CHECK (expires_at > issued_at),
  CONSTRAINT fx_quotes_consumed_consistently
    CHECK ((consumed_by_transaction_id IS NULL) = (consumed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS fx_quotes_buyer_idx
  ON public.fx_quotes (buyer_id, issued_at DESC);

-- Unspent and still valid: the only rows checkout ever looks for.
CREATE INDEX IF NOT EXISTS fx_quotes_live_idx
  ON public.fx_quotes (expires_at)
  WHERE consumed_by_transaction_id IS NULL;

ALTER TABLE public.fx_quotes ENABLE ROW LEVEL SECURITY;

-- No policies. Quotes are issued and consumed through SECURITY DEFINER
-- functions; the browser receives a quote as a return value, never by reading
-- this table. A buyer being able to SELECT here would expose the platform's
-- mid-rate and margin on every order.

COMMENT ON TABLE public.fx_quotes IS
  'Single-use, expiring FX commitments. Bound to a basket total so a quote '
  'cannot be moved to a different order, and carrying the pricing policy as it '
  'stood at issue so a historical quote can still explain itself after the '
  'policy changes.';

-- ---------------------------------------------------------------------------
-- Issue a quote.
--
-- Refuses rather than improvises. No snapshot, a stale snapshot, an unsupported
-- currency or a nonsensical basket all stop here -- declining an international
-- checkout is recoverable, quoting a rate the platform cannot honour is not.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_fx_quote(
  p_buyer_id         UUID,
  p_target_currency  TEXT,
  p_basket_zmw_minor INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_currency    TEXT := upper(btrim(coalesce(p_target_currency, '')));
  v_snapshot    RECORD;
  v_age_minutes INTEGER;
  v_max_age     INTEGER;
  v_spread      NUMERIC;
  v_fee_percent NUMERIC;
  v_ttl_seconds INTEGER;
  v_mid         NUMERIC;
  v_applied     NUMERIC;
  v_fee_minor   INTEGER;
  v_total_minor INTEGER;
  v_quoted      INTEGER;
  v_quote_id    UUID;
  v_expires_at  TIMESTAMPTZ;
BEGIN
  IF p_basket_zmw_minor IS NULL OR p_basket_zmw_minor <= 0 THEN
    RAISE EXCEPTION 'Basket total must be positive, got %', p_basket_zmw_minor;
  END IF;

  IF v_currency NOT IN ('GBP', 'USD', 'EUR') THEN
    RAISE EXCEPTION 'Unsupported quote currency: %', v_currency;
  END IF;

  SELECT id, oer_timestamp, rates INTO v_snapshot
  FROM public.fx_rate_snapshots
  ORDER BY oer_timestamp DESC
  LIMIT 1;

  IF v_snapshot.id IS NULL THEN
    RAISE EXCEPTION 'No FX snapshot available -- cannot quote';
  END IF;

  SELECT fx_spread_percent, international_buyer_fee_percent,
         fx_max_snapshot_age_minutes, fx_quote_ttl_seconds
    INTO v_spread, v_fee_percent, v_max_age, v_ttl_seconds
  FROM public.platform_settings WHERE id = 1;

  v_age_minutes := (EXTRACT(EPOCH FROM (now() - v_snapshot.oer_timestamp)) / 60)::INTEGER;

  -- Judged on the provider's publication time, not on when it was fetched: a
  -- successful fetch of an hours-old publication is still an hours-old rate.
  IF v_age_minutes > v_max_age THEN
    RAISE EXCEPTION
      'FX rates are % minutes old (limit %) -- refusing to quote. Has the fx-snapshot job run?',
      v_age_minutes, v_max_age;
  END IF;

  v_mid := public.fx_zmw_rate(v_currency);

  -- mid x (1 + spread). The ZMW side is pinned -- the merchant is owed a fixed
  -- kwacha amount whatever sterling does -- so the spread must INCREASE what
  -- the buyer pays. Deducting it here loses money on every order.
  v_applied := v_mid * (1 + (v_spread / 100.0));

  v_fee_minor := round(p_basket_zmw_minor * v_fee_percent / 100.0)::INTEGER;
  v_total_minor := p_basket_zmw_minor + v_fee_minor;

  -- Rounded up, in the platform's favour. A half-ngwee rounded down on every
  -- order is a slow leak, and the buyer is quoted an exact figure either way.
  -- ZMW/GBP/USD/EUR are all 1/100 currencies, so this stays in minor units.
  v_quoted := ceil(v_total_minor * v_applied)::INTEGER;

  IF v_quoted <= 0 THEN
    RAISE EXCEPTION 'Computed a non-positive quote (%) -- refusing', v_quoted;
  END IF;

  v_expires_at := now() + make_interval(secs => v_ttl_seconds);

  INSERT INTO public.fx_quotes (
    buyer_id, snapshot_id, target_currency,
    basket_zmw_minor, platform_fee_minor, total_zmw_minor,
    mid_rate, applied_rate, spread_percent_applied, fee_percent_applied,
    quoted_amount_minor, oer_timestamp, snapshot_age_minutes_at_issue, expires_at
  )
  VALUES (
    p_buyer_id, v_snapshot.id, v_currency,
    p_basket_zmw_minor, v_fee_minor, v_total_minor,
    v_mid, v_applied, v_spread, v_fee_percent,
    v_quoted, v_snapshot.oer_timestamp, v_age_minutes, v_expires_at
  )
  RETURNING quote_id INTO v_quote_id;

  -- mid_rate is deliberately absent from the response. The buyer needs the
  -- price and the rate they are getting; the platform's margin is not theirs
  -- to see, and it is on the row for reconciliation.
  RETURN jsonb_build_object(
    'quote_id', v_quote_id,
    'target_currency', v_currency,
    'quoted_amount_minor', v_quoted,
    'total_zmw_minor', v_total_minor,
    'basket_zmw_minor', p_basket_zmw_minor,
    'platform_fee_minor', v_fee_minor,
    'applied_rate', v_applied,
    'expires_at', v_expires_at,
    'rate_age_minutes', v_age_minutes
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Spend a quote against a transaction.
--
-- Separate from issuing, and called inside the checkout transaction so a quote
-- and the order it paid for commit or roll back together.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_fx_quote(
  p_quote_id             UUID,
  p_buyer_id             UUID,
  p_transaction_id       UUID,
  p_expected_total_minor INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_quote RECORD;
BEGIN
  -- Locked, so two checkouts racing the same quote serialise here and the
  -- second sees it already consumed rather than both proceeding.
  SELECT * INTO v_quote
  FROM public.fx_quotes
  WHERE quote_id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FX quote not found';
  END IF;

  IF v_quote.consumed_by_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'FX quote has already been used';
  END IF;

  -- Checked before expiry so a stolen quote reports the right reason.
  IF v_quote.buyer_id <> p_buyer_id THEN
    RAISE EXCEPTION 'FX quote belongs to a different buyer';
  END IF;

  IF now() > v_quote.expires_at THEN
    RAISE EXCEPTION 'FX quote expired at %', v_quote.expires_at;
  END IF;

  -- The anti-swap check. p_expected_total_minor is the server's own figure,
  -- derived from the cart -- never anything the client supplied.
  IF v_quote.total_zmw_minor <> p_expected_total_minor THEN
    RAISE EXCEPTION
      'FX quote was issued for a total of % ngwee but this order is % ngwee',
      v_quote.total_zmw_minor, p_expected_total_minor;
  END IF;

  UPDATE public.fx_quotes
  SET consumed_by_transaction_id = p_transaction_id,
      consumed_at = now()
  WHERE quote_id = p_quote_id;

  RETURN jsonb_build_object(
    'quote_id', v_quote.quote_id,
    'target_currency', v_quote.target_currency,
    'quoted_amount_minor', v_quote.quoted_amount_minor,
    'applied_rate', v_quote.applied_rate,
    'total_zmw_minor', v_quote.total_zmw_minor
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: money-path functions, service_role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.issue_fx_quote(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_fx_quote(UUID, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.consume_fx_quote(UUID, UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_fx_quote(UUID, UUID, UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Verify, against a real snapshot, then clean up.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user     UUID;
  v_snap     UUID;
  v_quote    JSONB;
  v_qid      UUID;
  v_applied  NUMERIC;
  v_mid      NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.fx_rate_snapshots) THEN
    RAISE NOTICE 'no snapshot present; skipping the live quote probe';
    RETURN;
  END IF;

  SELECT id INTO v_user FROM public.users LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'no users present; skipping the live quote probe';
    RETURN;
  END IF;

  -- A K1,000 basket (100,000 ngwee).
  v_quote := public.issue_fx_quote(v_user, 'GBP', 100000);
  v_qid := (v_quote->>'quote_id')::UUID;

  SELECT applied_rate, mid_rate INTO v_applied, v_mid
  FROM public.fx_quotes WHERE quote_id = v_qid;

  IF v_applied <= v_mid THEN
    RAISE EXCEPTION 'Spread went the wrong way: applied % is not above mid %', v_applied, v_mid;
  END IF;

  -- Fee must be the configured percentage of the basket, not of the total.
  IF (v_quote->>'platform_fee_minor')::INTEGER <> 8000 THEN
    RAISE EXCEPTION 'Expected an 8%% fee of 8000 ngwee on a 100000 basket, got %',
      v_quote->>'platform_fee_minor';
  END IF;

  IF (v_quote->>'total_zmw_minor')::INTEGER <> 108000 THEN
    RAISE EXCEPTION 'Expected a total of 108000 ngwee, got %', v_quote->>'total_zmw_minor';
  END IF;

  -- Single use.
  PERFORM public.consume_fx_quote(v_qid, v_user, gen_random_uuid(), 108000);
  BEGIN
    PERFORM public.consume_fx_quote(v_qid, v_user, gen_random_uuid(), 108000);
    RAISE EXCEPTION 'A quote was consumed twice';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%already been used%' THEN RAISE; END IF;
  END;

  DELETE FROM public.fx_quotes WHERE quote_id = v_qid;

  RAISE NOTICE 'fx quotes ready: spread raises the price, fee is 8%% of basket, single use enforced';
END $$;
