-- =============================================================================
-- KithLy V2 — Unified P2P Identity RLS
--
-- Upgrades the SELECT policies on `shop_orders` and `transactions` so that
-- recipients can query rows sent *to* their phone number.
--
-- Identity source: the verified phone claim baked into the Supabase JWT
--   auth.jwt() ->> 'phone'
--
-- This avoids a subquery against `public.users` (which itself has RLS) and
-- is both faster and recursion-safe.
--
-- Non-destructive: no tables are dropped, no payment statuses are modified.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. shop_orders — replace the SELECT policy
--
--    A row is readable when ANY of these conditions is true:
--      a) The authenticated user is the buyer (via transactions join)
--      b) The authenticated user is the merchant (via merchant_shops join)
--      c) The authenticated user's JWT phone matches recipient_phone
--      d) The row has a claim_code (public gift page access for anon+auth)
--         [handled by the separate shop_orders_select_by_claim_code policy]
--      e) The user is an admin
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS shop_orders_select ON public.shop_orders;
CREATE POLICY shop_orders_select ON public.shop_orders
  FOR SELECT TO authenticated
  USING (
    -- (a) Sender / buyer
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.transaction_id = shop_orders.transaction_id
        AND t.buyer_id = auth.uid()
    )
    -- (b) Merchant who owns the shop
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_orders.shop_id
        AND ms.user_id = auth.uid()
    )
    -- (c) Recipient — phone from JWT matches the order's recipient_phone
    OR (
      shop_orders.recipient_phone IS NOT NULL
      AND shop_orders.recipient_phone = (auth.jwt() ->> 'phone')
    )
    -- (e) Admin
    OR public.current_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 2. transactions — add recipient leg
--
--    Previously only `buyer_id = auth.uid()` was allowed.  Now a recipient
--    whose JWT phone matches ANY child shop_order's recipient_phone may also
--    read the parent transaction (needed to render sender name, timestamps,
--    and totals in the "Gifts Received" viewport).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS transactions_select_buyer ON public.transactions;
CREATE POLICY transactions_select_buyer ON public.transactions
  FOR SELECT TO authenticated
  USING (
    -- Original: the buyer can read their own transactions
    buyer_id = auth.uid()
    -- NEW: the recipient can read transactions that contain orders sent to them
    OR (
      (auth.jwt() ->> 'phone') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.shop_orders so
        WHERE so.transaction_id = transactions.transaction_id
          AND so.recipient_phone = (auth.jwt() ->> 'phone')
      )
    )
    -- Admin override
    OR public.current_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 3. Performance index
--
--    The recipient_phone column is now used in RLS evaluation on every
--    authenticated SELECT.  An index keeps the policy check O(log n).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_shop_orders_recipient_phone
  ON public.shop_orders (recipient_phone)
  WHERE recipient_phone IS NOT NULL;
