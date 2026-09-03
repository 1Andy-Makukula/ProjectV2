-- =============================================================================
-- Lists: make creation work again, and let a list hold shops as well as items
--
-- 1. generate_list_slug could not be called from the browser
-- ---------------------------------------------------------------------------
-- 20260809050000 revoked EXECUTE on every function in `public` and granted back
-- an allowlist. generate_list_slug is on that allowlist -- but it runs with
-- INVOKER rights and its body calls gen_claim_code(6), which the same migration
-- deliberately locks away from anon and authenticated. So the grant was on the
-- wrong function: every "New list" from the browser died with
--
--   permission denied for function gen_claim_code
--
-- Marking it SECURITY DEFINER makes the inner call run as the function owner,
-- which is what the allowlist meant all along. gen_claim_code itself stays
-- unreachable to anon/authenticated -- the assertion in 20260809050000 still
-- holds -- and the exposed surface is unchanged: a caller could already ask for
-- a slug, and a slug is all they get back.
--
-- 2. list_items could only hold items
-- ---------------------------------------------------------------------------
-- A list is meant to be "everything for a braai" -- which includes the butcher
-- as much as the meat. The table only had item_id, so a shop could not be put
-- on a list at all.
--
-- entry_kind is explicit rather than inferred from which id is set, because
-- both FKs are ON DELETE SET NULL: once the target is deleted an inferred kind
-- would be unknowable, and the entry has to keep rendering as the greyed
-- "no longer available" row it was.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Slug allocation runs as its owner
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_list_slug(p_title text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_base text;
  v_slug text;
  v_attempt integer := 0;
BEGIN
  v_base := btrim(regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g'), '-');
  IF v_base = '' THEN
    v_base := 'list';
  END IF;
  v_base := left(v_base, 48);

  LOOP
    v_slug := v_base || '-' || lower(public.gen_claim_code(6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lists WHERE slug = v_slug);

    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not allocate a unique slug';
    END IF;
  END LOOP;

  RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_list_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_list_slug(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Shops as list entries
-- ---------------------------------------------------------------------------
ALTER TABLE public.list_items
  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shops(id) ON DELETE SET NULL;

-- Existing rows are all item entries, which is exactly what the default says.
ALTER TABLE public.list_items
  ADD COLUMN IF NOT EXISTS entry_kind text NOT NULL DEFAULT 'item';

ALTER TABLE public.list_items DROP CONSTRAINT IF EXISTS list_items_entry_kind_check;
ALTER TABLE public.list_items
  ADD CONSTRAINT list_items_entry_kind_check CHECK (entry_kind IN ('item', 'shop'));

-- An entry points at one kind of thing. The id may be NULL -- both FKs are
-- SET NULL -- but it can never be the id belonging to the other kind.
ALTER TABLE public.list_items DROP CONSTRAINT IF EXISTS list_items_single_target_check;
ALTER TABLE public.list_items
  ADD CONSTRAINT list_items_single_target_check CHECK (
    (entry_kind = 'item' AND shop_id IS NULL)
    OR (entry_kind = 'shop' AND item_id IS NULL)
  );

-- A shop appears once per list, matching list_items_unique_item_idx.
CREATE UNIQUE INDEX IF NOT EXISTS list_items_unique_shop_idx
  ON public.list_items (list_id, shop_id)
  WHERE shop_id IS NOT NULL;

COMMENT ON COLUMN public.list_items.entry_kind IS
  'What the entry points at: an item (product or service) or a whole shop. Survives deletion of the target, which nulls the id.';
