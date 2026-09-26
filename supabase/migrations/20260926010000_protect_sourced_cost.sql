-- =============================================================================
-- What KithLy pays in town is not public, and the price run is one transaction
--
-- FOUND WHILE PREPARING THE CATALOGUE REPORT, 26 Sep
-- --------------------------------------------------
-- 1. `experience_items.sourced_cost_zmw` -- what a line cost us in town -- was
--    readable by ANYONE, signed in or not. experience_items has a public-read
--    policy (it has to: the shelf shows the lines), and RLS is per row, not per
--    column, so the cost rode along with every line. Checked with the anon key:
--    readable. Nothing had leaked only because no price run had been published
--    yet and every value was null. Our cost next to our price is our margin,
--    handed to every competitor and every shop we negotiate with.
--
-- 2. `experience_price_health` failed for every caller with "permission denied
--    for table platform_settings" -- it was not SECURITY DEFINER and reads a
--    column that is deliberately not granted (see 20260924000000). And had it
--    worked, it measured the wrong thing: it compared the recorded cost against
--    items.price_zmw, which since the price run writes the SELL price into
--    items.price_zmw is our own price with markup, not anybody's cost. It has
--    no callers. It is dropped rather than repaired; admin_catalogue_report
--    below replaces it, and two copies of the movement arithmetic would drift.
--
-- 3. The price book published with three separate client-side writes per line
--    (the line, the item, the bundle's window). A dropped connection half way
--    left some items repriced and their bundles still dated last week. CLAUDE.md
--    is explicit that a multi-step write like this belongs in one RPC.
--
-- 4. set_experience_items deleted EVERY line of a bundle and re-inserted the
--    list. So saving a bundle in the admin editor -- fixing a typo in a note --
--    silently wiped every line's locked price and priced_at, and re-sent every
--    merchant "your item is in an experience" for items that had been in it for
--    weeks. What is charged was never affected (that is items.price_zmw), but
--    the price book would show a freshly priced bundle as never priced.
--
-- WHAT THIS DOES
-- --------------
--   * house_item_costs -- admin-only, keyed by ITEM rather than by bundle line.
--     A house item costs the same whichever bundle it sits in, and keying by
--     item means no bundle edit can ever touch it.
--   * admin_publish_price_week -- the whole run in one transaction.
--   * set_experience_items -- removes only the lines that were removed.
--   * admin_catalogue_report -- the report screen, in one admin-gated read.
--
-- The old column is NOT dropped here. The live client still names it in its
-- select, and dropping it before the new client is deployed would make every
-- bundle on the shelf fail to load. It goes in the next migration, once the
-- deploy that stops reading it is live.
--
-- BLAST RADIUS: Critical global -- it sets items.price_zmw, which checkout
-- charges. Bounded: it only ever writes items owned by the KithLy house shop,
-- and refuses the whole run if asked to touch anything else.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Costs, where only admins can see them
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.house_item_costs (
  item_id           uuid PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
  -- This week's cost, ngwee.
  sourced_cost_zmw  integer NOT NULL CHECK (sourced_cost_zmw >= 0),
  -- Last run's cost, ngwee. The report measures movement against this. Null
  -- the first time an item is ever priced: there is nothing to have moved from.
  previous_cost_zmw integer CHECK (previous_cost_zmw >= 0),
  priced_at         timestamptz NOT NULL DEFAULT now(),
  -- The run that last wrote this row. A retried publish carries the same run
  -- id, and that is how a retry avoids shifting this week's cost into
  -- previous_cost_zmw and erasing the real week-on-week movement.
  run_id            uuid NOT NULL
);

COMMENT ON TABLE public.house_item_costs IS
  'What the KithLy house shop pays in town for an item, ngwee. Admin-only:
   cost beside price is margin. Written only by admin_publish_price_week.';

ALTER TABLE public.house_item_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS house_item_costs_admin_read ON public.house_item_costs;
CREATE POLICY house_item_costs_admin_read ON public.house_item_costs
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

-- No write policy on purpose: every write goes through the RPC below. The
-- grants say the same thing a second way, so a policy added later by mistake
-- still cannot open it to anon.
REVOKE ALL ON public.house_item_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.house_item_costs TO authenticated;

-- Carry across anything already recorded. Every value was null when this was
-- written, but a price run published between writing and applying would
-- otherwise be lost. Latest priced line wins where an item sits in two bundles.
INSERT INTO public.house_item_costs (item_id, sourced_cost_zmw, priced_at, run_id)
SELECT DISTINCT ON (ei.item_id)
       ei.item_id, ei.sourced_cost_zmw, COALESCE(ei.priced_at, now()), gen_random_uuid()
FROM public.experience_items ei
WHERE ei.sourced_cost_zmw IS NOT NULL
ORDER BY ei.item_id, ei.priced_at DESC NULLS LAST
ON CONFLICT (item_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. The broken instrument goes; the report below replaces it
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.experience_price_health(uuid);


-- ---------------------------------------------------------------------------
-- 3. Publishing a week, atomically
--
-- p_costs is {"<item_id>": <cost in ngwee>, ...}. Items not named are left
-- exactly as they were -- re-stamping a price nobody re-checked is the one
-- thing a price run must never do.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_publish_price_week(
  p_costs       jsonb,
  p_valid_until date,
  p_run_id      uuid
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_bps     integer;
  v_house   uuid;
  v_houses  integer;
  v_now     timestamptz := now();
  v_key     text;
  v_val     jsonb;
  v_item    uuid;
  v_cost    integer;
  v_sell    integer;
  v_count   integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  -- IS DISTINCT FROM, not <>: a user with no role gets NULL back, and
  -- `NULL <> 'admin'` is NULL, which an IF treats as false and lets through.
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins may publish prices';
  END IF;

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'A run id is required';
  END IF;
  IF p_costs IS NULL OR jsonb_typeof(p_costs) <> 'object' OR p_costs = '{}'::jsonb THEN
    RAISE EXCEPTION 'Nothing to publish';
  END IF;
  -- A weekly lock. A month is generous; a typed 2062 is a promise nobody means.
  IF p_valid_until IS NULL
     OR p_valid_until < current_date
     OR p_valid_until > current_date + 31 THEN
    RAISE EXCEPTION 'Prices can be held from today up to 31 days ahead';
  END IF;

  SELECT experience_markup_bps INTO v_bps FROM public.platform_settings WHERE id = 1;
  IF v_bps IS NULL THEN
    RAISE EXCEPTION 'platform_settings.experience_markup_bps is not set';
  END IF;

  -- Found by name, as create_quotation finds it. Exactly one, or stop: two
  -- shops called KithLy would make "the house shop" a guess.
  SELECT count(*), min(id::text)::uuid INTO v_houses, v_house
  FROM public.shops WHERE name = 'KithLy';
  IF v_houses <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one KithLy house shop, found %', v_houses;
  END IF;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_costs) LOOP
    v_item := v_key::uuid;

    IF jsonb_typeof(v_val) <> 'number'
       OR (v_val::text)::numeric <> trunc((v_val::text)::numeric)
       OR (v_val::text)::numeric < 0
       OR (v_val::text)::numeric > 1000000000 THEN
      RAISE EXCEPTION 'Cost for item % must be a whole number of ngwee', v_item;
    END IF;
    v_cost := ((v_val::text)::numeric)::integer;

    -- The guard that keeps this a HOUSE price run. A merchant prices their own
    -- goods; nothing entered here may ever reprice one.
    IF NOT EXISTS (SELECT 1 FROM public.items WHERE id = v_item AND shop_id = v_house) THEN
      RAISE EXCEPTION 'Item % is not a KithLy house item', v_item;
    END IF;

    v_sell := round(v_cost * (10000 + v_bps) / 10000.0)::integer;

    INSERT INTO public.house_item_costs AS c
      (item_id, sourced_cost_zmw, previous_cost_zmw, priced_at, run_id)
    VALUES (v_item, v_cost, NULL, v_now, p_run_id)
    ON CONFLICT (item_id) DO UPDATE SET
      -- A retry of the same run keeps the previous cost it already recorded.
      previous_cost_zmw = CASE WHEN c.run_id = p_run_id
                               THEN c.previous_cost_zmw
                               ELSE c.sourced_cost_zmw END,
      sourced_cost_zmw  = excluded.sourced_cost_zmw,
      priced_at         = excluded.priced_at,
      run_id            = excluded.run_id;

    -- What checkout charges. checkout_init_atomic prices from items.price_zmw
    -- and ignores client figures, so this IS the lock taking effect.
    UPDATE public.items SET price_zmw = v_sell WHERE id = v_item;

    -- The published record, on every bundle line carrying this item.
    UPDATE public.experience_items
    SET locked_price_zmw = v_sell, priced_at = v_now
    WHERE item_id = v_item;

    v_count := v_count + 1;
  END LOOP;

  -- Only bundles that had a line repriced get their window moved.
  UPDATE public.experiences e
  SET price_valid_until = p_valid_until
  WHERE EXISTS (
    SELECT 1 FROM public.experience_items ei
    WHERE ei.experience_id = e.id
      AND ei.item_id IN (SELECT key::uuid FROM jsonb_each(p_costs))
  );

  INSERT INTO public.admin_action_log (actor_id, action, target_type, target_id, payload)
  VALUES (v_actor, 'PRICE_WEEK_PUBLISHED', 'price_book', NULL,
          jsonb_build_object('run_id', p_run_id, 'items', v_count,
                             'valid_until', p_valid_until, 'markup_bps', v_bps));

  RETURN v_count;
END;
$$;

-- Supabase grants EXECUTE to anon by default, so PUBLIC alone is not enough.
REVOKE ALL ON FUNCTION public.admin_publish_price_week(jsonb, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_price_week(jsonb, date, uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- 4. Editing a bundle no longer erases its prices
--
-- Identical to 20260727060000 except the DELETE: it now removes only the lines
-- whose item is no longer in the list. Lines that stay are updated in place by
-- the existing ON CONFLICT, so their locked price and priced_at survive, and
-- the insert trigger only fires -- only notifies a merchant -- for an item
-- that is genuinely new to the bundle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_experience_items(
  p_experience_id uuid,
  p_items         jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_item_id uuid;
  v_qty integer;
  v_count integer := 0;
  i integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may curate experiences';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.experiences WHERE id = p_experience_id) THEN
    RAISE EXCEPTION 'Experience not found';
  END IF;

  DELETE FROM public.experience_items ei
  WHERE ei.experience_id = p_experience_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS l
      WHERE (l->>'item_id')::uuid = ei.item_id
    );

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;

  FOR i IN 0..jsonb_array_length(p_items) - 1 LOOP
    v_line := p_items->i;
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty := COALESCE((v_line->>'quantity')::integer, 1);

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Every line needs an item';
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be at least 1';
    END IF;

    -- A quote item belongs to the conversation that produced it and cannot be
    -- resold inside a curated listing.
    IF EXISTS (SELECT 1 FROM public.items WHERE id = v_item_id AND is_quote_only = true) THEN
      RAISE EXCEPTION 'Custom quote items cannot be added to an experience';
    END IF;

    INSERT INTO public.experience_items (experience_id, item_id, quantity, note, sort_order)
    VALUES (p_experience_id, v_item_id, v_qty, nullif(btrim(coalesce(v_line->>'note','')), ''), i)
    ON CONFLICT (experience_id, item_id)
    DO UPDATE SET quantity = excluded.quantity,
                  note = excluded.note,
                  sort_order = excluded.sort_order;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.experiences SET updated_at = now() WHERE id = p_experience_id;

  RETURN v_count;
END;
$$;


-- ---------------------------------------------------------------------------
-- 5. The catalogue report
--
-- "Is the shelf honest, and is it earning?" in one read, for /admin/catalogue-report.
--
-- Per experience:
--   shown_ngwee    what the shelf displays (the lock where there is one)
--   charged_ngwee  what checkout would charge right now (items.price_zmw)
--   drift_lines    house lines where those two disagree -- a house item whose
--                  price was changed outside the price run. The shelf is then
--                  promising one figure and the till taking another.
--   stale_lines    house lines never priced, or past the bundle's window
--   cost / margin  over costed house lines only; uncosted_lines says how much
--                  of the bundle that leaves out, so a margin is never
--                  presented as more complete than it is. Shop lines have no
--                  KithLy cost -- they earn the buyer fee, not a markup.
--   movement_bps   this run's costs against last run's, weighted by quantity
--                  over lines that have both. The ceiling is measured on the
--                  basket, never per line (the locked commercial term).
--   sales          paid shop_orders tagged with the experience. One sale can
--                  be several shop_orders (one per shop), hence the distinct
--                  transaction count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_catalogue_report()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_house   uuid;
  v_bps     integer;
  v_ceiling integer;
  v_result  jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins may read the catalogue report';
  END IF;

  SELECT id INTO v_house FROM public.shops WHERE name = 'KithLy' LIMIT 1;
  SELECT experience_markup_bps, experience_ceiling_bps
    INTO v_bps, v_ceiling
  FROM public.platform_settings WHERE id = 1;

  WITH lines AS (
    SELECT
      ei.experience_id,
      ei.quantity                                 AS qty,
      ei.locked_price_zmw                         AS locked,
      i.price_zmw                                 AS price,
      COALESCE(i.is_available, true)              AS available,
      (v_house IS NOT NULL AND i.shop_id = v_house) AS is_house,
      c.sourced_cost_zmw                          AS cost,
      c.previous_cost_zmw                         AS prev_cost
    FROM public.experience_items ei
    JOIN public.items i ON i.id = ei.item_id
    LEFT JOIN public.house_item_costs c ON c.item_id = ei.item_id
  ),
  per_exp AS (
    SELECT
      e.id, e.name, e.slug, e.occasion_kind, e.is_active, e.is_featured,
      e.price_valid_until,
      count(l.*)                                                   AS line_count,
      count(l.*) FILTER (WHERE l.is_house)                         AS house_lines,
      count(l.*) FILTER (WHERE l.is_house AND l.cost IS NULL)      AS uncosted_lines,
      count(l.*) FILTER (WHERE NOT l.available)                    AS unavailable_lines,
      count(l.*) FILTER (WHERE l.is_house AND l.locked IS NOT NULL
                               AND l.locked <> l.price)            AS drift_lines,
      count(l.*) FILTER (WHERE l.is_house AND (
                   l.locked IS NULL
                   OR e.price_valid_until IS NULL
                   OR e.price_valid_until < current_date))         AS stale_lines,
      COALESCE(sum(l.qty * COALESCE(l.locked, l.price)), 0)        AS shown,
      COALESCE(sum(l.qty * l.price), 0)                            AS charged,
      COALESCE(sum(l.qty * l.cost)  FILTER (WHERE l.is_house AND l.cost IS NOT NULL), 0) AS cost,
      COALESCE(sum(l.qty * l.price) FILTER (WHERE l.is_house AND l.cost IS NOT NULL), 0) AS costed_revenue,
      COALESCE(sum(l.qty * l.prev_cost) FILTER (WHERE l.is_house AND l.prev_cost IS NOT NULL), 0) AS cost_then,
      COALESCE(sum(l.qty * l.cost)      FILTER (WHERE l.is_house AND l.prev_cost IS NOT NULL), 0) AS cost_now
    FROM public.experiences e
    LEFT JOIN lines l ON l.experience_id = e.id
    GROUP BY e.id
  ),
  sales AS (
    SELECT
      so.experience_id,
      count(DISTINCT so.transaction_id) FILTER (WHERE so.created_at >= now() - interval '30 days') AS orders_30d,
      COALESCE(sum(so.subtotal) FILTER (WHERE so.created_at >= now() - interval '30 days'), 0)   AS gmv_30d,
      count(DISTINCT so.transaction_id)                                                        AS orders_all,
      COALESCE(sum(so.subtotal), 0)                                                            AS gmv_all
    FROM public.shop_orders so
    WHERE so.experience_id IS NOT NULL
      AND so.claim_status NOT IN ('PENDING_PAYMENT', 'CANCELLED', 'EXPIRED', 'REFUNDED')
    GROUP BY so.experience_id
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'house_shop_found', v_house IS NOT NULL,
    'markup_bps', v_bps,
    'ceiling_bps', v_ceiling,
    'experiences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'slug', p.slug,
        'occasion_kind', p.occasion_kind,
        'is_active', p.is_active,
        'is_featured', p.is_featured,
        'price_valid_until', p.price_valid_until,
        'lines', p.line_count,
        'house_lines', p.house_lines,
        'uncosted_lines', p.uncosted_lines,
        'unavailable_lines', p.unavailable_lines,
        'drift_lines', p.drift_lines,
        'stale_lines', p.stale_lines,
        'shown_ngwee', p.shown,
        'charged_ngwee', p.charged,
        'cost_ngwee', p.cost,
        'margin_ngwee', p.costed_revenue - p.cost,
        'movement_bps', CASE WHEN p.cost_then = 0 THEN NULL
                             ELSE round(((p.cost_now - p.cost_then)::numeric / p.cost_then) * 10000) END,
        'breached', CASE WHEN p.cost_then = 0 OR v_ceiling IS NULL THEN false
                         ELSE ((p.cost_now - p.cost_then)::numeric / p.cost_then) * 10000 > v_ceiling END,
        'orders_30d', COALESCE(s.orders_30d, 0),
        'gmv_30d_ngwee', COALESCE(s.gmv_30d, 0),
        'orders_all', COALESCE(s.orders_all, 0),
        'gmv_all_ngwee', COALESCE(s.gmv_all, 0)
      ) ORDER BY p.is_active DESC, p.name)
      FROM per_exp p LEFT JOIN sales s ON s.experience_id = p.id
    ), '[]'::jsonb),
    -- Every kind in the one taxonomy, with how many live bundles it holds.
    'occasions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('kind', olt.kind, 'active', (
               SELECT count(*) FROM public.experiences e
               WHERE e.occasion_kind = olt.kind AND e.is_active)) ORDER BY olt.kind)
      FROM public.occasion_lead_times olt
    ), '[]'::jsonb),
    -- What people ask for that the shelf does not have. The admin_buyer kind
    -- is the request desk; see useRequestInbox.
    'tags', COALESCE((
      SELECT jsonb_agg(t ORDER BY (t->>'requests')::int DESC, t->>'tag')
      FROM (
        SELECT jsonb_build_object(
                 'tag', cv.request_tag,
                 'requests', count(*),
                 'open', count(*) FILTER (WHERE NOT cv.is_closed),
                 'last_at', max(cv.created_at)) AS t
        FROM public.conversations cv
        WHERE cv.kind = 'admin_buyer' AND cv.request_tag IS NOT NULL
        GROUP BY cv.request_tag
        ORDER BY count(*) DESC, cv.request_tag
        LIMIT 25
      ) x
    ), '[]'::jsonb),
    'untagged_requests', (
      SELECT count(*) FROM public.conversations cv
      WHERE cv.kind = 'admin_buyer' AND cv.request_tag IS NULL
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_catalogue_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_catalogue_report() TO authenticated;
