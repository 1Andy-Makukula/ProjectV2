-- =============================================================================
-- The KithLy house shop
--
-- WHY THIS EXISTS
-- ---------------
-- KithLy is about to sell things it sources itself: curated bundles priced
-- weekly, and bespoke requests quoted through the messaging system. Both need
-- a seller, and `quotations.shop_id` is NOT NULL, so without a shop row KithLy
-- literally cannot quote.
--
-- The alternative was making `quotations.shop_id` nullable. That was rejected:
-- it puts a branch in every consumer of a quotation, including ones that reach
-- the money path, and every one of those branches is a place the two cases can
-- drift apart. One row costs nothing and keeps a single code path.
--
-- WHAT IT BUYS, FOR ONE ROW
-- -------------------------
-- A KithLy-sourced order becomes an ordinary single-vendor order. It inherits,
-- with no new code and no special case:
--
--   * claim code generation -- checkout_init_atomic already loops p_vendors and
--     mints one code per shop, so KithLy gets a code like anyone else
--   * redemption            -- escrow_redeem_items matches on claim_code
--   * the double-entry ledger, payouts, disputes, expiry and compensation
--   * every RLS policy already written against shop_id
--   * the merchant fulfilment screen, which does not care who the shop is
--
-- A bundle that spans two real shops and KithLy is simply three vendors and
-- three codes. Nothing had to be designed for that; it falls out.
--
-- PAYING OURSELVES IS THE POINT, NOT A PROBLEM
-- --------------------------------------------
-- When a KithLy order is scanned, the ledger credits MERCHANT_PAYABLE for this
-- shop and the payout path moves money to its destination -- KithLy's own
-- account. That looks circular and is not. It is what makes the promise
-- auditable: funds sit with the escrow holder and reach KithLy only after the
-- recipient has scanned, and that release is a row in the payout ledger like
-- every other merchant's rather than an implicit transfer nobody can inspect.
--
-- NO PAYOUT DESTINATION IS SEEDED HERE, ON PURPOSE
-- ------------------------------------------------
-- `shop_can_accept_redemptions` requires an active, verified row in
-- `merchant_payout_destinations`, and `shop_payout_readiness` requires the same.
-- Those carry a real account number, which does not belong hard-coded in a
-- migration in a public repository.
--
-- So this shop is created READY TO TRADE BUT UNABLE TO BE PAID, which is the
-- safe order of operations: it can be quoted against and ordered from, and the
-- money simply stays in escrow until a verified destination exists. Add it
-- through the admin payout screen, exactly as any merchant would.
--
-- `owner_id` is left NULL: there is no merchant user behind this shop, it is
-- operated from the admin console. Every policy that joins through owner_id
-- therefore returns nothing for it, which is correct -- nobody should reach
-- this shop through the merchant dashboard.
--
-- IDEMPOTENT: matched on the fixed slug-like name via ON CONFLICT on a unique
-- partial index, so re-running changes nothing and an admin who has since
-- edited the description keeps their edit.
--
-- BLAST RADIUS: 🟢 Local. One row in `shops`. No schema change, no function
-- change, nothing on the money path is altered -- this only makes an existing
-- path reachable by a new seller.
-- =============================================================================

-- A stable identity for the house shop, so application code can find it
-- without guessing at a name. One row only, enforced.
CREATE UNIQUE INDEX IF NOT EXISTS shops_house_account_uniq
  ON public.shops ((true))
  WHERE name = 'KithLy';

INSERT INTO public.shops (
  name,
  description,
  location,
  is_active,
  application_status,
  verification_status,
  offers_products,
  offers_services,
  owner_id
)
SELECT
  'KithLy',
  'Items we source for you. When something is not yet stocked by a shop on '
  || 'KithLy, we go and buy it at the shops in town, at the price shown that '
  || 'week, and send you the receipt.',
  'Lusaka',
  true,
  -- Note the case difference, which is real and not a typo:
  -- application_status is ('DRAFT','PENDING_REVIEW','APPROVED','REJECTED')
  -- and verification_status is ('pending','approved','rejected').
  'APPROVED',
  'approved',
  true,
  true,
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.shops WHERE name = 'KithLy'
);

COMMENT ON INDEX public.shops_house_account_uniq IS
  'There is exactly one KithLy house shop. It is the seller of record for
   curated bundles and bespoke requests, which is what lets a KithLy-sourced
   order reuse claim codes, redemption, payouts and RLS unchanged. See
   docs/plans/curated-catalogue.md section 0.';
