-- =============================================================================
-- KithLy V2 canonical schema alignment (idempotent)
-- Run via: supabase db push  OR  Supabase SQL Editor
-- =============================================================================

-- ---------------------------------------------------------------------------
-- transactions (V2 column names)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'transaction_id'
  ) THEN
    ALTER TABLE public.transactions RENAME COLUMN id TO transaction_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'sender_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'buyer_id'
  ) THEN
    ALTER TABLE public.transactions RENAME COLUMN sender_id TO buyer_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'payment_status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.transactions RENAME COLUMN payment_status TO status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'flutterwave_ref'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'gateway_tx_ref'
  ) THEN
    ALTER TABLE public.transactions RENAME COLUMN flutterwave_ref TO gateway_tx_ref;
  END IF;
END $$;

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES public.users(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'GATEWAY_PROCESSING';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS gateway_tx_ref TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS origin_type TEXT DEFAULT 'LOCAL';

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_gateway_tx_ref
  ON public.transactions (gateway_tx_ref) WHERE gateway_tx_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_buyer_id
  ON public.transactions (buyer_id);

-- ---------------------------------------------------------------------------
-- items (price_zmw)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'base_price'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'price_zmw'
  ) THEN
    ALTER TABLE public.items RENAME COLUMN base_price TO price_zmw;
  END IF;
END $$;

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS price_zmw INTEGER;

-- ---------------------------------------------------------------------------
-- shop_orders (V2 PK + claim_status lifecycle)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shop_orders' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shop_orders' AND column_name = 'shop_order_id'
  ) THEN
    ALTER TABLE public.shop_orders RENAME COLUMN id TO shop_order_id;
  END IF;
END $$;

ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS subtotal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS settled BOOLEAN DEFAULT false;

-- ---------------------------------------------------------------------------
-- order_items (order_item_id PK)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'order_item_id'
  ) THEN
    ALTER TABLE public.order_items RENAME COLUMN id TO order_item_id;
  END IF;
END $$;

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- transaction_events — link to transactions, not shop_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.transaction_events ADD COLUMN IF NOT EXISTS transaction_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transaction_events' AND column_name = 'voucher_id'
  ) THEN
    UPDATE public.transaction_events
    SET transaction_id = voucher_id
    WHERE transaction_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transaction_events_txn_event_type
  ON public.transaction_events (transaction_id, event_type);

-- ---------------------------------------------------------------------------
-- merchant_shops (required for fulfill-voucher auth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_shops (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_claim_code ON public.shop_orders (claim_code);
CREATE INDEX IF NOT EXISTS idx_shop_orders_transaction_id ON public.shop_orders (transaction_id);

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.users(id);
