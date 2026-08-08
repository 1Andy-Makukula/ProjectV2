-- =============================================================================
-- Bulk pricing: block a tier that is not cheaper, after all
--
-- Reverses 20260808010000, which relaxed the rejection to a warning. That
-- change fixed the merchant's understanding and left the buyer's view broken:
-- ItemDetail renders every tier on an item without filtering, so an accepted
-- tier of K950.00 against a K249.99 unit price advertised "4 or more ·
-- ZMW 950.00 each" on the storefront, and the cart's next-tier nudge offered
-- "add 3 more for ZMW 950.00 each". The LEAST() cap meant nobody was ever
-- charged it, but the platform was still displaying bulk pricing dearer than
-- buying singly.
--
-- A tier that is not a discount has no legitimate use, so the entry point is
-- the right place to refuse it.
--
-- ---------------------------------------------------------------------------
-- Order matters here
-- ---------------------------------------------------------------------------
-- 20260808010000 backfilled the nine pack-total rows that the original trigger
-- had turned away. Restoring the trigger while they exist would make those
-- items unsaveable: the merchant could not change a stock level without first
-- fixing a bulk price they may not have set. So the inert rows are removed
-- first, and the constraint is reinstated over clean data.
--
-- The rows carried no pricing effect, and items.wholesale_price_zmw still holds
-- the original figure, so nothing is lost that cannot be looked up.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Clear the tiers that never applied
-- ---------------------------------------------------------------------------
DELETE FROM public.item_price_tiers t
USING public.items i
WHERE i.id = t.item_id
  AND t.unit_price_zmw >= i.price_zmw;

-- ---------------------------------------------------------------------------
-- 2. Refuse a bulk price that is not below the unit price
--
-- The message names the mistake rather than restating the rule: the live data
-- showed nine of ten wholesale prices had been entered as the cost of the whole
-- pack, so that is what a merchant hitting this has most likely done.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_price_tier()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_base integer;
BEGIN
  SELECT price_zmw INTO v_base FROM public.items WHERE id = NEW.item_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Item % not found', NEW.item_id;
  END IF;

  IF NEW.unit_price_zmw >= v_base THEN
    RAISE EXCEPTION
      'Bulk price % is not below the unit price % — enter the price of ONE unit at this quantity, not the total for the pack',
      NEW.unit_price_zmw, v_base;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS item_price_tiers_validate ON public.item_price_tiers;
CREATE TRIGGER item_price_tiers_validate
  BEFORE INSERT OR UPDATE ON public.item_price_tiers
  FOR EACH ROW EXECUTE FUNCTION public.validate_price_tier();

-- ---------------------------------------------------------------------------
-- 3. The cap stays
--
-- unit_price_for keeps its LEAST() against the base price. With the trigger
-- back it should be unreachable, which is exactly why it is worth keeping:
-- it is the difference between a bad row being inert and a buyer being
-- overcharged, and it costs nothing.
-- ---------------------------------------------------------------------------
