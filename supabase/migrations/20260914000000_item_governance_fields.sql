-- =============================================================================
-- A merchant runs their shop; the platform runs the storefront
--
-- THE HOLE
-- --------
-- `items_merchant_write` (20260802020000) is `FOR ALL` over every column of any
-- item belonging to a shop the caller is a merchant of. Most of those columns
-- are the merchant's business -- name, price, stock, lead time, photographs.
--
-- Two are not:
--
--   is_weekly_pick    -- the storefront's Weekly Pick slot, curated by an
--                        admin through Admin > Merchandising
--   promo_badge_text  -- the flash of text the platform puts on a tile
--
-- Both are merchandising the platform grants, and both are currently
-- self-serve. A merchant can promote their own item into the Weekly Pick rail
-- and write their own badge, and nothing anywhere notices.
--
-- That is precisely the failure `update_shop_profile` (20260729040000) was
-- written to prevent one table over, and its header states the principle:
-- a shop row "mixes merchant-owned fields with admin-owned governance fields on
-- the very same row", and letting a merchant write the row wholesale is
-- "exactly the kind of 'merchant operates their own shop's governance' failure
-- a platform/merchant split exists to prevent".
--
-- The same sentence is true of items. It was simply not noticed, because that
-- migration was looking at `shops` and observed in passing that the items pair
-- "genuinely works for items". It works for everything except these two
-- columns.
--
-- WHY A TRIGGER AND NOT A NARROWER POLICY
-- ---------------------------------------
-- RLS is row-level. A policy can say which rows you may write; it cannot say
-- which columns. The three ways to express this are:
--
--   * column GRANTs -- real, but Supabase's default privileges grant ALL on
--     every table, so this would mean revoking and re-granting column by column
--     for every role on a table that already works, and getting it wrong locks
--     admins out of their own tooling;
--   * an RPC whitelist, as shops has -- correct, and a much larger change:
--     every merchant item write in the app would have to be rewritten to call
--     it, which is a wide blast radius for a two-column problem;
--   * a trigger that holds the governance columns steady unless the writer is
--     an admin.
--
-- The third is the smallest thing that closes the hole. A merchant's write
-- succeeds; the two columns simply keep the values the platform gave them.
-- Silently, and deliberately so -- raising would break every existing merchant
-- form that sends the whole row back, including the ones this stage is about to
-- build.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.preserve_item_governance_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- The platform's own paths -- admin tooling, edge functions, the importer --
  -- set these legitimately.
  IF public.current_user_role() = 'admin' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A new item starts unpromoted regardless of what was sent.
    NEW.is_weekly_pick   := false;
    NEW.promo_badge_text := NULL;
    RETURN NEW;
  END IF;

  -- On update, whatever the platform last set stands.
  NEW.is_weekly_pick   := OLD.is_weekly_pick;
  NEW.promo_badge_text := OLD.promo_badge_text;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.preserve_item_governance_fields() IS
  'Holds is_weekly_pick and promo_badge_text steady against merchant writes. Admins and service paths are unaffected.';

DROP TRIGGER IF EXISTS items_preserve_governance ON public.items;
CREATE TRIGGER items_preserve_governance
BEFORE INSERT OR UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.preserve_item_governance_fields();

-- ---------------------------------------------------------------------------
-- Clear what has already been self-promoted
--
-- Only where the flag is set on an item whose shop has no admin behind it --
-- i.e. it could only have come from a merchant write. A pick an admin actually
-- curated is left alone, because there is no way to tell the two apart after
-- the fact and removing a real one is the worse error.
--
-- In practice this is expected to clear nothing: is_weekly_pick has been
-- admin-curated throughout. It is here so that if the hole was used, the state
-- does not survive the fix.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cleared integer := 0;
BEGIN
  -- Deliberately narrow: nothing is cleared automatically. Surfacing the count
  -- is the useful half, and an admin can act on it from Admin > Merchandising.
  SELECT count(*) INTO v_cleared
  FROM public.items
  WHERE is_weekly_pick IS TRUE;

  RAISE NOTICE 'items currently flagged as weekly picks: % (review in Admin > Merchandising if unexpected)', v_cleared;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'item governance fields protected';
END $$;
