-- =============================================================================
-- KithLy V2 — Row Level Security Hardening & Secure RPC Lookup
-- Disables wide-open anonymous access and introduces a secure RPC gateway.
-- =============================================================================

-- 1. Drop the wide-open select policy on shop_orders
DROP POLICY IF EXISTS shop_orders_select_by_claim_code ON public.shop_orders;

-- 2. Restrict order_items to authenticated users or admin context, preventing direct anonymous leaks
DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shop_orders so
      WHERE so.shop_order_id = order_items.shop_order_id
    )
  );

-- 3. Create the secure RPC function to fetch non-sensitive shop order details by claim code
CREATE OR REPLACE FUNCTION public.get_shop_order_by_claim_code(code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- Bypasses client-level RLS safely to perform lookup
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Validate input code
  IF code IS NULL OR trim(code) = '' THEN
    RETURN NULL;
  END IF;

  SELECT 
    jsonb_build_object(
      'claim_code', so.claim_code,
      'message', so.message,
      'recipient_name', so.recipient_name,
      'created_at', so.created_at,
      'shops', jsonb_build_object(
        'name', s.name,
        'address', s.address,
        'logo_url', s.logo_url
      ),
      'transactions', jsonb_build_object(
        'users', jsonb_build_object(
          'name', u.name
        )
      ),
      'order_items', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'items', jsonb_build_object(
                'name', i.name,
                'image_url', i.image_url
              )
            )
          )
          FROM order_items oi
          LEFT JOIN items i ON i.id = oi.item_id
          WHERE oi.shop_order_id = so.shop_order_id
        ),
        '[]'::jsonb
      )
    ) INTO result
  FROM shop_orders so
  LEFT JOIN shops s ON s.id = so.shop_id
  LEFT JOIN transactions t ON t.transaction_id = so.transaction_id
  LEFT JOIN users u ON u.id = t.buyer_id
  WHERE UPPER(so.claim_code) = UPPER(trim(code))
  LIMIT 1;

  RETURN result;
END;
$$;

-- Grant execution permission to anonymous and authenticated users
GRANT EXECUTE ON FUNCTION public.get_shop_order_by_claim_code(text) TO anon, authenticated;
