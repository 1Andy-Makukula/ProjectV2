-- =============================================================================
-- Shop documents — however many a trade actually requires
--
-- ---------------------------------------------------------------------------
-- Why not another column
-- ---------------------------------------------------------------------------
-- shops already carries nrc_url, pacra_url and nrc_document_url: one column per
-- document type, added one at a time. A pharmacy needs a practising licence and
-- a premises permit; a food business needs a health certificate; a hardware
-- shop needs neither. That does not fit a fixed set of columns, and adding a
-- fifth for every regulated trade means a migration per profession.
--
-- This is a row per document instead, so a shop attaches as many as its trade
-- demands. The existing columns are left exactly as they are — they are read by
-- the KYC review flow and are not this change's business.
--
-- ---------------------------------------------------------------------------
-- Expiry is the point
-- ---------------------------------------------------------------------------
-- A licence that lapsed last month looks identical to a valid one if all you
-- store is a file. expires_at makes a lapsed document self-evident to the
-- merchant and to whoever reviews them, which is the whole reason a pharmacy's
-- paperwork is worth holding at all.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shop_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  -- Free text rather than an enum: the platform cannot know every permit a
  -- Zambian trade might need, and a wrong enum blocks a merchant from
  -- uploading something legitimate.
  label       text NOT NULL,
  document_url text NOT NULL,
  -- NULL means the document does not expire (a registration certificate), which
  -- is different from "we do not know".
  expires_at  date,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shop_documents_label_check CHECK (btrim(label) <> ''),
  CONSTRAINT shop_documents_url_check CHECK (btrim(document_url) <> '')
);

COMMENT ON TABLE public.shop_documents IS
  'Licences, permits and certificates a shop holds. Free-form label because the platform cannot enumerate every trade''s paperwork.';

CREATE INDEX IF NOT EXISTS shop_documents_shop_idx
  ON public.shop_documents (shop_id, created_at DESC);

-- Surfacing what is about to lapse is cheap if the sweep can find it.
CREATE INDEX IF NOT EXISTS shop_documents_expiring_idx
  ON public.shop_documents (expires_at)
  WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Not public. These are a merchant's compliance papers, held for verification,
-- and no buyer has any business reading them — unlike item_images, which hangs
-- off the same kind of parent but is storefront content.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_documents_owner_read ON public.shop_documents;
CREATE POLICY shop_documents_owner_read ON public.shop_documents
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_documents.shop_id AND ms.user_id = auth.uid()
    )
  );

-- Deliberately not gated on shops.is_active, unlike items: a shop that is not
-- yet approved is exactly the one that needs to upload its paperwork.
DROP POLICY IF EXISTS shop_documents_owner_write ON public.shop_documents;
CREATE POLICY shop_documents_owner_write ON public.shop_documents
  FOR ALL TO authenticated
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

DROP POLICY IF EXISTS shop_documents_admin_write ON public.shop_documents;
CREATE POLICY shop_documents_admin_write ON public.shop_documents
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
