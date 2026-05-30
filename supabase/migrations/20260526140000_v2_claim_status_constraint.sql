-- 20260525140000_v2_claim_status_constraint.sql
-- Expand the claim_status constraint to support the V2 full lifecycle

ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_claim_status_check;

ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_claim_status_check
  CHECK (claim_status IN (
    'PENDING_PAYMENT',          -- Created but not yet paid (waiting for gateway)
    'PENDING',                  -- Paid, waiting for merchant acceptance
    'PROCESSING_FULFILLMENT',   -- Merchant accepted, preparing items
    'PARTIAL_FULFILLMENT',      -- Some items are ready/redeemed
    'FULFILLED',                -- All items ready for pickup
    'REDEEMED',                 -- Customer picked up the order
    'CANCELLED',                -- Order cancelled (e.g. by merchant or unpaid timeout)
    'EXPIRED'                   -- Claim code expired
  ));
