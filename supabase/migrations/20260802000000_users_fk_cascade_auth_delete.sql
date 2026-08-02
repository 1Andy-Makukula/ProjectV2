-- =============================================================================
-- Cascade public.users deletion when the backing auth.users account is deleted
-- =============================================================================
-- Without this FK, deleting a user from Supabase Auth (e.g. via the dashboard)
-- leaves an orphaned public.users row behind. Because public.users.email is
-- UNIQUE, that orphan permanently blocks anyone from ever signing up again
-- with that email: the handle_new_user() trigger's insert for the new auth
-- id fails on the email unique constraint, and the row is never created.
--
-- kithly_wallets.user_id already REFERENCES public.users(id) without
-- ON DELETE CASCADE either, so it's fixed here too (deleting the wallet
-- first is required before the users row can go).

ALTER TABLE public.kithly_wallets
  DROP CONSTRAINT IF EXISTS kithly_wallets_user_id_fkey,
  ADD CONSTRAINT kithly_wallets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.users
  ADD CONSTRAINT users_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
