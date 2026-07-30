-- =============================================================================
-- Baseline schema snapshot
--
-- The migration chain cannot replay from an empty database: the earliest
-- tracked migration, 20260525120000_v2_canonical_schema.sql, already assumes
-- `transactions`/`shops`/`items`/`shop_orders`/`order_items`/`transaction_events`
-- exist, and none of them are ever CREATE TABLE'd anywhere in this repo --
-- they were hand-created (via the Supabase dashboard or an uncommitted
-- snapshot) before migrations started being tracked at all. Same story for
-- `users`, `kithly_wallets`, `marketing_campaigns`, `social_posts`, and
-- `bundles`.
--
-- This file captures exactly those tables, dated earlier than every existing
-- migration so it runs first. Every column here is either:
--   (a) still present today and never touched by any later ALTER TABLE ADD
--       COLUMN / rename, so it has to be here or it never exists at all; or
--   (b) the target of a later RENAME COLUMN in 20260525120000 (e.g.
--       transactions.id -> transaction_id, items.base_price -> price_zmw) --
--       using the final name directly here is safe because that migration's
--       own rename guard is `IF EXISTS(old) AND NOT EXISTS(new)`, and it's
--       followed by `ADD COLUMN IF NOT EXISTS <final name>` as a fresh-database
--       fallback. Confirmed by reading that file in full.
--
-- Deliberately excluded: any column that's genuinely new (not a rename) and
-- already added by an existing `ADD COLUMN IF NOT EXISTS` or a guarded
-- `information_schema`-checked DO block elsewhere in this repo (e.g.
-- shops.verification_status, items.category_id, shop_orders.experience_id).
-- Adding those here too would just be redundant -- they're safe to leave to
-- the migrations that already handle them, including the foreign keys that
-- reference tables (categories, experiences, payout_trust_tiers) which don't
-- exist yet at this point in the chain.
--
-- Since a from-empty CI replay never has existing rows, none of the CHECK/
-- NOT NULL constraints below can conflict with data a later migration's own
-- constraint change might otherwise have to worry about -- so these are
-- transcribed directly from the live schema rather than reconstructed
-- historically column-by-column.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'sender' CHECK (role IN ('sender', 'merchant', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kithly_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency TEXT NOT NULL DEFAULT 'ZMW',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  address TEXT,
  payout_method TEXT CHECK (payout_method IN ('airtel', 'mtn', 'bank')),
  payout_details TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  description TEXT,
  image_url TEXT,
  application_status TEXT NOT NULL DEFAULT 'APPROVED'
    CHECK (application_status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  pacra_document_url TEXT,
  nrc_document_url TEXT
);

CREATE TABLE IF NOT EXISTS public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id),
  name TEXT NOT NULL,
  description TEXT,
  price_zmw INTEGER NOT NULL CHECK (price_zmw > 0),
  currency TEXT DEFAULT 'ZMW',
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  is_weekly_pick BOOLEAN DEFAULT false,
  promo_badge_text TEXT
);

CREATE TABLE IF NOT EXISTS public.transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID REFERENCES public.users(id),
  gateway_tx_ref TEXT UNIQUE,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'ZMW',
  status TEXT NOT NULL DEFAULT 'GATEWAY_PROCESSING',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shop_orders (
  shop_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(transaction_id),
  shop_id UUID NOT NULL REFERENCES public.shops(id),
  claim_code VARCHAR NOT NULL UNIQUE,
  claim_status TEXT NOT NULL DEFAULT 'PENDING',
  payout_status TEXT NOT NULL DEFAULT 'UNFUNDED'
    CHECK (payout_status IN ('UNFUNDED', 'PENDING_BATCH', 'SETTLED')),
  settlement_target_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  fulfilled_at TIMESTAMPTZ,
  checkout_intent TEXT NOT NULL DEFAULT 'self' CHECK (checkout_intent IN ('self', 'friends', 'donate'))
);

CREATE TABLE IF NOT EXISTS public.order_items (
  order_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_order_id UUID NOT NULL REFERENCES public.shop_orders(shop_order_id),
  item_id UUID NOT NULL REFERENCES public.items(id),
  allocated_price INTEGER NOT NULL CHECK (allocated_price >= 0),
  -- 20260601000000_smart_bundle.sql does a bare (non-guarded)
  -- `DROP CONSTRAINT order_items_fulfillment_status_check` -- the only
  -- ungated DROP CONSTRAINT anywhere in this history -- so this table must
  -- be created with a CHECK constraint under that exact auto-generated name
  -- or that migration fails on a fresh database. The initial value set
  -- doesn't matter (that migration replaces it outright), only that it exists.
  fulfillment_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (fulfillment_status IN ('PENDING', 'COLLECTED', 'MISSING')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transaction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_order_id UUID REFERENCES public.shop_orders(shop_order_id),
  transaction_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  target_route TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id),
  media_url TEXT NOT NULL,
  caption TEXT,
  is_active BOOLEAN DEFAULT true,
  item_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  bundle_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_price_zmw INTEGER NOT NULL CHECK (total_price_zmw > 0),
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- enforce_immutable_ledger() — attached by 5 later migrations
-- (payout_ledger, wallet_ledger, transaction_events, merchant_float_ledger,
-- admin_action_log) but never itself defined in any tracked migration.
-- Confirmed verbatim against the live database via
-- `SELECT pg_get_functiondef('public.enforce_immutable_ledger()'::regprocedure)`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_immutable_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'DCIMe Protocol Violation: Event ledger records cannot be modified or deleted.';
END;
$function$;
