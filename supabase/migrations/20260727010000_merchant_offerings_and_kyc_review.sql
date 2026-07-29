-- =============================================================================
-- Phase 2 — Merchant offerings & guarded KYC review
--
-- Two changes:
--
-- 1. A shop declares whether it sells products, services, or both. This is
--    captured at onboarding and decides which item types the merchant is
--    offered when building their catalogue (Phase 1's item_type).
--
-- 2. Verification approval moves from raw client UPDATEs to a guarded RPC.
--    The previous flow relied on the shops_admin_write RLS policy and issued
--    the status change and the merchant notification as two separate client
--    calls, so a dropped connection between them left a shop approved with
--    nobody told. It also never cleared a stale rejection_reason on approval,
--    and left no record of which admin made the decision.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. What the shop offers
-- ---------------------------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS offers_products boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.shops.offers_products IS
  'Shop sells physical goods. Existing shops default to true — that is what they were before services existed.';

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS offers_services boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.shops.offers_services IS
  'Shop sells services. Gates which item_type options the merchant sees.';

DO $$
BEGIN
  -- A shop that offers neither has nothing to list.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_offers_something_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_offers_something_check
      CHECK (offers_products OR offers_services);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Verification review audit trail
-- ---------------------------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS verification_reviewed_by uuid;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS verification_reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shops_verification_reviewed_by_fkey'
  ) THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_verification_reviewed_by_fkey
      FOREIGN KEY (verification_reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. register_merchant_shop — now records what the shop offers
--
-- The two new parameters carry defaults so a client still sending the previous
-- five arguments resolves to this function during a rolling deploy. The old
-- five-argument version is dropped, since keeping both would make a five-named-
-- argument call ambiguous.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_merchant_shop(text, text, text, text, text);

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

  RETURN jsonb_build_object('shop_id', v_shop_id, 'success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.register_merchant_shop(text, text, text, text, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_merchant_shop(text, text, text, text, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_merchant_shop(text, text, text, text, text, boolean, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. review_merchant_verification — the guarded approve/reject path
--
-- Status change, rejection reason, reviewer stamp and merchant notification
-- all happen in one transaction. Only shops still awaiting review can be
-- decided, so a double submission cannot silently re-approve a shop that was
-- rejected in between.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_merchant_verification(
  p_shop_id          uuid,
  p_decision         text,
  p_rejection_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_shop RECORD;
  v_reason TEXT := nullif(btrim(coalesce(p_rejection_reason, '')), '');
  v_approved BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may review merchant verification';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be either approved or rejected';
  END IF;

  v_approved := p_decision = 'approved';

  -- A rejection the merchant cannot act on is not worth sending.
  IF NOT v_approved AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT id, name, owner_id, verification_status
  INTO v_shop
  FROM public.shops
  WHERE id = p_shop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  IF v_shop.verification_status <> 'pending' THEN
    RAISE EXCEPTION 'This shop has already been reviewed (currently %)', v_shop.verification_status;
  END IF;

  UPDATE public.shops
  SET verification_status       = p_decision,
      is_active                 = v_approved,
      -- Clear any reason left over from an earlier rejection on approval.
      rejection_reason          = CASE WHEN v_approved THEN NULL ELSE v_reason END,
      verification_reviewed_by  = v_uid,
      verification_reviewed_at  = now()
  WHERE id = p_shop_id;

  INSERT INTO public.notifications (user_id, message, type, is_read, reference_id)
  VALUES (
    v_shop.owner_id,
    CASE
      WHEN v_approved THEN
        'Your shop "' || v_shop.name || '" has been verified and is now live on KithLy.'
      ELSE
        'Your shop "' || v_shop.name || '" could not be verified. Reason: ' || v_reason
    END,
    CASE WHEN v_approved THEN 'success' ELSE 'rejection' END,
    false,
    p_shop_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'verification_status', p_decision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_merchant_verification(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_merchant_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_merchant_verification(uuid, text, text) TO service_role;
