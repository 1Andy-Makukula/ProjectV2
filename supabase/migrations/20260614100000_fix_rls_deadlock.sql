-- =============================================================================
-- FIX: Break the RLS Infinite Recursion between shop_orders and transactions
-- =============================================================================
--
-- The previous migration caused an infinite loop:
--   - Querying `transactions` triggers `transactions_select_buyer`
--   - Which queries `shop_orders` (to check recipient_phone)
--   - Which triggers `shop_orders_select`
--   - Which queries `transactions` (to check buyer_id)
--   - Loop restarts -> 500 Internal Server Error.
--
-- FIX: We break the loop by moving the buyer check directly into the transactions
-- policy, and for shop_orders, we only check the current user's direct properties
-- OR we use a small Security Definer function to bypass RLS when checking relationships.

-- 1. Create a secure helper function to check transaction ownership without triggering RLS
CREATE OR REPLACE FUNCTION public.is_transaction_buyer(tx_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER -- Bypasses RLS!
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM transactions
    WHERE transaction_id = tx_id AND buyer_id = user_id
  );
$$;

-- 2. Create a secure helper function to check recipient phone without triggering RLS
CREATE OR REPLACE FUNCTION public.is_transaction_recipient(tx_id uuid, phone text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER -- Bypasses RLS!
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM shop_orders
    WHERE transaction_id = tx_id AND recipient_phone = phone
  );
$$;

-- 3. Fix shop_orders policy
DROP POLICY IF EXISTS shop_orders_select ON public.shop_orders;
CREATE POLICY shop_orders_select ON public.shop_orders
  FOR SELECT TO authenticated
  USING (
    -- a) Use the secure function to check if buyer (breaks loop)
    public.is_transaction_buyer(transaction_id, auth.uid())
    
    -- b) Merchant who owns the shop
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_orders.shop_id
        AND ms.user_id = auth.uid()
    )
    
    -- c) Recipient
    OR (
      recipient_phone IS NOT NULL
      AND recipient_phone = (auth.jwt() ->> 'phone')
    )
    
    -- e) Admin
    OR public.current_user_role() = 'admin'
  );

-- 4. Fix transactions policy
DROP POLICY IF EXISTS transactions_select_buyer ON public.transactions;
CREATE POLICY transactions_select_buyer ON public.transactions
  FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    -- Use the secure function to check recipient (breaks loop)
    OR public.is_transaction_recipient(transaction_id, auth.jwt() ->> 'phone')
    OR public.current_user_role() = 'admin'
  );
