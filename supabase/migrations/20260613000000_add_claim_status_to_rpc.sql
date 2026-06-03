-- Redefine get_shop_order_by_claim_code to include claim_status and shop_order_id
CREATE OR REPLACE FUNCTION public.get_shop_order_by_claim_code(code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
      'claim_status', so.claim_status,
      'shop_order_id', so.shop_order_id,
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

GRANT EXECUTE ON FUNCTION public.get_shop_order_by_claim_code(text) TO anon, authenticated;

-- Add policy to allow recipients to view their received shop_orders
DROP POLICY IF EXISTS shop_orders_select ON public.shop_orders;
CREATE POLICY shop_orders_select ON public.shop_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.transaction_id = shop_orders.transaction_id
        AND t.buyer_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_orders.shop_id AND ms.user_id = auth.uid()
    )
    OR recipient_phone = (SELECT phone FROM public.users WHERE id = auth.uid())
    OR public.current_user_role() = 'admin'
  );
