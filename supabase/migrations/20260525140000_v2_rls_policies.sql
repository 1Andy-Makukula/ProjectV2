-- =============================================================================
-- KithLy V2 — Row Level Security (browser / anon / authenticated access)
-- Edge Functions use service_role and bypass RLS.
-- =============================================================================

-- Helper: current user role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.current_user_role() = 'admin');

DROP POLICY IF EXISTS users_update_own_no_role ON public.users;
CREATE POLICY users_update_own_no_role ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
  );

DROP POLICY IF EXISTS users_admin_all ON public.users;
CREATE POLICY users_admin_all ON public.users
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transactions_select_buyer ON public.transactions;
CREATE POLICY transactions_select_buyer ON public.transactions
  FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR public.current_user_role() = 'admin'
  );

-- No direct INSERT/UPDATE from clients — checkout-init uses service role

-- ---------------------------------------------------------------------------
-- shop_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_orders_select ON public.shop_orders;
CREATE POLICY shop_orders_select ON public.shop_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.transaction_id = shop_orders.transaction_id
        AND t.buyer_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_orders.shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- Public gift page: claim_code lookup via Edge Function or anon policy
DROP POLICY IF EXISTS shop_orders_select_by_claim_code ON public.shop_orders;
CREATE POLICY shop_orders_select_by_claim_code ON public.shop_orders
  FOR SELECT TO anon, authenticated
  USING (claim_code IS NOT NULL);

-- ---------------------------------------------------------------------------
-- order_items (via shop_order access)
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items
  FOR SELECT TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM public.shop_orders so
      WHERE so.shop_order_id = order_items.shop_order_id
    )
  );

-- ---------------------------------------------------------------------------
-- items & shops (catalog)
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS items_public_read ON public.items;
CREATE POLICY items_public_read ON public.items
  FOR SELECT TO anon, authenticated
  USING (is_available IS NOT FALSE);

DROP POLICY IF EXISTS items_admin_write ON public.items;
CREATE POLICY items_admin_write ON public.items
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shops_public_read ON public.shops;
CREATE POLICY shops_public_read ON public.shops
  FOR SELECT TO anon, authenticated
  USING (is_active IS TRUE OR owner_id = auth.uid() OR public.current_user_role() = 'admin');

DROP POLICY IF EXISTS shops_insert_owner ON public.shops;
-- Direct shop INSERT blocked; use register_merchant_shop RPC
DROP POLICY IF EXISTS shops_admin_write ON public.shops;
CREATE POLICY shops_admin_write ON public.shops
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- merchant_shops
-- ---------------------------------------------------------------------------
ALTER TABLE public.merchant_shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchant_shops_select_own ON public.merchant_shops;
CREATE POLICY merchant_shops_select_own ON public.merchant_shops
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_role() = 'admin');

-- No direct INSERT — use register_merchant_shop or admin

-- ---------------------------------------------------------------------------
-- kithly_wallets
-- ---------------------------------------------------------------------------
ALTER TABLE public.kithly_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallets_select_own ON public.kithly_wallets;
CREATE POLICY wallets_select_own ON public.kithly_wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- transaction_events (read-only for buyers on own transactions)
-- ---------------------------------------------------------------------------
ALTER TABLE public.transaction_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transaction_events_select ON public.transaction_events;
CREATE POLICY transaction_events_select ON public.transaction_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.transaction_id = transaction_events.transaction_id
        AND t.buyer_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- payout_ledger (merchants via shop assignment)
-- ---------------------------------------------------------------------------
ALTER TABLE public.payout_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_ledger_merchant_select ON public.payout_ledger;
CREATE POLICY payout_ledger_merchant_select ON public.payout_ledger
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = payout_ledger.shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );
