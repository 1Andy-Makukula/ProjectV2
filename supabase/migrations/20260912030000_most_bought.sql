-- =============================================================================
-- P5 — Most bought, counted rather than claimed
--
-- The reference designs for the trending bar promise "500,000 Visits",
-- "15.3k Weekly Visits" and "151k BOUGHT THIS". Nothing in this database has
-- ever recorded a visit — there is no view, impression or session table in a
-- hundred migrations — so those first two numbers cannot be shown without
-- inventing them.
--
-- DECIDED 2026-09-12: everything starts from zero and only what is really
-- counted gets displayed. This migration ships the one that is genuinely
-- available today. "Most visited" waits until something records a visit.
--
-- ---------------------------------------------------------------------------
-- Why a function and not a view
-- ---------------------------------------------------------------------------
-- order_items is locked down by order_items_select: a row is visible to the
-- buyer, the recipient and admins, and to nobody else. That is correct and must
-- stay. But "how many of these were bought" is not private in the way "who
-- bought one" is, so this exposes the aggregate and never the rows.
--
-- SECURITY DEFINER with a fixed search_path, returning counts only. It cannot
-- be coaxed into returning an order, a buyer or a price.
--
-- ---------------------------------------------------------------------------
-- What counts as bought
-- ---------------------------------------------------------------------------
-- Only order_items whose transaction reached SUCCESS. A checkout that was
-- started and abandoned is not a purchase, and reclaim_abandoned_checkouts
-- exists precisely because plenty of them are. Counting those would inflate
-- every number on the bar in exactly the way this migration exists to avoid.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.most_bought_items(
  p_limit integer DEFAULT 5,
  p_days  integer DEFAULT 30,
  p_min   integer DEFAULT 1
)
RETURNS TABLE (
  item_id      uuid,
  name         text,
  image_url    text,
  shop_id      uuid,
  shop_name    text,
  bought_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    i.id,
    i.name,
    i.image_url,
    s.id,
    s.name,
    count(*) AS bought_count
  FROM public.order_items oi
  JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
  JOIN public.transactions t ON t.transaction_id = so.transaction_id
  JOIN public.items i ON i.id = oi.item_id
  JOIN public.shops s ON s.id = i.shop_id
  WHERE t.status = 'SUCCESS'
    AND so.created_at >= now() - make_interval(days => GREATEST(1, p_days))
    -- Only things somebody could still go and buy.
    AND i.is_available IS NOT FALSE
    AND s.is_active IS TRUE
  GROUP BY i.id, i.name, i.image_url, s.id, s.name
  -- The floor. A trending bar reading "1 bought" says "nothing happens here"
  -- more loudly than showing no bar at all does, so the caller sets a minimum
  -- and the module renders nothing until something clears it.
  HAVING count(*) >= GREATEST(1, p_min)
  ORDER BY count(*) DESC, i.name ASC
  LIMIT GREATEST(1, LEAST(p_limit, 20));
$$;

COMMENT ON FUNCTION public.most_bought_items(integer, integer, integer) IS
  'Purchase counts per item over a window, from SUCCESS transactions only. '
  'Aggregate exposure of order_items, which is otherwise readable only by the '
  'buyer and recipient — returns counts, never orders.';

REVOKE ALL ON FUNCTION public.most_bought_items(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.most_bought_items(integer, integer, integer)
  TO anon, authenticated, service_role;

-- Counting joins from order_items to shop_orders on every call; without this it
-- is a sequential scan of every order line the platform has ever taken.
CREATE INDEX IF NOT EXISTS order_items_item_idx ON public.order_items (item_id);
CREATE INDEX IF NOT EXISTS shop_orders_created_at_idx ON public.shop_orders (created_at DESC);
