-- =============================================================================
-- The weekly price lock on KithLy bundles
--
-- THE PROMISE
-- -----------
-- A KithLy bundle's price is set once a week and held for that week. If the
-- shop price rises inside the week we absorb it; if it falls we lower ours.
-- It is the domestic twin of the FX lock the product already makes -- the same
-- sentence, about kwacha instead of pounds: no surprises between your money
-- and the thing.
--
-- Agreed 21 Sep: a 5% markup buffer over sourced cost, and a 20% ceiling --
-- past that the published price is voided and re-quoted rather than absorbed.
-- Worst case is therefore a 15% loss on a basket's cost, which is survivable
-- as an exception and not as a pattern; the 5% is a first number, to be
-- re-sized against real volatility once a month of runs exists.
--
-- THE RULE THAT MATTERS MOST
-- --------------------------
-- A PUBLISHED price may be voided. An ACCEPTED order may never be re-priced.
--
-- Those are two different things and must never become one mechanism. The
-- ceiling governs what a new buyer is offered. Once money is in escrow the
-- price is final, whatever the supplier does afterwards. Nothing in this
-- migration can reach an order: `locked_price_zmw` lives on the bundle
-- template, and checkout copies prices into `order_items.allocated_price` at
-- the moment of purchase. An order is already a snapshot.
--
-- NGWEE, NOT KWACHA
-- -----------------
-- `locked_price_zmw` is minor units, like every other money column here. The
-- name says ZMW and the value is ngwee, which is the exact assumption
-- 20260917020000 exists to correct after it put the ledger 100x out. The
-- column is named for consistency with `items.price_zmw` rather than for
-- accuracy, because a bundle line that disagreed with the item it references
-- would be worse than a badly named column.
--
-- WHY ON THE LINE AND NOT THE BUNDLE
-- ----------------------------------
-- A bundle's total is derived from its lines, and the lines come from
-- different shops that move at different times. Locking a single total would
-- lose which line caused a breach, and the 20% ceiling is evaluated on the
-- basket's weighted total -- which needs per-line figures to compute at all.
-- A 25% jump on salt must not void a grocery bundle where salt is 2% of it.
--
-- BLAST RADIUS: Local, additive, nullable. A line with no locked price falls
-- back to the live item price exactly as today, so every existing experience
-- behaves identically until a price run touches it.
-- =============================================================================

ALTER TABLE public.experience_items
  ADD COLUMN IF NOT EXISTS locked_price_zmw integer,
  ADD COLUMN IF NOT EXISTS sourced_cost_zmw integer,
  ADD COLUMN IF NOT EXISTS priced_at        timestamptz;

COMMENT ON COLUMN public.experience_items.locked_price_zmw IS
  'What the buyer pays for this line this week, in NGWEE. Null means the line
   has never been priced and falls back to the live item price. Set by the
   weekly price run; never written at checkout.';

COMMENT ON COLUMN public.experience_items.sourced_cost_zmw IS
  'What it cost us in town when it was last priced, in NGWEE. Kept beside the
   sell price so the margin is inspectable and so the next run can see how far
   the cost has moved -- which is the number the 20% ceiling is measured
   against. Not shown to buyers.';

COMMENT ON COLUMN public.experience_items.priced_at IS
  'When this line was last priced. A line older than its bundle''s
   price_valid_until is stale, and a stale price is a live promise nobody
   remembers making.';

ALTER TABLE public.experiences
  ADD COLUMN IF NOT EXISTS price_valid_until date;

COMMENT ON COLUMN public.experiences.price_valid_until IS
  'The date this bundle''s prices are held until. Shown to the buyer as
   "priced 21 Sep, held until 28 Sep". Null means the bundle carries no lock,
   which is correct for one built entirely from live shop items.';

-- ---------------------------------------------------------------------------
-- The buffer and the ceiling, as data rather than as constants in code
--
-- They live in platform_settings so they can be retuned without a deploy --
-- which matters, because the 5% is explicitly a first guess to be corrected
-- once there is volatility data to correct it with. A constant compiled into
-- the bundle would make that a release.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS bundle_markup_bps integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS bundle_ceiling_bps integer NOT NULL DEFAULT 2000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_bundle_markup_check'
  ) THEN
    ALTER TABLE public.platform_settings
      ADD CONSTRAINT platform_settings_bundle_markup_check
      CHECK (bundle_markup_bps BETWEEN 0 AND 5000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_bundle_ceiling_check'
  ) THEN
    ALTER TABLE public.platform_settings
      ADD CONSTRAINT platform_settings_bundle_ceiling_check
      CHECK (bundle_ceiling_bps BETWEEN 0 AND 10000);
  END IF;
END $$;

COMMENT ON COLUMN public.platform_settings.bundle_markup_bps IS
  'Markup over sourced cost on KithLy bundle lines, in basis points. 500 = 5%,
   agreed 21 Sep as a starting figure to be re-sized against observed weekly
   volatility rather than left unexamined.';

COMMENT ON COLUMN public.platform_settings.bundle_ceiling_bps IS
  'How far a sourced cost may rise before the published price is VOIDED and
   re-quoted instead of absorbed, in basis points. 2000 = 20%. Evaluated on
   the basket weighted total, never on a single line -- see
   bundle_price_health.';

-- ---------------------------------------------------------------------------
-- bundle_price_health — is this bundle's published price still honest?
--
-- Returns the bundle's locked total, what those same lines would cost to
-- source today, the weighted movement between them, and whether that movement
-- has passed the ceiling.
--
-- WEIGHTED, AND THAT IS THE POINT. The movement is computed on the basket
-- total, not per line, so a cheap volatile item cannot void a bundle it barely
-- contributes to.
--
-- Read-only. It reports; it does not void anything. Voiding is a decision
-- taken at the weekly run by a person looking at this number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bundle_price_health(p_experience_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH lines AS (
    SELECT
      ei.quantity,
      COALESCE(ei.locked_price_zmw, i.price_zmw) AS locked,
      COALESCE(ei.sourced_cost_zmw, i.price_zmw) AS was_cost,
      i.price_zmw                                AS now_cost
    FROM public.experience_items ei
    JOIN public.items i ON i.id = ei.item_id
    WHERE ei.experience_id = p_experience_id
  ),
  totals AS (
    SELECT
      COALESCE(SUM(quantity * locked), 0)   AS locked_total,
      COALESCE(SUM(quantity * was_cost), 0) AS cost_then,
      COALESCE(SUM(quantity * now_cost), 0) AS cost_now
    FROM lines
  )
  SELECT jsonb_build_object(
    'locked_total_ngwee', t.locked_total,
    'cost_then_ngwee',    t.cost_then,
    'cost_now_ngwee',     t.cost_now,
    -- Movement in basis points on the WEIGHTED basket. Zero when there is no
    -- prior cost to compare against, which is a bundle that has never been
    -- priced rather than one that has not moved.
    'movement_bps', CASE
      WHEN t.cost_then = 0 THEN 0
      ELSE ROUND(((t.cost_now - t.cost_then)::numeric / t.cost_then) * 10000)
    END,
    'ceiling_bps', ps.bundle_ceiling_bps,
    'breached', CASE
      WHEN t.cost_then = 0 THEN false
      ELSE ((t.cost_now - t.cost_then)::numeric / t.cost_then) * 10000 > ps.bundle_ceiling_bps
    END
  )
  FROM totals t CROSS JOIN public.platform_settings ps
  WHERE ps.id = 1;
$$;

REVOKE ALL ON FUNCTION public.bundle_price_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bundle_price_health(uuid) TO authenticated;

COMMENT ON FUNCTION public.bundle_price_health(uuid) IS
  'Weekly price-run instrument. Reports a bundle''s locked total against what
   its lines would cost today, the weighted movement in basis points, and
   whether the ceiling has been breached. Reports only -- voiding a published
   price is a human decision, and an accepted order is never re-priced.';
