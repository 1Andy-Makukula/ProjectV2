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
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  category_id  uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name         text NOT NULL,
  is_available boolean NOT NULL DEFAULT true
);

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
