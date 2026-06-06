-- =============================================================================
-- Fix public.current_user_role() bug
-- 
-- The previous implementation used COALESCE(auth.jwt() ->> 'role', ...) 
-- Since Supabase always includes "role": "authenticated" in the JWT, 
-- it always returned "authenticated" instead of falling back to the users table.
-- This broke all Admin RLS policies (returning 403 Forbidden).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Always fetch the authoritative role from the users table.
  -- (If you want to use custom JWT claims in the future, use auth.jwt() -> 'app_metadata' ->> 'role')
  SELECT role FROM public.users WHERE id = auth.uid();
$$;
