-- =============================================================================
-- Shop self-service: whitelisted RPC instead of a blanket RLS policy
--
-- shops RLS has exactly one write policy, shops_admin_write (admin-only) --
-- confirmed in 20260525140000_v2_rls_policies.sql, which even says so in its
-- own comment: "Direct shop INSERT blocked; use register_merchant_shop RPC".
-- No merchant-scoped write policy exists at all. So when a merchant submits
-- their own shop-edit form (routed at /merchant/shop/edit, reusing
-- AdminShopForm/useAdminShopForm), the client's `.from('shops').update(...)`
-- is silently blocked by RLS -- zero rows match, no error is thrown -- while
-- the UI still reports "Shop updated successfully" and nothing changed.
--
-- items has both items_admin_write and items_merchant_write side by side,
-- and that pair genuinely works for items. It would not work for shops: a
-- shop row mixes merchant-owned fields (name, address, payout details) with
-- admin-owned governance fields on the very same row -- is_active,
-- verification_status, payout_trust_tier, float_balance, and so on. A
-- blanket merchant write policy would let a merchant flip their own
-- is_active or bump their own trust tier directly, which is exactly the kind
-- of "merchant operates their own shop's governance" failure a platform/
-- merchant split exists to prevent.
--
-- So RLS on shops stays admin-only, and this adds a whitelisted SECURITY
-- DEFINER RPC as the only merchant-reachable write path -- the same pattern
-- register_merchant_shop and review_merchant_verification already use,
-- extended from insert to update.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_shop_profile(
  p_shop_id             UUID,
  p_name                TEXT DEFAULT NULL,
  p_location            TEXT DEFAULT NULL,
  p_address             TEXT DEFAULT NULL,
  p_logo_url            TEXT DEFAULT NULL,
  p_cover_image_url     TEXT DEFAULT NULL,
  p_payout_method       TEXT DEFAULT NULL,
  p_payout_details      TEXT DEFAULT NULL,
  p_payout_bank_name    TEXT DEFAULT NULL,
  p_payout_account_name TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_effective_bank_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_shops WHERE shop_id = p_shop_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Forbidden: not assigned to this shop';
  END IF;

  IF p_payout_method = 'bank' THEN
    SELECT COALESCE(p_payout_bank_name, payout_bank_name) INTO v_effective_bank_name
    FROM public.shops WHERE id = p_shop_id;

    IF v_effective_bank_name IS NULL THEN
      RAISE EXCEPTION 'A bank must be selected for bank account payouts';
    END IF;
  END IF;

  UPDATE public.shops SET
    name = COALESCE(p_name, name),
    location = COALESCE(p_location, location),
    shop_location = COALESCE(p_location, shop_location),
    address = COALESCE(p_address, address),
    physical_address = COALESCE(p_address, physical_address),
    logo_url = COALESCE(p_logo_url, logo_url),
    cover_image_url = COALESCE(p_cover_image_url, cover_image_url),
    payout_method = COALESCE(p_payout_method, payout_method),
    payout_details = COALESCE(p_payout_details, payout_details),
    payout_bank_name = CASE
      WHEN p_payout_method = 'bank' THEN COALESCE(p_payout_bank_name, payout_bank_name)
      WHEN p_payout_method IS NOT NULL THEN NULL  -- switching away from bank clears the stale bank selection
      ELSE payout_bank_name
    END,
    payout_account_name = COALESCE(p_payout_account_name, payout_account_name)
  WHERE id = p_shop_id;

  RETURN jsonb_build_object('success', true, 'shop_id', p_shop_id);
END;
$$;

-- Deliberately excludes owner_id, is_active, verification_*, payout_trust_tier,
-- successful_deliveries, upfront_payout_percentage, float_*, offers_products/
-- offers_services (changing offerings cascades into catalogue item_type
-- gating -- a deliberate future extension, not silently bundled here) --
-- everything a merchant must not be able to set on their own shop.

REVOKE ALL ON FUNCTION public.update_shop_profile(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_shop_profile(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated, service_role;
