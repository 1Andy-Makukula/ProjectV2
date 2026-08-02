-- =============================================================================
-- Reapply the current_user_role() fix — it had drifted back to the broken version
--
-- 20260614200000_fix_current_user_role.sql already diagnosed and fixed this
-- exact bug: auth.jwt() ->> 'role' is Supabase's own session-role claim
-- ("authenticated"), always present on every JWT, so COALESCE'ing it first
-- meant the users-table lookup — the one that would actually return "admin" —
-- was never reached. Verified live: a real admin session's current_user_role()
-- was still returning "authenticated", and every admin-gated RLS policy and
-- RPC (shops, users, items, categories, the finance tables, the order-engine
-- overrides) was silently failing as a result.
--
-- That migration is recorded as applied (`supabase migration list` shows it
-- matched on remote), so the live function must have been redefined again
-- afterward outside the migration chain — the same drift pattern found in
-- handle_new_user() at the start of this working session. This reapplies the
-- identical fixed body so the two can no longer disagree.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;
