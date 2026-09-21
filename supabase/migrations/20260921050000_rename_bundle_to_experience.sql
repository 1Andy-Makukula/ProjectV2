-- =============================================================================
-- Correcting a name collision introduced two migrations ago
--
-- `src/app/types/experiences.ts` opens with a rule:
--
--   "Named 'experience' rather than 'bundle' on purpose: in this codebase a
--    bundle already means the set of items under one claim code at the
--    fulfilment terminal (the Smart Bundle Protocol), and reusing the word
--    would make merchant-facing language ambiguous."
--
-- 20260921030000 then added `bundle_markup_bps`, `bundle_ceiling_bps` and
-- `bundle_price_health()` -- all of which mean the curated multi-item
-- offering, i.e. an EXPERIENCE, not the claim-code set a merchant sees at the
-- terminal. Two different things now shared one word, which is exactly the
-- ambiguity that comment exists to prevent.
--
-- Renamed while there is one consumer. Left alone, a merchant support call
-- about "the bundle price" would have had two correct and incompatible
-- answers.
--
-- The customer-facing word can still be whatever reads best on the shelf --
-- "box", "bundle", "a month of essentials". This is about the names in the
-- schema and the code, which have to be unambiguous for the people reading
-- them at two in the morning.
--
-- BLAST RADIUS: Local. The columns and function were added the same day, have
-- exactly one consumer (usePriceBook), and are not on the money path.
-- =============================================================================

ALTER TABLE public.platform_settings
  RENAME COLUMN bundle_markup_bps TO experience_markup_bps;

ALTER TABLE public.platform_settings
  RENAME COLUMN bundle_ceiling_bps TO experience_ceiling_bps;

ALTER TABLE public.platform_settings
  RENAME CONSTRAINT platform_settings_bundle_markup_check
                 TO platform_settings_experience_markup_check;

ALTER TABLE public.platform_settings
  RENAME CONSTRAINT platform_settings_bundle_ceiling_check
                 TO platform_settings_experience_ceiling_check;

COMMENT ON COLUMN public.platform_settings.experience_markup_bps IS
  'Markup over sourced cost on KithLy-sourced experience lines, in basis
   points. 500 = 5%, agreed 21 Sep as a starting figure to be re-sized against
   observed weekly volatility rather than left unexamined.';

COMMENT ON COLUMN public.platform_settings.experience_ceiling_bps IS
  'How far a sourced cost may rise before the published price is VOIDED and
   re-quoted instead of absorbed, in basis points. 2000 = 20%. Evaluated on
   the experience''s weighted total, never on a single line.';

DROP FUNCTION IF EXISTS public.bundle_price_health(uuid);

CREATE OR REPLACE FUNCTION public.experience_price_health(p_experience_id uuid)
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
    -- Movement in basis points on the WEIGHTED total. Zero when there is no
    -- prior cost to compare against -- an experience never priced, rather
    -- than one that has not moved.
    'movement_bps', CASE
      WHEN t.cost_then = 0 THEN 0
      ELSE ROUND(((t.cost_now - t.cost_then)::numeric / t.cost_then) * 10000)
    END,
    'ceiling_bps', ps.experience_ceiling_bps,
    'breached', CASE
      WHEN t.cost_then = 0 THEN false
      ELSE ((t.cost_now - t.cost_then)::numeric / t.cost_then) * 10000 > ps.experience_ceiling_bps
    END
  )
  FROM totals t CROSS JOIN public.platform_settings ps
  WHERE ps.id = 1;
$$;

REVOKE ALL ON FUNCTION public.experience_price_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.experience_price_health(uuid) TO authenticated;

COMMENT ON FUNCTION public.experience_price_health(uuid) IS
  'Weekly price-run instrument. Reports an experience''s locked total against
   what its lines would cost today, the weighted movement in basis points, and
   whether the ceiling has been breached. Reports only -- voiding a published
   price is a human decision, and an accepted order is never re-priced.';
