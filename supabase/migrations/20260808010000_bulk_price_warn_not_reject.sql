-- =============================================================================
-- Bulk pricing: warn on a non-discount rather than refusing the save
--
-- ---------------------------------------------------------------------------
-- Why the hard rejection is going
-- ---------------------------------------------------------------------------
-- validate_price_tier raised an exception whenever a tier was not below the
-- item's unit price. That was strict enough to block a merchant from saving the
-- item at all, and the live data showed why it bites: 9 of 10 wholesale-flagged
-- items had been entered as the total cost of a pack rather than a per-unit
-- rate, so every one of them would have been un-saveable rather than merely
-- wrong. The merchant is now warned in the form and the value is accepted.
--
-- ---------------------------------------------------------------------------
-- Accepting the value must not mean charging it
-- ---------------------------------------------------------------------------
-- unit_price_for takes MIN() across qualifying tiers, so a stored tier of
-- K950.00 against a K249.99 unit price would have been selected and the buyer
-- charged nearly four times the shelf price. A data-entry slip must never
-- become an overcharge.
--
-- The price is therefore capped at the item's own price_zmw: a tier below it
-- discounts as intended, and a tier at or above it has no effect at all. The
-- row is kept so the merchant can see and correct what they typed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stop rejecting
--
-- The remaining guarantees (positive price, minimum of 2, one row per
-- threshold) are all CHECK constraints and a unique index, which stay.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS item_price_tiers_validate ON public.item_price_tiers;
DROP FUNCTION IF EXISTS public.validate_price_tier();

-- ---------------------------------------------------------------------------
-- 2. A tier can lower the price, never raise it
--
-- LEAST against the base is the safety net that lets step 1 be safe. Note this
-- also means the function is correct for rows written before this migration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unit_price_for(p_item_id uuid, p_quantity integer)
RETURNS integer
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT LEAST(
    COALESCE(
      (
        SELECT MIN(t.unit_price_zmw)
        FROM public.item_price_tiers t
        WHERE t.item_id = p_item_id
          AND t.min_quantity <= GREATEST(COALESCE(p_quantity, 1), 1)
      ),
      (SELECT price_zmw FROM public.items WHERE id = p_item_id)
    ),
    (SELECT price_zmw FROM public.items WHERE id = p_item_id)
  )
$$;

REVOKE ALL ON FUNCTION public.unit_price_for(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unit_price_for(uuid, integer) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill the rows the old trigger turned away
--
-- The nine pack-total entries were rejected by validate_price_tier when
-- 20260808000000 ran, so they never became tiers. They are brought across now
-- that a non-discount is tolerated: the merchant can see the number they
-- originally typed sitting in the editor, flagged, instead of finding the
-- section empty and wondering where their wholesale rate went.
--
-- Capped at charge time by unit_price_for, so importing them changes no price.
-- ---------------------------------------------------------------------------
INSERT INTO public.item_price_tiers (item_id, min_quantity, unit_price_zmw)
SELECT i.id, GREATEST(COALESCE(i.minimum_order_quantity, 2), 2), i.wholesale_price_zmw
FROM public.items i
WHERE i.is_wholesale IS TRUE
  AND i.wholesale_price_zmw IS NOT NULL
  AND i.wholesale_price_zmw > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.item_price_tiers t WHERE t.item_id = i.id
  );
