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
  phone         text NOT NULL
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
