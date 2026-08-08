-- =============================================================================
-- Item options — drinks with a meal, plates for a table, party size
--
-- Two things the catalogue could not express: a choice attached to an item
-- ("which drink comes with it"), and a count the buyer sets that the merchant
-- must know before preparing anything ("how many plates", "how many people").
--
-- ---------------------------------------------------------------------------
-- Scope of THIS migration
-- ---------------------------------------------------------------------------
-- Authoring only: a merchant can define options, and the definitions sit here
-- inert. Nothing buyer-facing reads them yet, and no selection is captured.
--
-- That boundary is deliberate. price_delta_zmw below is real money, and an
-- option that a buyer can pick but is not charged for would repeat exactly the
-- failure the wholesale fields caused — advertised, never applied. Buyer
-- selection, the cart, and pricing in checkout_init_atomic have to land
-- together in one piece of work, because the checkout payload
-- (`{shop_id, item_ids: [...]}`) carries only item ids today and has no room
-- for a selection. Until that lands there is nothing to advertise, so nothing
-- is promised.
--
-- ---------------------------------------------------------------------------
-- Two shapes, not one
-- ---------------------------------------------------------------------------
--   choice   — pick one, or pick several, from a list. Each option carries its
--              own price delta ("add a Coke: +K15").
--   quantity — a number the buyer sets between min and max, priced per unit
--              ("plates: 4-20, +K85 each"). There is no list to choose from,
--              so the delta lives on the group and item_options stays empty.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.item_option_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  label      text NOT NULL,
  kind       text NOT NULL DEFAULT 'choice',
  /** choice only: may the buyer pick more than one? */
  allow_multiple boolean NOT NULL DEFAULT false,
  is_required    boolean NOT NULL DEFAULT false,

  -- quantity only.
  min_value            integer,
  max_value            integer,
  unit_price_delta_zmw integer NOT NULL DEFAULT 0,

  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT item_option_groups_label_check CHECK (btrim(label) <> ''),
  CONSTRAINT item_option_groups_kind_check CHECK (kind IN ('choice', 'quantity')),

  -- A quantity group needs a coherent range; a choice group must not carry one.
  CONSTRAINT item_option_groups_range_check CHECK (
    (kind = 'quantity'
      AND min_value IS NOT NULL AND max_value IS NOT NULL
      AND min_value >= 0 AND max_value >= min_value)
    OR (kind = 'choice' AND min_value IS NULL AND max_value IS NULL)
  ),

  -- Options may add to the price or leave it alone. They may not subtract:
  -- a discount belongs in the price or a quantity break, and allowing negative
  -- deltas would let a combination of options drive a line below zero.
  CONSTRAINT item_option_groups_delta_check CHECK (unit_price_delta_zmw >= 0)
);

COMMENT ON TABLE public.item_option_groups IS
  'Choices and counts attached to an item. Authoring only until checkout can carry a selection — see the migration header.';

CREATE TABLE IF NOT EXISTS public.item_options (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL REFERENCES public.item_option_groups(id) ON DELETE CASCADE,
  label           text NOT NULL,
  price_delta_zmw integer NOT NULL DEFAULT 0,
  is_available    boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT item_options_label_check CHECK (btrim(label) <> ''),
  CONSTRAINT item_options_delta_check CHECK (price_delta_zmw >= 0)
);

CREATE INDEX IF NOT EXISTS item_option_groups_item_idx
  ON public.item_option_groups (item_id, sort_order);

CREATE INDEX IF NOT EXISTS item_options_group_idx
  ON public.item_options (group_id, sort_order);

-- ---------------------------------------------------------------------------
-- Row level security — mirrors item_images and item_price_tiers, which hang
-- off items in the same way. Public read: these are storefront content.
-- ---------------------------------------------------------------------------
ALTER TABLE public.item_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_option_groups_public_read ON public.item_option_groups;
CREATE POLICY item_option_groups_public_read ON public.item_option_groups
  FOR SELECT USING (true);

DROP POLICY IF EXISTS item_option_groups_admin_write ON public.item_option_groups;
CREATE POLICY item_option_groups_admin_write ON public.item_option_groups
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS item_option_groups_merchant_write ON public.item_option_groups;
CREATE POLICY item_option_groups_merchant_write ON public.item_option_groups
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.items i
      JOIN public.merchant_shops ms ON ms.shop_id = i.shop_id
      JOIN public.shops s ON s.id = ms.shop_id
      WHERE i.id = item_option_groups.item_id
        AND ms.user_id = auth.uid() AND s.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.items i
      JOIN public.merchant_shops ms ON ms.shop_id = i.shop_id
      JOIN public.shops s ON s.id = ms.shop_id
      WHERE i.id = item_option_groups.item_id
        AND ms.user_id = auth.uid() AND s.is_active = true
    )
  );

-- Options resolve their permissions through the group's item, so the rule is
-- expressed once via a helper rather than repeated with another two joins.
CREATE OR REPLACE FUNCTION public.can_edit_item_options(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.current_user_role() = 'admin'
     OR EXISTS (
       SELECT 1
       FROM public.item_option_groups g
       JOIN public.items i ON i.id = g.item_id
       JOIN public.merchant_shops ms ON ms.shop_id = i.shop_id
       JOIN public.shops s ON s.id = ms.shop_id
       WHERE g.id = p_group_id
         AND ms.user_id = auth.uid()
         AND s.is_active = true
     )
$$;

REVOKE ALL ON FUNCTION public.can_edit_item_options(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_item_options(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS item_options_public_read ON public.item_options;
CREATE POLICY item_options_public_read ON public.item_options
  FOR SELECT USING (true);

DROP POLICY IF EXISTS item_options_write ON public.item_options;
CREATE POLICY item_options_write ON public.item_options
  FOR ALL TO authenticated
  USING (public.can_edit_item_options(group_id))
  WITH CHECK (public.can_edit_item_options(group_id));
