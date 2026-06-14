-- Migration: Add get_transaction_status RPC to allow RLS-bypass verification queries
CREATE OR REPLACE FUNCTION public.get_transaction_status(p_transaction_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER -- Bypasses RLS!
SET search_path = public
AS $$
  SELECT status FROM public.transactions WHERE transaction_id = p_transaction_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_transaction_status(uuid) TO anon, authenticated, service_role;
