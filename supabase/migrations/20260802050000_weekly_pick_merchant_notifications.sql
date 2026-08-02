-- =============================================================================
-- Tell merchants when an item enters or leaves Weekly Picks
--
-- Weekly Picks decides what the storefront promotes, and admins toggle it per
-- item without the shop being told. A merchant could be driving traffic on the
-- strength of a feature that had already been removed, or miss preparing stock
-- for one that had just been added.
--
-- A trigger rather than a change to useWeeklyPicks(): the toggle is a plain
-- client UPDATE against items, so anything else that flips the column later —
-- another screen, a backfill, a manual fix — is covered by the same path.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_item_weekly_pick_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  IF COALESCE(NEW.is_weekly_pick, false) = COALESCE(OLD.is_weekly_pick, false) THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = NEW.shop_id;
  IF v_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.create_notification(
    v_owner_id,
    CASE
      WHEN NEW.is_weekly_pick THEN
        'Your item "' || NEW.name || '" is now featured in this week''s picks on KithLy.'
      ELSE
        'Your item "' || NEW.name || '" is no longer featured in this week''s picks.'
    END,
    CASE WHEN NEW.is_weekly_pick THEN 'announcement' ELSE 'info' END,
    NEW.id::text);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS item_weekly_pick_notify ON public.items;
CREATE TRIGGER item_weekly_pick_notify
  AFTER UPDATE OF is_weekly_pick ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_item_weekly_pick_changed();
