-- =============================================================================
-- Shop documents: private storage, and two constraint gaps closed
--
-- ---------------------------------------------------------------------------
-- 1. The documents were world-readable
-- ---------------------------------------------------------------------------
-- 20260808020000 put RLS on shop_documents so only the shop's own merchants and
-- admins could read the rows — but the files went through uploadPublicAsset,
-- which writes to `storefront-assets`, a PUBLIC bucket. A pharmacy licence or
-- an NRC therefore had a permanent, unauthenticated URL. Protecting the row
-- while publishing the file protects nothing: the row only holds the link.
--
-- The upload helper was reused from storefront imagery, where public is exactly
-- right. Compliance paperwork is the opposite case.
--
-- Documents now live in a private bucket, the table stores a storage path
-- rather than a URL, and the client mints a short-lived signed URL when someone
-- entitled to see one actually asks. shop_documents is empty in production, so
-- nothing has leaked and there is nothing to migrate.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('shop-documents', 'shop-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ---------------------------------------------------------------------------
-- Path-based access
--
-- Objects are stored as `<shop_id>/<uuid>.<ext>`, so the first folder segment
-- identifies the owning shop. Compared as text rather than cast to uuid: a
-- malformed path must fail the check, not raise 22P02 and break the query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_shop_document_folder(p_folder text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_folder IS NOT NULL
     AND (
       public.current_user_role() = 'admin'
       OR EXISTS (
         SELECT 1
         FROM public.merchant_shops ms
         WHERE ms.user_id = auth.uid()
           AND ms.shop_id::text = p_folder
       )
     )
$$;

REVOKE ALL ON FUNCTION public.can_access_shop_document_folder(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_shop_document_folder(text) TO authenticated, service_role;

DROP POLICY IF EXISTS shop_documents_objects_read ON storage.objects;
CREATE POLICY shop_documents_objects_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'shop-documents'
    AND public.can_access_shop_document_folder((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS shop_documents_objects_write ON storage.objects;
CREATE POLICY shop_documents_objects_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'shop-documents'
    AND public.can_access_shop_document_folder((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS shop_documents_objects_delete ON storage.objects;
CREATE POLICY shop_documents_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'shop-documents'
    AND public.can_access_shop_document_folder((storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- Store a path, not a URL
--
-- A signed URL expires, so persisting one is meaningless; the path is the
-- durable reference and the URL is minted per view.
--
-- The DELETE is a no-op in production (the table is empty). It exists so this
-- migration is honest anywhere it is not: a row whose file sits in the public
-- bucket cannot be carried across, because the whole point is that those files
-- are in the wrong place.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_documents ADD COLUMN IF NOT EXISTS storage_path text;

DELETE FROM public.shop_documents WHERE storage_path IS NULL;

ALTER TABLE public.shop_documents ALTER COLUMN storage_path SET NOT NULL;
ALTER TABLE public.shop_documents DROP COLUMN IF EXISTS document_url;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_documents_path_check') THEN
    ALTER TABLE public.shop_documents ADD CONSTRAINT shop_documents_path_check
      CHECK (btrim(storage_path) <> '');
  END IF;
END $$;

COMMENT ON COLUMN public.shop_documents.storage_path IS
  'Object path within the private shop-documents bucket, as <shop_id>/<uuid>.<ext>. Read through a short-lived signed URL.';

-- =============================================================================
-- 2. A tier could become a non-discount without ever being touched
--
-- validate_price_tier only fires on item_price_tiers. Lowering items.price_zmw
-- below an existing tier reaches the same broken state — a bulk price at or
-- above the unit price, which the storefront renders as though it were an offer
-- — through a path the tier trigger cannot see.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_tiers_below_price()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_offending integer;
BEGIN
  IF NEW.price_zmw IS NOT DISTINCT FROM OLD.price_zmw THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_offending
  FROM public.item_price_tiers t
  WHERE t.item_id = NEW.id
    AND t.unit_price_zmw >= NEW.price_zmw;

  IF v_offending > 0 THEN
    RAISE EXCEPTION
      'Cannot set the unit price to %: % bulk price(s) would be at or above it. Update or remove them first.',
      NEW.price_zmw, v_offending;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_tiers_below_price ON public.items;
CREATE TRIGGER items_tiers_below_price
  BEFORE UPDATE OF price_zmw ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tiers_below_price();

-- =============================================================================
-- 3. Option groups: the two shapes are exclusive
--
-- 20260808030000 constrained min_value/max_value by kind but left the rest of
-- each shape open, so a choice group could carry a per-unit delta and a
-- quantity group could be marked multi-select — fields that surface would have
-- to decide how to ignore.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_option_groups_shape_check') THEN
    ALTER TABLE public.item_option_groups ADD CONSTRAINT item_option_groups_shape_check
      CHECK (
        CASE kind
          -- A choice group prices each option individually.
          WHEN 'choice' THEN unit_price_delta_zmw = 0
          -- A quantity group is a number, so there is nothing to multi-select.
          WHEN 'quantity' THEN allow_multiple = false
          ELSE true
        END
      );
  END IF;
END $$;

-- A quantity group has no list to choose from, so it must own no options.
-- Cross-table, therefore a trigger rather than a CHECK.
CREATE OR REPLACE FUNCTION public.enforce_option_belongs_to_choice_group()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_kind text;
BEGIN
  SELECT kind INTO v_kind
  FROM public.item_option_groups
  WHERE id = NEW.group_id;

  IF v_kind IS DISTINCT FROM 'choice' THEN
    RAISE EXCEPTION 'Options can only be added to a choice group (group % is %)',
      NEW.group_id, COALESCE(v_kind, 'missing');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS item_options_choice_only ON public.item_options;
CREATE TRIGGER item_options_choice_only
  BEFORE INSERT OR UPDATE ON public.item_options
  FOR EACH ROW EXECUTE FUNCTION public.enforce_option_belongs_to_choice_group();
