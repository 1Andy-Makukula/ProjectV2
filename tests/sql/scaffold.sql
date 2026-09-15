-- Minimal Supabase-shaped scaffold: just enough for the Stage 1 migrations to
-- run and be asserted against. NOT a replica of the real database.

-- Roles live in the cluster, not the database, so they survive a DROP DATABASE
-- and must be created conditionally or the second run aborts here.
DO $roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $roles$;

CREATE SCHEMA IF NOT EXISTS auth;

-- Supabase's default privileges. WITHOUT THESE EVERY RLS TEST IS A FALSE
-- NEGATIVE: a role with no table GRANT fails with "permission denied" before
-- any policy is consulted, which looks exactly like a policy that denies.
--
-- No migration in this repo grants table privileges -- claim_status_feed is
-- anon-readable in production with no GRANT of its own -- so the platform
-- default is the convention, and the scaffold has to reproduce it.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;


-- Settable stubs so a test can pretend to be a given user without real JWTs.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb);
$$;

CREATE TABLE public.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role  text NOT NULL DEFAULT 'sender',
  phone text
);

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'role'),
    (SELECT role FROM public.users WHERE id = auth.uid())
  );
$$;

-- Tables the Stage 1 migrations reference by foreign key.
CREATE TABLE public.shops (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id  uuid REFERENCES public.users(id) ON DELETE CASCADE,
  name      text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.categories (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);

CREATE TABLE public.items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  category_id         uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name                text NOT NULL,
  is_available        boolean NOT NULL DEFAULT true,
  -- Prices are in ngwee throughout this codebase, never kwacha.
  price_zmw           integer NOT NULL DEFAULT 0,
  is_discounted       boolean,
  original_price_zmw  integer
);

-- The immutability guard the real ledgers carry (baseline snapshot). Stubbed
-- here because item_price_events attaches it too, and a test that skipped it
-- would prove the price log immutable when it is not.
CREATE OR REPLACE FUNCTION public.enforce_immutable_ledger()
RETURNS trigger LANGUAGE plpgsql AS $immutable$
BEGIN
  RAISE EXCEPTION 'DCIMe Protocol Violation: Event ledger records cannot be modified or deleted.';
END;
$immutable$;

CREATE TABLE public.contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  phone         text NOT NULL,
  -- Free text on purpose (20260902000000). relationship_tier is added
  -- alongside it by 20260913030000; both exist, and both are read.
  relationship  text
);

CREATE TABLE public.contact_occasions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  label      text,
  recurrence text NOT NULL DEFAULT 'annual',
  month      smallint,
  day        smallint,
  year       smallint,
  notes      text,
  last_reminded_on date
);

-- The reminder job writes here.
CREATE TABLE public.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message      text NOT NULL,
  type         text NOT NULL,
  reference_id text,
  is_read      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Mirror production's RLS state on the stubbed tables.
--
-- WITHOUT THIS EVERY RLS TEST PASSES VACUOUSLY -- the exact inverse of the
-- missing-GRANT trap above, and harder to notice because a vacuous pass looks
-- like success. RLS is off by default on a new table, so a stub created here
-- is wide open while the real table (20260902000000, 20260904000000) has it on.
--
-- The policies themselves are NOT recreated here: a migration under test is
-- expected to create or replace the ones it governs.
-- ---------------------------------------------------------------------------
ALTER TABLE public.contacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_occasions ENABLE ROW LEVEL SECURITY;

-- The stubs live in `auth`, so the roles need to reach them.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid()  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt()  TO anon, authenticated, service_role;

-- The policy production has on `contacts` (20260902000000).
--
-- It must be here, not just RLS-enabled. `contact_occasions_owner_all` decides
-- ownership with an EXISTS against `contacts`, and a policy's subqueries are
-- themselves subject to RLS -- so a contacts table with RLS on and no policy
-- denies that subquery, and every contact occasion silently disappears for its
-- own owner. Enabling RLS without the policy is less faithful than not
-- enabling it at all.
DROP POLICY IF EXISTS contacts_owner_all ON public.contacts;
CREATE POLICY contacts_owner_all ON public.contacts
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Merchant ownership, as posts_merchant_write and shop_collections use it.
CREATE TABLE public.merchant_shops (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, shop_id)
);
ALTER TABLE public.merchant_shops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_shops_own ON public.merchant_shops;
CREATE POLICY merchant_shops_own ON public.merchant_shops
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- items, as 20260525140000 governs it. shop_item_groups() runs SECURITY
-- INVOKER precisely so this policy decides what a caller sees, so the stub
-- carries the policy and not just the flag -- see the README.
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS items_public_read ON public.items;
CREATE POLICY items_public_read ON public.items
  FOR SELECT TO anon, authenticated
  USING (is_available IS NOT FALSE);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_public_read ON public.categories;
CREATE POLICY categories_public_read ON public.categories
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shops_public_read ON public.shops;
CREATE POLICY shops_public_read ON public.shops
  FOR SELECT TO anon, authenticated USING (is_active IS NOT FALSE);

-- shop_orders, as much of it as refresh_observed_preferences reads.
CREATE TABLE public.shop_orders (
  shop_order_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  recipient_phone text,
  claim_status    text NOT NULL DEFAULT 'PENDING'
);
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;

-- Wallets and their ledger, as 20260525100000 / 20260615000000 shape them.
CREATE TABLE public.kithly_wallets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES public.users(id),
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency   text NOT NULL DEFAULT 'ZMW',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.wallet_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id      uuid NOT NULL REFERENCES public.kithly_wallets(id) ON DELETE CASCADE,
  amount         integer NOT NULL,
  transaction_id uuid,
  description    text,
  reversal_of    uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The immutability the real ledger has, and that CI check 1 pins. Without it a
-- test could "prove" the provenance column backfillable when production
-- refuses the UPDATE outright.
DROP TRIGGER IF EXISTS enforce_immutable_wallet_ledger ON public.wallet_ledger;
CREATE TRIGGER enforce_immutable_wallet_ledger
BEFORE UPDATE OR DELETE ON public.wallet_ledger
FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

ALTER TABLE public.kithly_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_ledger_select ON public.wallet_ledger;
CREATE POLICY wallet_ledger_select ON public.wallet_ledger
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kithly_wallets w
                 WHERE w.id = wallet_ledger.wallet_id AND w.user_id = auth.uid()));

-- Columns Stage 3 reads that the earlier stubs did not need.
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_weekly_pick boolean DEFAULT false;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS promo_badge_text text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS opening_hours jsonb;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS rating_sum integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.item_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  image_url  text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.item_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_images_read ON public.item_images;
CREATE POLICY item_images_read ON public.item_images
  FOR SELECT TO anon, authenticated USING (true);

-- items_merchant_write, as 20260802020000 defines it. The governance trigger in
-- 20260914000000 is tested against this exact policy, so the stub must match.
DROP POLICY IF EXISTS items_merchant_write ON public.items;
CREATE POLICY items_merchant_write ON public.items
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.merchant_shops ms
            JOIN public.shops s ON s.id = ms.shop_id
            WHERE ms.shop_id = items.shop_id AND ms.user_id = auth.uid() AND s.is_active = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.merchant_shops ms
            JOIN public.shops s ON s.id = ms.shop_id
            WHERE ms.shop_id = items.shop_id AND ms.user_id = auth.uid() AND s.is_active = true)
  );

DROP POLICY IF EXISTS items_admin_write ON public.items;
CREATE POLICY items_admin_write ON public.items
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Columns and tables the Pulse counts over.
-- Real columns only. An earlier version of this scaffold invented
-- shop_orders.updated_at because a migration under test wanted one, which
-- made the migration pass here and fail in production. See the drift test.
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  owner_shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  title         text NOT NULL,
  visibility    text NOT NULL DEFAULT 'private',
  template      text NOT NULL DEFAULT 'standard',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.list_saves (
  list_id    uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.shop_ratings (
  shop_id    uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating     integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, user_id)
);

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_quote_only boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.transactions (
  transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id       uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.order_items (
  order_item_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_order_id  uuid NOT NULL REFERENCES public.shop_orders(shop_order_id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE
);
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS transaction_id uuid;

-- ---------------------------------------------------------------------------
-- Escrow & settlement model (20260915*)
--
-- Every column below is checked against src/types/database.types.ts by
-- tests/scaffold-drift.test.ts. Nothing here may be invented to make a
-- migration pass -- that is the exact failure mode that test exists to catch.
-- ---------------------------------------------------------------------------

-- users.role is what current_user_role() reads and what the admin guards check.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'sender';

-- shops: the legacy payout fields the destination backfill reads, and the
-- redemption counter the settlement tier derives from.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS payout_method text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS payout_details text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS payout_account_name text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS payout_bank_name text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS successful_deliveries integer NOT NULL DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS float_balance integer NOT NULL DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS active_exposure integer NOT NULL DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS float_exposure_limit integer NOT NULL DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS upfront_payout_percentage integer NOT NULL DEFAULT 0;

-- shop_orders: the redemption and expiry paths read all of these.
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS claim_code text;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS subtotal integer NOT NULL DEFAULT 0;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS settled boolean DEFAULT false;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS settlement_target_time timestamptz;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS target_execution_date timestamptz;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS upfront_paid integer NOT NULL DEFAULT 0;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- order_items: allocated_price is the value that moves at redemption.
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS allocated_price integer NOT NULL DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- items: the expiry clock reads these.
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS has_expiry boolean NOT NULL DEFAULT true;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS valid_for_days integer;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS requires_scheduling boolean NOT NULL DEFAULT false;

-- transactions: the funding leg needs the gateway reference and the amount.
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS gateway_tx_ref text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS total_amount integer NOT NULL DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ZMW';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'GATEWAY_PROCESSING';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- platform_settings, as 20260620000000 and its successors shape it. Only the
-- columns the escrow migrations read; the escrow migrations add their own.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                             integer PRIMARY KEY DEFAULT 1,
  current_usd_zmw_rate           numeric(10,2) NOT NULL DEFAULT 26.00,
  dispute_window_minutes         integer NOT NULL DEFAULT 1440,
  expiry_sender_refund_percent   integer NOT NULL DEFAULT 80,
  merchant_fee_percent           numeric NOT NULL DEFAULT 5,
  local_buyer_fee_percent        numeric NOT NULL DEFAULT 0,
  international_buyer_fee_percent numeric NOT NULL DEFAULT 0,
  voucher_grace_days             integer NOT NULL DEFAULT 14,
  expiry_reminder_days           integer NOT NULL DEFAULT 3,
  CONSTRAINT platform_settings_one_row CHECK (id = 1)
);
INSERT INTO public.platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_settings_read ON public.platform_settings;
CREATE POLICY platform_settings_read ON public.platform_settings
  FOR SELECT TO anon, authenticated USING (true);

-- transaction_events: the audit trail every money path writes to.
CREATE TABLE IF NOT EXISTS public.transaction_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_order_id  uuid REFERENCES public.shop_orders(shop_order_id) ON DELETE SET NULL,
  transaction_id uuid,
  event_type     text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz DEFAULT now()
);
ALTER TABLE public.transaction_events ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS enforce_immutable_transaction_events ON public.transaction_events;
CREATE TRIGGER enforce_immutable_transaction_events
  BEFORE UPDATE OR DELETE ON public.transaction_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

-- admin_action_log, as 20260729050000 shapes it. Note actor_id/payload -- NOT
-- admin_id/details, which is what a reasonable person writes from memory and
-- what the real table does not have.
CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   uuid,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS enforce_immutable_admin_action_log ON public.admin_action_log;
CREATE TRIGGER enforce_immutable_admin_action_log
  BEFORE UPDATE OR DELETE ON public.admin_action_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

-- create_notification, taken from 20260727040000. The escrow paths notify
-- merchants and senders, and a stub that silently swallowed those calls would
-- let a migration ship that references a column notifications does not have.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id      uuid,
  p_message      text,
  p_type         text,
  p_reference_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR btrim(coalesce(p_message, '')) = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (user_id, message, type, is_read, reference_id)
  VALUES (p_user_id, p_message, p_type, false, p_reference_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- The legacy stored-value tables. 20260915070000 attaches its refusal triggers
-- to these, so they must exist here for that migration to apply. Columns match
-- src/types/database.types.ts exactly; the scaffold-drift test checks them.
CREATE TABLE IF NOT EXISTS public.merchant_float_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  shop_order_id uuid REFERENCES public.shop_orders(shop_order_id) ON DELETE SET NULL,
  amount        integer NOT NULL,
  entry_type    text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_float_ledger ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS enforce_immutable_merchant_float_ledger ON public.merchant_float_ledger;
CREATE TRIGGER enforce_immutable_merchant_float_ledger
  BEFORE UPDATE OR DELETE ON public.merchant_float_ledger
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

CREATE TABLE IF NOT EXISTS public.merchant_withdrawals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  amount               integer NOT NULL,
  status               text NOT NULL DEFAULT 'PENDING',
  provider             text NOT NULL DEFAULT 'flutterwave',
  provider_reference   text,
  provider_transfer_id text,
  failure_reason       text,
  ledger_id            uuid,
  requested_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  processed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.payout_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_order_id uuid,
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  credit_amount integer NOT NULL DEFAULT 0,
  ledger_type   text NOT NULL DEFAULT 'FULFILLMENT_CREDIT',
  reference     text,
  amount        integer,
  commission    integer,
  status        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payout_ledger ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS enforce_immutable_payout_ledger ON public.payout_ledger;
CREATE TRIGGER enforce_immutable_payout_ledger
  BEFORE UPDATE OR DELETE ON public.payout_ledger
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();
