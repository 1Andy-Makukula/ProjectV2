-- =============================================================================
-- KithLy V2 Schema Migration
-- Safe to run in Supabase SQL Editor (idempotent via IF NOT EXISTS guards)
--
-- Adds recipient_name, recipient_phone, and message to the shop_orders table.
-- These columns are required for the GiftPage display and Confirmation screen
-- and are written by the checkout-init Edge Function.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add recipient_name column
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'shop_orders'
      AND column_name  = 'recipient_name'
  ) THEN
    ALTER TABLE public.shop_orders ADD COLUMN recipient_name TEXT;
    COMMENT ON COLUMN public.shop_orders.recipient_name IS
      'Full name of the gift recipient. Captured at checkout from SendFlow.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Add recipient_phone column
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'shop_orders'
      AND column_name  = 'recipient_phone'
  ) THEN
    ALTER TABLE public.shop_orders ADD COLUMN recipient_phone TEXT;
    COMMENT ON COLUMN public.shop_orders.recipient_phone IS
      'Phone number of the gift recipient in E.164 format (e.g. +260977XXXXXX). '
      'Used to deliver the claim code via WhatsApp/SMS.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Add message column
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'shop_orders'
      AND column_name  = 'message'
  ) THEN
    ALTER TABLE public.shop_orders ADD COLUMN message TEXT;
    COMMENT ON COLUMN public.shop_orders.message IS
      'Optional personal message from the sender (max 200 chars). '
      'Displayed on the GiftPage for the recipient.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Index: fast lookup of shop_orders by claim_code
--    (GiftPage queries this on every page load and via realtime subscription)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_shop_orders_claim_code
  ON public.shop_orders (claim_code);

-- ---------------------------------------------------------------------------
-- 5. Index: fast lookup of shop_orders by transaction_id
--    (OrderDetail, Confirmation, and webhook handler all join on this)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_shop_orders_transaction_id
  ON public.shop_orders (transaction_id);

-- ---------------------------------------------------------------------------
-- 6. Index: fast lookup of transactions by buyer_id
--    (OrderDashboard filters by the authenticated user)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transactions_buyer_id
  ON public.transactions (buyer_id);

-- ---------------------------------------------------------------------------
-- 7. Index: fast lookup of transactions by gateway_tx_ref
--    (Webhook handler and verify_payment both look up by this field)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transactions_gateway_tx_ref
  ON public.transactions (gateway_tx_ref);

-- =============================================================================
-- Migration complete. Verify with:
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'shop_orders'
--   ORDER BY ordinal_position;
-- =============================================================================
