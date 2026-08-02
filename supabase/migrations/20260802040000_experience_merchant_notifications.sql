-- =============================================================================
-- Tell merchants when their items are sold inside an Experience
--
-- An admin can bundle any shop's items into an Experience and publish it. The
-- merchant was never told: no notification, and nothing on their dashboard
-- listing which experiences carry their products. Orders then arrive against a
-- listing they did not know existed.
--
-- Handled with triggers rather than by editing set_experience_items(), because
-- the two orderings an admin can work in must both be covered:
--
--   build then publish  -> items already attached when is_active flips true
--   publish then build  -> items attached to an already-live experience
--
-- A trigger on each side catches its own case. Notifications only ever fire
-- for a live experience, so drafting stays silent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shared sender
--
-- One notification per shop owner, not per item — an experience carrying four
-- of a shop's products should not produce four identical bell entries.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_experience_shop_owners(
  p_experience_id uuid,
  p_item_id       uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_owner RECORD;
BEGIN
  SELECT name INTO v_name FROM public.experiences WHERE id = p_experience_id;
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  FOR v_owner IN
    SELECT DISTINCT s.owner_id
    FROM public.experience_items ei
    JOIN public.items i ON i.id = ei.item_id
    JOIN public.shops s ON s.id = i.shop_id
    WHERE ei.experience_id = p_experience_id
      AND (p_item_id IS NULL OR ei.item_id = p_item_id)
      AND s.owner_id IS NOT NULL
  LOOP
    PERFORM public.create_notification(
      v_owner.owner_id,
      'Your products are featured in the "' || v_name || '" experience, now live on KithLy.',
      'announcement',
      p_experience_id::text);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Publishing an experience
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_experience_published()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active AND NOT COALESCE(OLD.is_active, false) THEN
    PERFORM public.notify_experience_shop_owners(NEW.id, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS experience_published_notify ON public.experiences;
CREATE TRIGGER experience_published_notify
  AFTER UPDATE OF is_active ON public.experiences
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_experience_published();

-- ---------------------------------------------------------------------------
-- 3. Adding an item to an experience that is already live
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_experience_item_added()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.experiences
    WHERE id = NEW.experience_id AND is_active = true
  ) THEN
    PERFORM public.notify_experience_shop_owners(NEW.experience_id, NEW.item_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS experience_item_added_notify ON public.experience_items;
CREATE TRIGGER experience_item_added_notify
  AFTER INSERT ON public.experience_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_experience_item_added();
