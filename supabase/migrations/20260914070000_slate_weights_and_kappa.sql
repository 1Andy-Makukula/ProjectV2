-- =============================================================================
-- The Slate's dials: weights, and kappa
--
-- WHY THESE ARE TABLES
-- --------------------
-- Ranking is the most-changed code in a product like this. If the weights live
-- in a function body, every adjustment is a migration, a review and a deploy --
-- so adjustments stop happening, and the ranker ossifies at whatever somebody
-- guessed on the first afternoon.
--
-- As a table it is retunable from the admin dashboard in seconds. Working
-- alone, that is the difference between tuning weekly and tuning three times a
-- day, and it is the single highest-value structural decision in the whole
-- design.
--
-- ONE ROW, AND A KILL SWITCH
-- --------------------------
-- Exactly one row, enforced. A weights table that can hold two is a table that
-- will eventually hold two and quietly use the wrong one.
--
-- `enabled` is the switch that makes all of this safe to ship. Turn it off and
-- `reco.slate()` returns nothing, every call site falls through to whatever it
-- ordered by before, and the platform is exactly as it was. Nothing about the
-- recommender is load-bearing until somebody decides it is.
--
-- KAPPA: WHAT SUITS THE OCCASION
-- ------------------------------
-- Thirteen occasion kinds against the category taxonomy. This is the crown
-- jewel and it is deliberately hand-written: what a Zambian family actually
-- buys for a graduation, a funeral, a new baby or a term's school fees is local
-- knowledge, and it is the part of this system no competitor can scrape and no
-- general model already knows.
--
-- Seeded by slug so it can be read and argued with. Learned later from
-- conversions, into the same table, with `source` keeping the two apart.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Weights
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kithly_reco.weights (
  /* A fixed primary key, so there can only ever be one row. */
  id              boolean PRIMARY KEY DEFAULT true,

  enabled         boolean NOT NULL DEFAULT false,

  w_obligation    numeric NOT NULL DEFAULT 1.00,
  w_restock       numeric NOT NULL DEFAULT 0.80,
  w_affinity      numeric NOT NULL DEFAULT 0.50,
  w_proximity     numeric NOT NULL DEFAULT 0.40,
  w_social        numeric NOT NULL DEFAULT 0.35,
  w_vitality      numeric NOT NULL DEFAULT 0.30,
  w_novelty       numeric NOT NULL DEFAULT 0.25,
  w_fatigue       numeric NOT NULL DEFAULT 0.45,

  /* The actionability curve. Pressure peaks a week out because that is when
     somebody can still do something: sixty days out nobody cares, and one day
     out it is too late to order. 20260904010000's reminder job already fires
     at seven days -- the two share this number deliberately, and changing it
     here without changing it there would make the app disagree with itself. */
  urgency_peak_days  integer NOT NULL DEFAULT 7,
  urgency_spread     numeric NOT NULL DEFAULT 5.0,

  /* Diversity, applied to the top of the slate. With few merchants an
     unconstrained ranker lets one well-photographed shop eat the storefront,
     and a storefront that is all one shop is the definition of a dead app --
     so this matters MORE at low supply, not less. */
  max_per_shop     integer NOT NULL DEFAULT 2,
  max_per_category integer NOT NULL DEFAULT 3,

  /* How much of the slate is given to things with no evidence yet. Without it
     the ranker only ever shows what already worked, and nothing new is ever
     discovered -- the rich-get-richer trap. */
  exploration_slots integer NOT NULL DEFAULT 2,

  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT weights_single_row CHECK (id = true),
  CONSTRAINT weights_nonneg CHECK (
    w_obligation >= 0 AND w_restock >= 0 AND w_affinity >= 0 AND w_proximity >= 0
    AND w_social >= 0 AND w_vitality >= 0 AND w_novelty >= 0 AND w_fatigue >= 0
  ),
  CONSTRAINT weights_urgency CHECK (urgency_peak_days BETWEEN 0 AND 90 AND urgency_spread > 0),
  CONSTRAINT weights_diversity CHECK (max_per_shop >= 1 AND max_per_category >= 1),
  CONSTRAINT weights_exploration CHECK (exploration_slots >= 0 AND exploration_slots <= 6)
);

COMMENT ON TABLE kithly_reco.weights IS
  'The Slate''s dials, one row. Retunable without a deploy; enabled=false makes the recommender inert.';

COMMENT ON COLUMN kithly_reco.weights.enabled IS
  'The kill switch. False means slate() returns nothing and every call site falls back to its previous ordering.';

/* Ships OFF. A ranker that switches itself on at deploy time is a ranker
   nobody chose to trust. */
INSERT INTO kithly_reco.weights (id, enabled) VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE kithly_reco.weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weights_read ON kithly_reco.weights;
CREATE POLICY weights_read ON kithly_reco.weights
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS weights_admin_write ON kithly_reco.weights;
CREATE POLICY weights_admin_write ON kithly_reco.weights
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 2. Kappa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kithly_reco.kind_category (
  occasion_kind text NOT NULL,
  category_id   uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  strength      numeric NOT NULL,
  source        text NOT NULL DEFAULT 'seeded',
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (occasion_kind, category_id),
  CONSTRAINT kind_category_kind_check CHECK (occasion_kind IN (
    'birthday','anniversary','wedding','graduation','new_baby','memorial',
    'holiday','groceries','school_fees','upkeep','rent','medical','other'
  )),
  CONSTRAINT kind_category_strength_check CHECK (strength > 0 AND strength <= 1),
  CONSTRAINT kind_category_source_check CHECK (source IN ('seeded', 'learned'))
);

COMMENT ON TABLE kithly_reco.kind_category IS
  'Kappa: what suits which occasion. Hand-written local knowledge, learnable later without losing the seeds.';

ALTER TABLE kithly_reco.kind_category ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kind_category_read ON kithly_reco.kind_category;
CREATE POLICY kind_category_read ON kithly_reco.kind_category
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS kind_category_admin_write ON kithly_reco.kind_category;
CREATE POLICY kind_category_admin_write ON kithly_reco.kind_category
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

INSERT INTO kithly_reco.kind_category (occasion_kind, category_id, strength)
SELECT v.kind, c.id, v.strength
FROM (VALUES
  -- A birthday: something to eat, something to wear, something to keep
  ('birthday', 'bakery-cakes', 0.95), ('birthday', 'snacks-confectionery', 0.70),
  ('birthday', 'fragrances', 0.65),   ('birthday', 'womenswear', 0.55),
  ('birthday', 'menswear', 0.55),     ('birthday', 'toys-games', 0.60),
  ('birthday', 'jewellery', 0.55),    ('birthday', 'beverages', 0.50),

  ('anniversary', 'jewellery', 0.85), ('anniversary', 'catering', 0.70),
  ('anniversary', 'fragrances', 0.70), ('anniversary', 'spa-massage', 0.65),
  ('anniversary', 'home-decor', 0.50),

  -- A wedding: the household, and the day itself
  ('wedding', 'kitchenware', 0.85),   ('wedding', 'bedding-linen', 0.80),
  ('wedding', 'home-appliances', 0.75), ('wedding', 'furniture', 0.60),
  ('wedding', 'traditional-attire', 0.70), ('wedding', 'catering', 0.65),

  -- A graduation: the next thing, not the last one
  ('graduation', 'mobile-phones', 0.80), ('graduation', 'computers-laptops', 0.75),
  ('graduation', 'bags-luggage', 0.65), ('graduation', 'menswear', 0.60),
  ('graduation', 'womenswear', 0.60),  ('graduation', 'watches', 0.60),
  ('graduation', 'bakery-cakes', 0.55),

  ('new_baby', 'baby-clothing', 0.95), ('new_baby', 'nappies-wipes', 0.85),
  ('new_baby', 'prams-car-seats', 0.70), ('new_baby', 'toys-games', 0.60),
  ('new_baby', 'baby-food', 0.55),

  -- A funeral. Practical and quiet: people feed the mourners.
  ('memorial', 'catering', 0.80), ('memorial', 'fresh-produce', 0.55),
  ('memorial', 'beverages', 0.50),

  ('holiday', 'bakery-cakes', 0.70), ('holiday', 'meat-poultry', 0.75),
  ('holiday', 'beverages', 0.75),    ('holiday', 'traditional-attire', 0.55),
  ('holiday', 'snacks-confectionery', 0.60),

  ('groceries', 'groceries', 0.95),  ('groceries', 'fresh-produce', 0.85),
  ('groceries', 'meat-poultry', 0.75), ('groceries', 'dairy-eggs', 0.75),
  ('groceries', 'cleaning-supplies', 0.60), ('groceries', 'frozen-foods', 0.55),

  ('school_fees', 'school-supplies', 0.90), ('school_fees', 'childrenswear', 0.75),
  ('school_fees', 'shoes', 0.65),           ('school_fees', 'bags-luggage', 0.60),

  ('upkeep', 'cleaning-supplies', 0.75), ('upkeep', 'tools-hardware', 0.70),
  ('upkeep', 'paint-building-supplies', 0.60), ('upkeep', 'electronics-repair', 0.55),

  ('rent', 'furniture', 0.45), ('rent', 'home-decor', 0.35),

  ('medical', 'health-foods', 0.60), ('medical', 'skin-care', 0.45)
) AS v(kind, slug, strength)
JOIN public.categories c ON c.slug = v.slug
ON CONFLICT (occasion_kind, category_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The urgency curve
--
-- A Gaussian, not a ramp, and this is the part most likely to be "corrected"
-- by somebody who has not thought about it. Urgency does NOT rise monotonically
-- as a date approaches. Sixty days out nobody is thinking about it; one day out
-- it is too late to order anything and all a nudge does is make somebody feel
-- bad. Pressure peaks where action is still possible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kithly_reco.urgency(
  p_days_until integer,
  p_peak       integer DEFAULT 7,
  p_spread     numeric DEFAULT 5.0
)
RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = kithly_reco, public
AS $$
  SELECT CASE
    -- The date has gone. An occasion is not more urgent for being missed.
    WHEN p_days_until IS NULL OR p_days_until < 0 THEN 0::numeric
    ELSE round(
      exp(-1 * ((p_days_until - p_peak) ^ 2) / (2 * (p_spread ^ 2)))::numeric,
      6
    )
  END;
$$;

COMMENT ON FUNCTION kithly_reco.urgency(integer, integer, numeric) IS
  'Actionability, not proximity. Peaks about a week out, where something can still be done about it.';

DO $$
BEGIN
  RAISE NOTICE 'slate dials ready: % kappa pairs, weights enabled=%',
    (SELECT count(*) FROM kithly_reco.kind_category),
    (SELECT enabled FROM kithly_reco.weights WHERE id);
END $$;
