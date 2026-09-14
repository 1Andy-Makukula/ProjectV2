-- =============================================================================
-- The Slate — one request in, one ranked, reasoned slate out
--
-- WHY THE MODEL IS LINEAR, AND WHY THAT IS NOT A SIMPLIFICATION
-- -------------------------------------------------------------
-- Because the score is a sum, THE LARGEST TERM IS THE EXPLANATION. Every row
-- comes back with the reason it is there -- "because Mercy's graduation is in
-- nine days", "you usually restock this about now" -- for free, as a property
-- of the arithmetic rather than as a second system that guesses at the first.
--
-- A neural ranker would buy a better AUC and throw that away. At this scale
-- that trade is absurd: reason-labelled recommendations convert better, and
-- more importantly they are the strongest "this app is paying attention"
-- signal there is. Keep the linear model until it is provably costing money.
--
-- WHAT IS HONEST ABOUT THE TERMS
-- ------------------------------
-- Obligation is the moat and the only term that works at one user, because it
-- runs on dates people declared rather than behaviour that has to accumulate.
--
-- Proximity is DEFINED AND ALWAYS ZERO. There is no user location anywhere in
-- this schema, so the term cannot be computed. It is kept as a named zero
-- rather than quietly dropped, so the gap is visible and the weight is
-- meaningless rather than misleading -- and so nobody later "fixes" a
-- suspiciously absent term by inventing a distance.
--
-- EXPLORATION IS AN APPROXIMATION AND IS LABELLED AS ONE
-- -----------------------------------------------------
-- Proper Thompson sampling draws each item's score from a Beta posterior. SQL
-- has no beta_rand, and rolling one in PL/pgSQL for every candidate on every
-- request is not worth it here. What this does instead is optimism under
-- uncertainty: a random bonus scaled by how little evidence an item has, so
-- unproven items sometimes win and proven ones mostly do. It has the property
-- that matters -- nothing is locked out for having never been shown -- without
-- claiming to be the thing it approximates.
--
-- DIVERSITY MATTERS MORE AT LOW SUPPLY, NOT LESS
-- ----------------------------------------------
-- With few merchants an unconstrained ranker lets one well-photographed shop
-- take the whole storefront, and a storefront that is all one shop is the
-- definition of a dead app. The caps are applied after scoring, not before.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The log. Written on every call, from the first day, because interleaving
-- cannot be run retroactively and neither can anything else this answers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kithly_reco.slate_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  surface     text NOT NULL,
  item_ids    uuid[] NOT NULL,
  /* The weights in force when this slate was built, so a change can be dated
     against its effect rather than guessed at. */
  weights     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slate_log_user_time_idx
  ON kithly_reco.slate_log (user_id, created_at DESC);

ALTER TABLE kithly_reco.slate_log ENABLE ROW LEVEL SECURITY;
-- No policy: nothing reads this over the API. Analysis runs as service_role.

-- ---------------------------------------------------------------------------
-- The ranker
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kithly_reco.slate(
  p_user_id uuid,
  p_surface text DEFAULT 'storefront',
  p_limit   integer DEFAULT 12
)
RETURNS TABLE (
  item_id     uuid,
  score       numeric,
  reason_code text,
  reason_text text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = kithly_reco, public
AS $$
/* The OUT parameters are named item_id, score, reason_code and reason_text,
   and the CTEs below refer to columns with those same names. PL/pgSQL resolves
   an ambiguous name to the VARIABLE by default, which here means the empty OUT
   parameter rather than the column -- reported as "column reference item_id is
   ambiguous" at the caller's line, which is a long way from the cause.

   Telling it to prefer the column is the fix, and it is stated rather than
   worked around by renaming, because the OUT names are the function's public
   contract and the client reads them. */
#variable_conflict use_column
DECLARE
  w kithly_reco.weights%ROWTYPE;
BEGIN
  SELECT * INTO w FROM kithly_reco.weights WHERE id;

  -- The kill switch. Nothing about this is load-bearing until somebody says so.
  IF w IS NULL OR NOT w.enabled THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  -- ── Obligation ────────────────────────────────────────────────────────
  -- The moat. Dates somebody declared, weighted by how close they are to
  -- being actionable and by who the person is to them.
  obligation AS (
    SELECT
      i.id AS item_id,
      max(
        kc.strength
        * kithly_reco.urgency(
            (public.occasion_next_date(o.recurrence, o.month, o.day, o.year, current_date)
             - current_date)::integer,
            w.urgency_peak_days, w.urgency_spread)
        * CASE c.relationship_tier
            WHEN 'partner' THEN 1.00
            WHEN 'immediate_family' THEN 0.95
            WHEN 'close_friend' THEN 0.80
            WHEN 'family' THEN 0.75
            WHEN 'friend' THEN 0.60
            WHEN 'colleague' THEN 0.45
            WHEN 'service' THEN 0.30
            ELSE 0.55   -- unstated is not distant
          END
      ) AS value,
      (array_agg(COALESCE(c.name, g.name) ORDER BY
         kithly_reco.urgency(
           (public.occasion_next_date(o.recurrence, o.month, o.day, o.year, current_date)
            - current_date)::integer, w.urgency_peak_days, w.urgency_spread) DESC))[1] AS who,
      (array_agg(o.kind ORDER BY
         kithly_reco.urgency(
           (public.occasion_next_date(o.recurrence, o.month, o.day, o.year, current_date)
            - current_date)::integer, w.urgency_peak_days, w.urgency_spread) DESC))[1] AS occasion_kind,
      (array_agg((public.occasion_next_date(o.recurrence, o.month, o.day, o.year, current_date)
                  - current_date)::integer ORDER BY
         kithly_reco.urgency(
           (public.occasion_next_date(o.recurrence, o.month, o.day, o.year, current_date)
            - current_date)::integer, w.urgency_peak_days, w.urgency_spread) DESC))[1] AS days_away
    FROM public.contact_occasions o
    LEFT JOIN public.contacts c       ON c.id = o.contact_id
    LEFT JOIN public.contact_groups g ON g.id = o.group_id
    JOIN kithly_reco.kind_category kc ON kc.occasion_kind = o.kind
    JOIN public.items i               ON i.category_id = kc.category_id
    WHERE COALESCE(c.owner_user_id, g.owner_user_id) = p_user_id
      AND i.is_available IS NOT FALSE
      AND i.is_quote_only IS NOT TRUE
    GROUP BY i.id
  ),

  -- ── Restock ───────────────────────────────────────────────────────────
  restock AS (
    SELECT oi.item_id, 1.0::numeric AS value
    FROM public.order_items oi
    JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
    JOIN public.transactions t ON t.transaction_id = so.transaction_id
    WHERE t.buyer_id = p_user_id AND so.fulfilled_at IS NOT NULL
    GROUP BY oi.item_id
    HAVING count(*) >= 2
  ),

  -- ── Affinity ──────────────────────────────────────────────────────────
  -- Categories this person has actually engaged with. Deliberately shallow:
  -- co-occurrence over a catalogue this size is noise wearing a model's hat.
  affinity AS (
    SELECT i.id AS item_id,
           LEAST(count(*)::numeric / 10, 1.0) AS value
    FROM kithly_reco.signals s
    JOIN public.items si ON si.id = s.subject_id
    JOIN public.items i  ON i.category_id = si.category_id
    WHERE s.user_id = p_user_id
      AND s.action IN ('view','tap','save','add_to_cart','purchase')
      AND s.created_at > now() - interval '90 days'
      AND i.is_available IS NOT FALSE
    GROUP BY i.id
  ),

  -- ── Social ────────────────────────────────────────────────────────────
  -- What this person's own contacts have actually received. Matched on phone,
  -- which is how contacts and recipients already line up.
  social AS (
    SELECT oi.item_id, LEAST(count(*)::numeric / 3, 1.0) AS value
    FROM public.contacts c
    JOIN public.shop_orders so ON so.recipient_phone = c.phone
    JOIN public.order_items oi ON oi.shop_order_id = so.shop_order_id
    WHERE c.owner_user_id = p_user_id AND so.fulfilled_at IS NOT NULL
    GROUP BY oi.item_id
  ),

  -- ── Fatigue ───────────────────────────────────────────────────────────
  -- Shown and ignored. Without this the slate calcifies within a week and the
  -- app feels dead again, which is self-defeating given the point of all this.
  fatigue AS (
    SELECT s.subject_id AS item_id,
           LEAST(ln(1 + count(*))::numeric / 3, 1.0) AS value
    FROM kithly_reco.signals s
    WHERE s.user_id = p_user_id
      AND s.action = 'impression'
      AND s.created_at > now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM kithly_reco.signals a
        WHERE a.user_id = s.user_id AND a.subject_id = s.subject_id
          AND a.action IN ('tap','view','save','add_to_cart','purchase')
      )
    GROUP BY s.subject_id
  ),

  candidates AS (
    SELECT DISTINCT item_id FROM obligation
    UNION SELECT item_id FROM restock
    UNION SELECT item_id FROM affinity
    UNION SELECT item_id FROM social
    -- Fresh stock, so a new item is not locked out for having no history.
    UNION SELECT id FROM public.items
      WHERE is_available IS NOT FALSE AND is_quote_only IS NOT TRUE
      ORDER BY 1
    LIMIT 400
  ),

  scored AS (
    SELECT
      i.id AS item_id,
      i.shop_id,
      i.category_id,
      w.w_obligation * COALESCE(ob.value, 0) AS s_obligation,
      w.w_restock    * COALESCE(rs.value, 0) AS s_restock,
      w.w_affinity   * COALESCE(af.value, 0) AS s_affinity,
      -- Defined, always zero: there is no user location in this schema. See
      -- the header. Kept named so the gap is visible.
      w.w_proximity  * 0                     AS s_proximity,
      w.w_social     * COALESCE(so.value, 0) AS s_social,
      w.w_vitality   * COALESCE(v.score, 0) / 100.0 AS s_vitality,
      /* Optimism under uncertainty, not Thompson sampling. An item nobody has
         seen gets a large random bonus; a well-evidenced one gets almost none. */
      w.w_novelty * random()::numeric * (1.0 / (1 + COALESCE(seen.n, 0))) AS s_novelty,
      -w.w_fatigue * COALESCE(fa.value, 0)   AS s_fatigue,
      ob.who, ob.occasion_kind, ob.days_away
    FROM candidates cand
    JOIN public.items i ON i.id = cand.item_id
    LEFT JOIN obligation ob ON ob.item_id = i.id
    LEFT JOIN restock rs    ON rs.item_id = i.id
    LEFT JOIN affinity af   ON af.item_id = i.id
    LEFT JOIN social so     ON so.item_id = i.id
    LEFT JOIN fatigue fa    ON fa.item_id = i.id
    LEFT JOIN public.shop_vitality v ON v.shop_id = i.shop_id
    LEFT JOIN LATERAL (
      SELECT count(*)::numeric AS n FROM kithly_reco.signals sg
      WHERE sg.subject_id = i.id AND sg.action = 'impression'
    ) seen ON true
    WHERE i.is_available IS NOT FALSE AND i.is_quote_only IS NOT TRUE
  ),

  totalled AS (
    SELECT
      s.*,
      (s_obligation + s_restock + s_affinity + s_proximity
       + s_social + s_vitality + s_novelty + s_fatigue) AS total,
      /* The largest positive term is the explanation. This is the property
         that makes the linear model worth keeping. */
      CASE GREATEST(s_obligation, s_restock, s_affinity, s_social, s_vitality, s_novelty)
        WHEN s_obligation THEN 'obligation'
        WHEN s_restock    THEN 'restock'
        WHEN s_social     THEN 'social'
        WHEN s_affinity   THEN 'affinity'
        WHEN s_vitality   THEN 'vitality'
        ELSE 'novelty'
      END AS winner
    FROM scored s
  ),

  -- Diversity, applied after scoring. See the header.
  diversified AS (
    SELECT t.*,
      row_number() OVER (PARTITION BY t.shop_id ORDER BY t.total DESC) AS shop_rank,
      row_number() OVER (PARTITION BY t.category_id ORDER BY t.total DESC) AS cat_rank
    FROM totalled t
    WHERE t.total > 0
  )

  SELECT
    d.item_id,
    round(d.total::numeric, 4),
    d.winner,
    CASE d.winner
      WHEN 'obligation' THEN
        CASE
          WHEN d.days_away = 0 THEN d.who || '''s ' || replace(d.occasion_kind, '_', ' ') || ' is today'
          WHEN d.days_away = 1 THEN d.who || '''s ' || replace(d.occasion_kind, '_', ' ') || ' is tomorrow'
          ELSE 'Because ' || d.who || '''s ' || replace(d.occasion_kind, '_', ' ')
               || ' is in ' || d.days_away || ' days'
        END
      WHEN 'restock'  THEN 'You have bought this before'
      WHEN 'social'   THEN 'Someone you send to has had this'
      WHEN 'affinity' THEN 'Like things you have looked at'
      WHEN 'vitality' THEN 'From a shop that keeps its page up to date'
      ELSE 'New, and worth a look'
    END
  FROM diversified d
  WHERE d.shop_rank <= w.max_per_shop
    AND (d.category_id IS NULL OR d.cat_rank <= w.max_per_category)
  ORDER BY d.total DESC
  LIMIT GREATEST(COALESCE(p_limit, 12), 1);
END;
$$;

COMMENT ON FUNCTION kithly_reco.slate(uuid, text, integer) IS
  'The ranker. Additive by design so the largest term is the reason. Returns nothing while weights.enabled is false.';

REVOKE ALL ON FUNCTION kithly_reco.slate(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION kithly_reco.slate(uuid, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- The front door, soft like the rest
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slate(
  p_surface text DEFAULT 'storefront',
  p_limit   integer DEFAULT 12
)
RETURNS TABLE (
  item_id     uuid,
  score       numeric,
  reason_code text,
  reason_text text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF to_regclass('kithly_reco.weights') IS NULL OR auth.uid() IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM kithly_reco.slate(auth.uid(), p_surface, p_limit);
END;
$$;

COMMENT ON FUNCTION public.slate(text, integer) IS
  'Ranked items for the signed-in user, each with the reason it is there. Empty when the recommender is off or absent.';

REVOKE ALL ON FUNCTION public.slate(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slate(text, integer) TO authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'slate ready (enabled=%)', (SELECT enabled FROM kithly_reco.weights WHERE id);
END $$;
