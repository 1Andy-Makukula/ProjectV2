-- =============================================================================
-- What one of something actually is
--
-- WHY
-- ---
-- Wholesalers are how a great deal of Zambia actually buys, and the catalogue
-- has to carry them. The schema is most of the way there already:
-- `is_wholesale`, `wholesale_price_zmw`, `minimum_order_quantity` and the
-- `item_price_tiers` table all exist, and the cart already offers the
-- next-tier upsell.
--
-- The gap is not pricing. It is that a wholesaler sells a CASE and the tile
-- says a number. "K85" against a photograph of one bottle, where K85 buys
-- twelve, produces an abandoned cart at best and a recipient handed a crate
-- they did not expect at worst. The unit is not a detail to be discovered on
-- the detail page; it belongs beside the price, before the press.
--
-- Free text rather than an enum on purpose. "25kg bag", "case of 12",
-- "bundle of 6", "per metre", "tray of 30" -- a fixed list would be wrong
-- within a week, and the value is displayed rather than computed with, so
-- nothing depends on its shape.
--
-- Null means "each", which is the overwhelming majority and is what every
-- existing row already means. So nothing needs backfilling and nothing
-- changes until a merchant says otherwise.
--
-- BLAST RADIUS: Local, additive, nullable, display-only. No pricing logic
-- reads it -- quantity arithmetic continues to be done in whatever unit the
-- price is already quoted in.
-- =============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS unit_of_sale text;

COMMENT ON COLUMN public.items.unit_of_sale IS
  'What one unit of this item is, when it is not simply one: "case of 12",
   "25kg bag", "tray of 30". Displayed beside the price so a wholesale line
   cannot be mistaken for a single. Null means each. Display only -- no
   pricing or stock arithmetic reads it, because the price is already quoted
   per whatever this describes.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_unit_of_sale_length_check'
  ) THEN
    -- Long enough for "case of 12 x 500ml", short enough that it cannot be
    -- used as a second description field and wreck the tile layout.
    ALTER TABLE public.items
      ADD CONSTRAINT items_unit_of_sale_length_check
      CHECK (unit_of_sale IS NULL OR char_length(unit_of_sale) <= 40);
  END IF;
END $$;
