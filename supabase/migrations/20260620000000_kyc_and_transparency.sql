-- Phase 1 Migration: KYC Onboarding & Pricing Transparency

-- 1. Alter users table to add location column
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS location text;

-- 2. Alter shops table to add KYC and verification columns
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS nrc_url text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS pacra_url text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS shop_location text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS physical_address text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS verification_tier text DEFAULT 'tier_1';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Add verification_status column with check constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'verification_status'
    ) THEN
        ALTER TABLE public.shops ADD COLUMN verification_status text DEFAULT 'pending';
        ALTER TABLE public.shops ADD CONSTRAINT shops_verification_status_check 
            CHECK (verification_status IN ('pending', 'approved', 'rejected'));
    END IF;
END $$;

-- 3. Create platform_settings table
CREATE TABLE IF NOT EXISTS public.platform_settings (
    id int PRIMARY KEY DEFAULT 1,
    current_usd_zmw_rate numeric(10,2) NOT NULL DEFAULT 26.00,
    CONSTRAINT platform_settings_one_row CHECK (id = 1)
);

-- Seed platform_settings
INSERT INTO public.platform_settings (id, current_usd_zmw_rate)
VALUES (1, 26.00)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on platform_settings
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Policy for platform_settings: Public select read access
CREATE POLICY "Public read access to platform_settings" 
ON public.platform_settings FOR SELECT USING (true);

-- Policy for platform_settings: Admins can update
CREATE POLICY "Admins can update platform_settings" 
ON public.platform_settings FOR UPDATE 
TO authenticated 
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

-- 4. Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    message text NOT NULL,
    type text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    reference_id text
);

-- Enable RLS on notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policies for notifications:
CREATE POLICY "Users can select own notifications" 
ON public.notifications FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id OR public.current_user_role() = 'admin');

CREATE POLICY "Users can update own notifications" 
ON public.notifications FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id OR public.current_user_role() = 'admin')
WITH CHECK (auth.uid() = user_id OR public.current_user_role() = 'admin');

CREATE POLICY "Admins and system can insert notifications" 
ON public.notifications FOR INSERT 
TO authenticated 
WITH CHECK (public.current_user_role() = 'admin' OR auth.uid() = user_id);

-- 5. Redefine register_merchant_shop RPC to include new fields
DROP FUNCTION IF EXISTS public.register_merchant_shop(text, text);

CREATE OR REPLACE FUNCTION public.register_merchant_shop(
  p_shop_name text,
  p_location text,
  p_physical_address text,
  p_nrc_url text,
  p_pacra_url text
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
    verification_status
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
    'pending'
  )
  RETURNING id INTO v_shop_id;

  INSERT INTO public.merchant_shops (user_id, shop_id)
  VALUES (v_uid, v_shop_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('shop_id', v_shop_id, 'success', true);
END;
$$;

GRANT ALL ON FUNCTION public.register_merchant_shop(text, text, text, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.register_merchant_shop(text, text, text, text, text) TO service_role;

-- 6. Setup private storage bucket 'merchant-documents'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('merchant-documents', 'merchant-documents', false, null, null)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage objects inside merchant-documents bucket
CREATE POLICY "Merchants and Admins can select merchant-documents"
ON storage.objects FOR SELECT 
TO authenticated
USING (
  bucket_id = 'merchant-documents'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.current_user_role() = 'admin'
  )
);

CREATE POLICY "Merchants can insert own merchant-documents"
ON storage.objects FOR INSERT 
TO authenticated
WITH CHECK (
  bucket_id = 'merchant-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Merchants can update own merchant-documents"
ON storage.objects FOR UPDATE 
TO authenticated
USING (
  bucket_id = 'merchant-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'merchant-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Merchants can delete own merchant-documents"
ON storage.objects FOR DELETE 
TO authenticated
USING (
  bucket_id = 'merchant-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
