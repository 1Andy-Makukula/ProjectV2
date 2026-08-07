-- =============================================================================
-- Phase 2 — Services priced from a minimum
--
-- A quotable service currently shows a bare price next to a "request a quote"
-- action, and the buyer cannot tell whether that number is the price or a
-- starting point. This makes the distinction explicit.
--
-- ---------------------------------------------------------------------------
-- Why this needs no checkout change
-- ---------------------------------------------------------------------------
-- The obvious design — let the merchant leave the price blank — would mean
-- making items.price_zmw nullable, which reaches into checkout_init_atomic,
-- order_items.allocated_price, settlement and every price render in the app.
--
-- Framing the number as a *minimum* instead means every service still carries a
-- real, chargeable price. price_zmw keeps its NOT NULL CHECK (price_zmw > 0),
-- checkout is untouched, and the change is one boolean plus copy.
--
-- ---------------------------------------------------------------------------
-- Why a minimum requires allow_custom_quote
-- ---------------------------------------------------------------------------
-- "From K250" with no way to discover the real figure is precisely the
-- confusion this is meant to remove. A minimum is only meaningful when the
-- buyer can open a conversation to get the tailored price, so the constraint
-- ties the two together rather than trusting the admin form to.
-- =============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS price_is_minimum boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.items.price_is_minimum IS
  'price_zmw is the lowest this service is offered at, not a fixed price. Buyer may book at it or negotiate a tailored quote. Requires item_type = service and allow_custom_quote.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_price_is_minimum_check'
  ) THEN
    -- Satisfied by every existing row: the column defaults to false, and false
    -- short-circuits the implication.
    ALTER TABLE public.items ADD CONSTRAINT items_price_is_minimum_check
      CHECK (
        NOT price_is_minimum
        OR (item_type = 'service' AND allow_custom_quote)
      );
  END IF;
END $$;
