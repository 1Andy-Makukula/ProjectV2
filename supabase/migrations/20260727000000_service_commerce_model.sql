-- =============================================================================
-- Phase 1 — Service Commerce Model
--
-- Extends `items` so a shop can list services (a haircut, a birthday setup,
-- catering) alongside physical products, and so either kind can carry discount
-- or wholesale pricing.
--
-- ---------------------------------------------------------------------------
-- Expiry semantics — two different clocks
-- ---------------------------------------------------------------------------
--
--   requires_scheduling = false   (products, and on-demand services)
--       The voucher is valid for `valid_for_days` counted from the PURCHASE
--       date. Nothing is booked, so the purchase is the only fixed point in
--       the item's life.
--
--   requires_scheduling = true    (services booked for a specific date)
--       The voucher is anchored to the agreed execution date, not the purchase
--       date. A setup booked ninety days out must not be swept by a clock that
--       started the moment it was paid for, and the merchant may already have
--       spent money preparing for it.
--
-- The agreed date itself is captured per-order (Phase 3, alongside the escrow
-- grace period). `items` only declares which clock applies.
--
-- `valid_for_days = NULL` means "use the platform default" rather than "never
-- expires" — absence of expiry is expressed by has_expiry = false.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Categories — safety net
--
-- `categories` and `items.category_id` already exist in the deployed database
-- but were never added to this migration chain, so a database built purely
-- from migrations would not have them. Both statements are no-ops where the
-- objects are already present.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  image_url      text,
  is_featured    boolean DEFAULT false,
  ui_order_index integer,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to categories" ON public.categories;
CREATE POLICY "Public read access to categories"
  ON public.categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage categories" ON public.categories;
CREATE POLICY "Admins manage categories"
  ON public.categories FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS category_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_category_id_fkey'
  ) THEN
    ALTER TABLE public.items ADD CONSTRAINT items_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Product / service classification
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'product';
COMMENT ON COLUMN public.items.item_type IS
  'product = a physical good collected from the shop. service = work performed for the recipient.';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS requires_scheduling boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.items.requires_scheduling IS
  'Service is booked for an agreed date. Switches the voucher expiry clock from purchase date to execution date.';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS lead_time_days integer;
COMMENT ON COLUMN public.items.lead_time_days IS
  'Minimum notice the merchant needs before the execution date. NULL = no stated minimum.';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS fulfillment_location text;
COMMENT ON COLUMN public.items.fulfillment_location IS
  'Where the service happens: in_store | at_customer | remote. NULL for products.';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS allow_custom_quote boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.items.allow_custom_quote IS
  'Buyer may request a tailored quote instead of buying at the listed price (Phase 4 chat/quotation flow).';

-- ---------------------------------------------------------------------------
-- 3. Voucher expiry
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS has_expiry boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.items.has_expiry IS
  'false = the voucher never lapses and is excluded from the expiry sweep.';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS valid_for_days integer;
COMMENT ON COLUMN public.items.valid_for_days IS
  'Days the voucher stays valid, measured from purchase date for unscheduled items and from the agreed execution date for scheduled ones. NULL = platform default.';

-- ---------------------------------------------------------------------------
-- 4. Discount pricing
--
-- price_zmw stays the authoritative amount charged at checkout; original_price
-- exists only to render a strike-through and must genuinely be higher.
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_discounted boolean NOT NULL DEFAULT false;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS original_price_zmw integer;
COMMENT ON COLUMN public.items.original_price_zmw IS
  'Pre-discount price in ngwee, shown struck through. Must exceed price_zmw when is_discounted.';

-- ---------------------------------------------------------------------------
-- 5. Wholesale pricing
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_wholesale boolean NOT NULL DEFAULT false;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS wholesale_price_zmw integer;
COMMENT ON COLUMN public.items.wholesale_price_zmw IS
  'Per-unit price in ngwee once minimum_order_quantity is met.';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS minimum_order_quantity integer NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.items.minimum_order_quantity IS
  'Units required to qualify for wholesale_price_zmw.';

-- ---------------------------------------------------------------------------
-- 6. Integrity constraints
--
-- Every constraint below is satisfied by existing rows once the column
-- defaults above are applied, so no backfill is required.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_item_type_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_item_type_check
      CHECK (item_type IN ('product', 'service'));
  END IF;

  -- Only services can be scheduled; a product has nothing to book.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_scheduling_is_service_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_scheduling_is_service_check
      CHECK (NOT requires_scheduling OR item_type = 'service');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_lead_time_days_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_lead_time_days_check
      CHECK (lead_time_days IS NULL OR lead_time_days >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_fulfillment_location_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_fulfillment_location_check
      CHECK (fulfillment_location IS NULL
             OR fulfillment_location IN ('in_store', 'at_customer', 'remote'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_valid_for_days_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_valid_for_days_check
      CHECK (valid_for_days IS NULL OR valid_for_days > 0);
  END IF;

  -- A discount that is not lower than the asking price is a display bug.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_discount_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_discount_check
      CHECK (NOT is_discounted
             OR (original_price_zmw IS NOT NULL AND original_price_zmw > price_zmw));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_wholesale_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_wholesale_check
      CHECK (NOT is_wholesale
             OR (wholesale_price_zmw IS NOT NULL AND wholesale_price_zmw > 0));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_minimum_order_quantity_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_minimum_order_quantity_check
      CHECK (minimum_order_quantity >= 1);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Indexes
--
-- The storefront filters a shop's catalogue by kind, and the mode-specific
-- surfaces in Phase 6 will filter by category.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS items_shop_id_item_type_idx
  ON public.items (shop_id, item_type);

CREATE INDEX IF NOT EXISTS items_category_id_idx
  ON public.items (category_id)
  WHERE category_id IS NOT NULL;
