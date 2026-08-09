-- =============================================================================
-- Shop documents are audit records: archive them, never destroy them
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- 20260808020000 gave merchants FOR ALL on shop_documents, and
-- 20260808050000 gave them DELETE on the storage objects. A merchant could
-- therefore erase their own compliance paperwork — row and file both,
-- permanently and with no trace.
--
-- These exist so there is a record if something goes wrong later. The moment
-- something goes wrong is precisely when somebody has a motive to remove what
-- they uploaded, so a merchant-erasable audit trail is not one.
--
-- ---------------------------------------------------------------------------
-- What changes
-- ---------------------------------------------------------------------------
-- Merchants may add, and may archive — which hides a document from their own
-- working view without touching the row or the file. They may no longer delete
-- either. Admins retain full control, including hard deletion, because a
-- genuine erasure request has to be actionable by somebody.
--
-- Expiry stays exactly as it was: optional, and ignorable by anyone who only
-- wants an attachment.
-- =============================================================================

ALTER TABLE public.shop_documents ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.shop_documents.archived_at IS
  'Set when a merchant retires a document. The row and its file are retained — merchants cannot delete either.';

-- Archived rows are the minority and are filtered out of the default view.
CREATE INDEX IF NOT EXISTS shop_documents_active_idx
  ON public.shop_documents (shop_id, created_at DESC)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- 1. Table policies: split the merchant's blanket FOR ALL
--
-- FOR ALL included DELETE. Replaced by explicit SELECT / INSERT / UPDATE, with
-- no delete policy for merchants at all — under RLS, an operation with no
-- permitting policy is denied, so this needs no counter-rule.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shop_documents_owner_write ON public.shop_documents;

DROP POLICY IF EXISTS shop_documents_owner_insert ON public.shop_documents;
CREATE POLICY shop_documents_owner_insert ON public.shop_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_documents.shop_id AND ms.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS shop_documents_owner_update ON public.shop_documents;
CREATE POLICY shop_documents_owner_update ON public.shop_documents
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_documents.shop_id AND ms.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_documents.shop_id AND ms.user_id = auth.uid()
    )
  );

-- An UPDATE policy alone would let a merchant blank the label or repoint
-- storage_path at a different file, which erases the record just as effectively
-- as deleting the row. Archiving is the only field they may move.
CREATE OR REPLACE FUNCTION public.enforce_shop_document_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF public.current_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.shop_id      IS DISTINCT FROM OLD.shop_id
     OR NEW.label        IS DISTINCT FROM OLD.label
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.expires_at   IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'A document cannot be altered once uploaded. Archive it and add a replacement.';
  END IF;

  -- Un-archiving is the merchant's own business; it destroys nothing.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shop_documents_immutable ON public.shop_documents;
CREATE TRIGGER shop_documents_immutable
  BEFORE UPDATE ON public.shop_documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_document_immutable();

-- ---------------------------------------------------------------------------
-- 2. Storage: take DELETE away from merchants
--
-- Without this the table policy is theatre — the row would survive and the file
-- it points at would not, leaving an audit record of a document nobody can
-- open. Admins keep deletion for genuine erasure requests.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shop_documents_objects_delete ON storage.objects;
CREATE POLICY shop_documents_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'shop-documents'
    AND public.current_user_role() = 'admin'
  );

-- Overwriting an object in place would swap the file under a row that claims to
-- be a record of the original, so merchants get no UPDATE either.
DROP POLICY IF EXISTS shop_documents_objects_update ON storage.objects;
CREATE POLICY shop_documents_objects_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'shop-documents'
    AND public.current_user_role() = 'admin'
  );
