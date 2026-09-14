-- =============================================================================
-- Shop vitality — the number that makes filling a shop worth doing
--
-- WHY THIS EXISTS AT ALL
-- ----------------------
-- Two later stages are starved without merchant supply depth. Tiles cannot flip
-- through galleries nobody has filled (4a), and a bundle cannot be composed from
-- a thin catalogue (5). Asking merchants nicely does not fill a catalogue.
--
-- So vitality is the mechanism, not the metric: it is shown to the shopkeeper
-- with what it buys them, and it buys ranking position and motion budget. A
-- shop that adds its fifth photograph gets a tile that moves. That converts a
-- rendering effect into a supply flywheel, and it is the only part of the
-- aliveness plan that recruits work from someone other than us.
--
-- WHY THE COMPONENTS ARE EXPOSED, NOT JUST THE TOTAL
-- --------------------------------------------------
-- A score on its own is a grade, and a grade is not actionable. Every component
-- is returned beside the total so the merchant panel can say "your galleries
-- are at 1.2 photographs an item" rather than "your vitality is 46".
--
-- WHY A VIEW AND NOT A MATERIALISED TABLE
-- ---------------------------------------
-- There are tens of shops, not millions, and the inputs change whenever a
-- merchant edits anything -- which is exactly when the number needs to be right.
-- A materialised table would add a refresh job and a staleness window to save
-- milliseconds nobody is waiting on. When the shop count makes that false, this
-- becomes `reco.shop_vitality`, refreshed on the same pg_cron pass as the other
-- Stage 6 features; the column names here are chosen so that swap is a rename.
--
-- FULFILMENT IS DELIBERATELY FORGIVING OF NEW SHOPS
-- -------------------------------------------------
-- A shop with one order and one collection scores the same as a shop with two
-- hundred. That is intentional: a fulfilment rate computed from a handful of
-- orders is noise, so it only counts once there are at least five, and before
-- that the component sits at its neutral value rather than at zero. Punishing a
-- shop for being new is how a flywheel fails to start.
-- =============================================================================

CREATE OR REPLACE VIEW public.shop_vitality
WITH (security_invoker = true) AS
WITH gallery AS (
  SELECT
    i.shop_id,
    count(*)::numeric                              AS item_count,
    count(*) FILTER (WHERE i.image_url IS NOT NULL)::numeric AS items_with_cover,
    COALESCE(avg(img.n), 0)                        AS avg_images
  FROM public.items i
  LEFT JOIN LATERAL (
    SELECT count(*)::numeric AS n
    FROM public.item_images ii
    WHERE ii.item_id = i.id
  ) img ON true
  WHERE i.is_available IS NOT FALSE
  GROUP BY i.shop_id
),
orders AS (
  SELECT
    so.shop_id,
    count(*)::numeric                                                AS total_orders,
    count(*) FILTER (WHERE so.claim_status = 'REDEEMED')::numeric     AS redeemed_orders
  FROM public.shop_orders so
  GROUP BY so.shop_id
),
collections AS (
  SELECT sc.shop_id, count(*)::numeric AS collection_count
  FROM public.shop_collections sc
  WHERE sc.is_active
  GROUP BY sc.shop_id
)
SELECT
  s.id AS shop_id,
  s.name,

  -- ── components, each 0..1 ────────────────────────────────────────────────
  /* Five photographs is the cap item_images enforces, so five is full marks. */
  LEAST(COALESCE(g.avg_images, 0) / 5.0, 1.0)                        AS gallery_depth,

  /* Every listed item should at least have a cover. */
  CASE WHEN COALESCE(g.item_count, 0) = 0 THEN 0
       ELSE COALESCE(g.items_with_cover, 0) / g.item_count END       AS cover_coverage,

  /* Twenty items is a shop somebody can browse. Beyond that, more items stop
     being evidence of effort. */
  LEAST(COALESCE(g.item_count, 0) / 20.0, 1.0)                       AS catalogue_size,

  /* Three collections is enough to organise a shop meaningfully. */
  LEAST(COALESCE(c.collection_count, 0) / 3.0, 1.0)                  AS organisation,

  CASE WHEN s.opening_hours IS NOT NULL THEN 1.0 ELSE 0.0 END        AS hours_set,

  /* Neutral until there is enough history to mean anything. See the header. */
  CASE
    WHEN COALESCE(o.total_orders, 0) < 5 THEN 0.5
    ELSE o.redeemed_orders / o.total_orders
  END                                                                AS fulfilment,

  /* Ratings are out of five. A shop with none sits neutral rather than at
     zero -- an unrated shop is unknown, not bad. */
  CASE
    WHEN COALESCE(s.rating_count, 0) = 0 THEN 0.5
    ELSE LEAST(GREATEST((s.rating_sum::numeric / s.rating_count) / 5.0, 0), 1)
  END                                                                AS rating,

  -- ── the total, 0..100 ────────────────────────────────────────────────────
  /* Weights say what the platform wants more of. Galleries and covers carry
     the most because they are what Stage 4a needs and what a shopper sees
     first; organisation is next because it feeds the Composer. */
  round(100 * (
      0.28 * LEAST(COALESCE(g.avg_images, 0) / 5.0, 1.0)
    + 0.18 * (CASE WHEN COALESCE(g.item_count, 0) = 0 THEN 0
                   ELSE COALESCE(g.items_with_cover, 0) / g.item_count END)
    + 0.14 * LEAST(COALESCE(g.item_count, 0) / 20.0, 1.0)
    + 0.14 * LEAST(COALESCE(c.collection_count, 0) / 3.0, 1.0)
    + 0.08 * (CASE WHEN s.opening_hours IS NOT NULL THEN 1.0 ELSE 0.0 END)
    + 0.10 * (CASE WHEN COALESCE(o.total_orders, 0) < 5 THEN 0.5
                   ELSE o.redeemed_orders / o.total_orders END)
    + 0.08 * (CASE WHEN COALESCE(s.rating_count, 0) = 0 THEN 0.5
                   ELSE LEAST(GREATEST((s.rating_sum::numeric / s.rating_count) / 5.0, 0), 1) END)
  ))::integer                                                        AS score,

  -- ── the raw figures a panel needs to say something useful ────────────────
  COALESCE(g.item_count, 0)::integer       AS item_count,
  COALESCE(g.avg_images, 0)                AS avg_images_per_item,
  COALESCE(c.collection_count, 0)::integer AS collection_count,
  COALESCE(o.total_orders, 0)::integer     AS total_orders,
  s.rating_count,
  (s.opening_hours IS NOT NULL)            AS has_opening_hours
FROM public.shops s
LEFT JOIN gallery     g ON g.shop_id = s.id
LEFT JOIN orders      o ON o.shop_id = s.id
LEFT JOIN collections c ON c.shop_id = s.id;

COMMENT ON VIEW public.shop_vitality IS
  'How complete and well-run a shop is, 0-100, with its components. Drives merchant nudges now and ranking weight in Stage 6.';

-- ---------------------------------------------------------------------------
-- What to tell the shopkeeper to do next
--
-- The single weakest component that is actually fixable by them, phrased as an
-- instruction rather than a score. Returns null when there is nothing worth
-- saying, which is a real answer -- a nag with no remedy is how a panel gets
-- ignored.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shop_vitality_nudge(p_shop_id uuid)
RETURNS text
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN v.item_count = 0 THEN
      'Add your first item. Nothing can be sold, shown or recommended until there is something to show.'
    WHEN v.cover_coverage < 1 THEN
      'Some items have no photograph at all. A tile without one is skipped.'
    WHEN v.avg_images_per_item < 3 THEN
      'Add more photographs. Items with five pictures get a tile that moves on the storefront.'
    WHEN v.collection_count = 0 THEN
      'Group your items. A shop with named collections is browsed; a flat grid is scrolled past.'
    WHEN NOT v.has_opening_hours THEN
      'Set your opening hours. Your shop then brightens and dims on the storefront as you open and close.'
    WHEN v.avg_images_per_item < 5 THEN
      'Nearly there -- five photographs an item is the cap, and the full effect.'
    ELSE NULL
  END
  FROM public.shop_vitality v
  WHERE v.shop_id = p_shop_id;
$$;

COMMENT ON FUNCTION public.shop_vitality_nudge(uuid) IS
  'The one thing a shopkeeper should do next, or null when there is nothing worth saying.';

REVOKE ALL ON FUNCTION public.shop_vitality_nudge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_vitality_nudge(uuid) TO authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'shop vitality ready';
END $$;
