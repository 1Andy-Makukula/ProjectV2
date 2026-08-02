-- =============================================================================
-- Merchant application review gating
--
-- Two gaps found while investigating a merchant whose application went
-- unnoticed: (1) register_merchant_shop never told anyone an application
-- existed, so admins only found pending shops by remembering to check, and
-- (2) items_merchant_write let a merchant write to their catalogue the
-- moment their shop row existed, regardless of verification_status/is_active
-- — contradicting the onboarding copy's promise that inventory management
-- unlocks "once approved".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. register_merchant_shop — notify every admin when a shop is submitted
--
-- Same signature as the 20260727010000 version; only the body changes to add
-- the notification fan-out after the shop row is created.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_merchant_shop(
  p_shop_name        text,
  p_location         text,
  p_physical_address text,
  p_nrc_url          text,
  p_pacra_url        text,
  p_offers_products  boolean DEFAULT true,
  p_offers_services  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_shop_id UUID;
  v_current_role TEXT;
  v_admin RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_current_role FROM public.users WHERE id = v_uid;
  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
  IF v_current_role NOT IN ('sender', 'merchant') THEN
    RAISE EXCEPTION 'Only senders may register a shop';
  END IF;

  IF NOT (p_offers_products OR p_offers_services) THEN
    RAISE EXCEPTION 'A shop must offer products, services, or both';
  END IF;

  UPDATE public.users SET role = 'merchant' WHERE id = v_uid AND role = 'sender';

  INSERT INTO public.shops (
    name,
    location,
    shop_location,
    physical_address,
    nrc_url,
    pacra_url,
    owner_id,
    is_active,
    verification_tier,
    verification_status,
    offers_products,
    offers_services
  )
  VALUES (
    trim(p_shop_name),
    trim(p_location),
    trim(p_location),
    trim(p_physical_address),
    p_nrc_url,
    p_pacra_url,
    v_uid,
    false,
    'tier_1',
    'pending',
    p_offers_products,
    p_offers_services
  )
  RETURNING id INTO v_shop_id;

  INSERT INTO public.merchant_shops (user_id, shop_id)
  VALUES (v_uid, v_shop_id)
  ON CONFLICT DO NOTHING;

  -- Nobody was told a shop was waiting on review; tell every admin now.
  FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' LOOP
    PERFORM public.create_notification(
      v_admin.id,
      'New merchant application: "' || trim(p_shop_name) || '" is awaiting review.',
      'merchant_application',
      v_shop_id::text);
  END LOOP;

  RETURN jsonb_build_object('shop_id', v_shop_id, 'success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.register_merchant_shop(text, text, text, text, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_merchant_shop(text, text, text, text, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_merchant_shop(text, text, text, text, text, boolean, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. items_merchant_write — require the shop to actually be live
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS items_merchant_write ON public.items;
CREATE POLICY items_merchant_write ON public.items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      JOIN public.shops s ON s.id = ms.shop_id
      WHERE ms.shop_id = items.shop_id AND ms.user_id = auth.uid() AND s.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      JOIN public.shops s ON s.id = ms.shop_id
      WHERE ms.shop_id = items.shop_id AND ms.user_id = auth.uid() AND s.is_active = true
    )
  );
