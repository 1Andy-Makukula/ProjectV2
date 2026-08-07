-- =============================================================================
-- Phase 1 — Shop identity: directions, public contact, opening hours
--
-- `shops` already carries location/address as free text, which ShopDetail
-- renders as inert prose. A buyer deciding whether to collect a gift in person
-- has no way to navigate there, no way to call ahead, and no way to know the
-- shop is shut before travelling.
--
-- ---------------------------------------------------------------------------
-- Why public_email / public_phone rather than reusing the owner's login
-- ---------------------------------------------------------------------------
-- A storefront contact is usually a business line, not the personal account of
-- whoever registered the shop. Reusing users.email/phone would publish that
-- personal contact on a public page, and copying it into shops would leave two
-- copies to drift apart. These are separate, deliberately optional fields.
--
-- ---------------------------------------------------------------------------
-- maps_link is an outbound link on a public page
-- ---------------------------------------------------------------------------
-- Merchant-supplied, buyer-clicked, and therefore a phishing vector. The check
-- constraint below is the server-side half of the defence: https only, and only
-- Google Maps hostnames. The client validates too, but the client is not what
-- makes this safe.
--
-- ---------------------------------------------------------------------------
-- opening_hours shape
-- ---------------------------------------------------------------------------
--   {"mon": {"open": "08:00", "close": "17:00"}, "sat": {...}}
--
-- An absent day means closed that day; `{}` means no hours published. Times are
-- 24-hour local wall time for Africa/Lusaka, which observes no DST — so a plain
-- HH:MM with no offset is unambiguous here and stays readable in the database.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS maps_link text;
COMMENT ON COLUMN public.shops.maps_link IS
  'Google Maps URL for the storefront. Rendered as the buyer-facing Get Directions link.';

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS public_email text;
COMMENT ON COLUMN public.shops.public_email IS
  'Storefront contact address. Deliberately separate from the owner''s login email.';

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS public_phone text;
COMMENT ON COLUMN public.shops.public_phone IS
  'Storefront contact number. Deliberately separate from the owner''s login phone.';

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS opening_hours jsonb;
COMMENT ON COLUMN public.shops.opening_hours IS
  'Per-weekday {open,close} in Africa/Lusaka wall time. Absent day = closed. NULL = not published.';

-- ---------------------------------------------------------------------------
-- 2. opening_hours shape validator
--
-- A CHECK cannot contain a subquery directly, so the per-key walk lives in an
-- IMMUTABLE function the constraint calls. Malformed hours would otherwise
-- reach the storefront and break the open/closed badge for every visitor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_opening_hours(p_hours jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT p_hours IS NULL
     OR (
       jsonb_typeof(p_hours) = 'object'
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_each(p_hours) AS e(day, spec)
         WHERE e.day NOT IN ('mon','tue','wed','thu','fri','sat','sun')
            OR jsonb_typeof(e.spec) <> 'object'
            OR COALESCE(e.spec->>'open','')  !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            OR COALESCE(e.spec->>'close','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       )
     )
$$;

REVOKE ALL ON FUNCTION public.is_valid_opening_hours(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_opening_hours(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Integrity constraints
--
-- Every existing row has NULL in all four columns, so each constraint is
-- satisfied on arrival and no backfill is required.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- https only, and only hostnames Google actually serves maps from. Anchored
  -- at the scheme so `https://evil.example/google.com/maps` cannot pass.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_maps_link_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_maps_link_check
      CHECK (
        maps_link IS NULL
        OR maps_link ~* '^https://((www\.)?google\.[a-z.]{2,}/maps|maps\.google\.[a-z.]{2,}|maps\.app\.goo\.gl|goo\.gl/maps)([/?#]|$)'
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_public_email_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_public_email_check
      CHECK (
        public_email IS NULL
        OR public_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
      );
  END IF;

  -- Deliberately loose: Zambian numbers are written locally and internationally
  -- and a strict pattern would reject legitimate contacts.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_public_phone_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_public_phone_check
      CHECK (public_phone IS NULL OR public_phone ~ '^\+?[0-9 ()-]{6,24}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_opening_hours_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_opening_hours_check
      CHECK (public.is_valid_opening_hours(opening_hours));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. update_shop_profile — four more whitelisted fields
--
-- shops RLS stays admin-only (see 20260729040000_shop_self_service_rpc.sql);
-- this SECURITY DEFINER RPC remains the single merchant-reachable write path.
--
-- The existing parameters use COALESCE(p_x, x), which means NULL leaves a field
-- untouched — and therefore that a merchant can never clear one. That is
-- tolerable for a name or an address, which are required anyway, but not for
-- optional contact details: a shop that changes its phone number must be able
-- to remove the old one. The four new fields therefore use an explicit
-- three-way rule instead:
--
--     NULL         -> leave unchanged   (older clients keep working)
--     '' / '{}'    -> clear to NULL     (merchant deliberately removed it)
--     a value      -> set, trimmed
--
-- CREATE OR REPLACE cannot add parameters, and keeping both signatures would
-- make the existing ten-named-argument call from useAdminShopForm ambiguous, so
-- the old signature is dropped first — the same approach
-- 20260727010000_merchant_offerings_and_kyc_review.sql took with
-- register_merchant_shop.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_shop_profile(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT);

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
  p_payout_account_name TEXT DEFAULT NULL,
  p_maps_link           TEXT DEFAULT NULL,
  p_public_email        TEXT DEFAULT NULL,
  p_public_phone        TEXT DEFAULT NULL,
  p_opening_hours       JSONB DEFAULT NULL
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
    payout_account_name = COALESCE(p_payout_account_name, payout_account_name),

    maps_link = CASE
      WHEN p_maps_link IS NULL THEN maps_link
      WHEN btrim(p_maps_link) = '' THEN NULL
      ELSE btrim(p_maps_link)
    END,
    public_email = CASE
      WHEN p_public_email IS NULL THEN public_email
      WHEN btrim(p_public_email) = '' THEN NULL
      ELSE lower(btrim(p_public_email))
    END,
    public_phone = CASE
      WHEN p_public_phone IS NULL THEN public_phone
      WHEN btrim(p_public_phone) = '' THEN NULL
      ELSE btrim(p_public_phone)
    END,
    opening_hours = CASE
      WHEN p_opening_hours IS NULL THEN opening_hours
      WHEN p_opening_hours = '{}'::jsonb THEN NULL
      ELSE p_opening_hours
    END
  WHERE id = p_shop_id;

  RETURN jsonb_build_object('success', true, 'shop_id', p_shop_id);
END;
$$;

-- Still deliberately excludes owner_id, is_active, verification_*,
-- payout_trust_tier, successful_deliveries, upfront_payout_percentage, float_*,
-- and offers_products/offers_services — everything a merchant must not be able
-- to set on their own shop.

REVOKE ALL ON FUNCTION public.update_shop_profile(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_shop_profile(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated, service_role;
