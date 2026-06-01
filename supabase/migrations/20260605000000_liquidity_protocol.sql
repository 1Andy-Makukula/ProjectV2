-- =============================================================================
-- KithLy V6 — Restricted Liquidity Protocol (Escrow Conversion to Wallet Credits)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.convert_floating_item_to_credits(
  p_item_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocated_price INTEGER;
  v_recipient_phone TEXT;
  v_user_phone TEXT;
  v_status TEXT;
  v_shop_order_id UUID;
BEGIN
  -- 1. Get the order item details and verify it exists
  SELECT allocated_price, fulfillment_status, shop_order_id
  INTO v_allocated_price, v_status, v_shop_order_id
  FROM public.order_items
  WHERE order_item_id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found';
  END IF;

  -- 2. Verify the item is currently FLOATING
  IF v_status <> 'FLOATING' THEN
    RAISE EXCEPTION 'Item is not in FLOATING status (current status: %)', v_status;
  END IF;

  -- 3. Get the recipient's phone number from shop_orders
  SELECT recipient_phone
  INTO v_recipient_phone
  FROM public.shop_orders
  WHERE shop_order_id = v_shop_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated shop order not found';
  END IF;

  -- 4. Get the user's phone number from users table
  SELECT phone
  INTO v_user_phone
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- 5. Verify the item matches the user by comparing phone numbers
  IF COALESCE(v_recipient_phone, '') = '' OR COALESCE(v_user_phone, '') <> COALESCE(v_recipient_phone, '') THEN
    RAISE EXCEPTION 'User phone mismatch: recipient is %, user is %', v_recipient_phone, v_user_phone;
  END IF;

  -- 6. Update order_items status to CONVERTED
  UPDATE public.order_items
  SET fulfillment_status = 'CONVERTED',
      fulfilled_at = now()
  WHERE order_item_id = p_item_id;

  -- 7. Add the allocated_price to the user's wallet using existing increment_wallet_balance function
  PERFORM public.increment_wallet_balance(p_user_id, v_allocated_price, 'CONVERSION:' || p_item_id, v_shop_order_id);

  RETURN TRUE;
END;
$$;

-- Revoke all permissions and grant to authenticated users
REVOKE ALL ON FUNCTION public.convert_floating_item_to_credits(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_floating_item_to_credits(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_floating_item_to_credits(UUID, UUID) TO service_role;
