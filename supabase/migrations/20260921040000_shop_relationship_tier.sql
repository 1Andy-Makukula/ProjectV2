-- =============================================================================
-- How close we actually are to a shop
--
-- WHY THREE STATES AND NOT TWO
-- ----------------------------
-- While KithLy is bootstrapping, a bundle line can come from a shop in one of
-- three genuinely different relationships, and the difference matters to the
-- buyer:
--
--   partner    registered on KithLy, sells here, gets paid here.
--   arranged   not registered, but we have spoken to them and they know we
--              come in and buy.
--   sourced    not registered, no relationship at all. We read their public
--              prices and we go and buy the goods like any other customer.
--
-- Collapsing the last two into "not a partner" would lose the only one the
-- buyer can act on: whether anybody at that shop is expecting us.
--
-- WHAT THE COPY MAY AND MAY NOT SAY
-- ---------------------------------
-- Reporting a shop's public prices is factual and fine. Implying endorsement
-- is not. So a `sourced` line may say "we buy this for you at X" and may never
-- say "our partner X". This is the load-bearing sentence in the whole feature
-- and it should not be edited casually -- the wording is what keeps an honest
-- bootstrap from becoming a false claim of partnership.
--
-- Defaulting to `partner` leaves every existing shop exactly as it is: they
-- all registered, so they all are.
--
-- BLAST RADIUS: Local, additive, defaulted. Read by the catalogue's
-- disclosure line and by nothing on the money path.
-- =============================================================================

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS relationship_tier text NOT NULL DEFAULT 'partner';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shops_relationship_tier_check'
  ) THEN
    ALTER TABLE public.shops
      ADD CONSTRAINT shops_relationship_tier_check
      CHECK (relationship_tier IN ('partner', 'arranged', 'sourced'));
  END IF;
END $$;

COMMENT ON COLUMN public.shops.relationship_tier IS
  'How close KithLy is to this shop. partner = registered and selling here.
   arranged = not registered but spoken to. sourced = not registered, no
   relationship; we read public prices and buy as a customer. Drives the
   disclosure on a bundle line. A sourced shop must NEVER be described as a
   partner.';

-- The house shop is the one row where the question does not apply: KithLy is
-- not in a relationship with itself. It stays `partner` by default, which is
-- the honest reading -- goods sold by KithLy are sold by a registered seller
-- on the platform, whatever KithLy had to do in town to obtain them. The
-- disclosure about sourcing lives on the shops the goods came FROM.
