-- Migration: Create claim_status_feed table for real-time tracking
CREATE TABLE IF NOT EXISTS public.claim_status_feed (
  claim_code text PRIMARY KEY,
  claim_status text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.claim_status_feed ENABLE ROW LEVEL SECURITY;

-- Allow anonymous and authenticated users to select the feed
DROP POLICY IF EXISTS claim_status_feed_select ON public.claim_status_feed;
CREATE POLICY claim_status_feed_select ON public.claim_status_feed
  FOR SELECT TO anon, authenticated
  USING (true);

-- Trigger function to synchronize status changes
CREATE OR REPLACE FUNCTION public.sync_claim_status_feed()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.claim_status_feed (claim_code, claim_status, updated_at)
  VALUES (NEW.claim_code, NEW.claim_status, now())
  ON CONFLICT (claim_code)
  DO UPDATE SET 
    claim_status = EXCLUDED.claim_status,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to execute the function on INSERT or UPDATE
DROP TRIGGER IF EXISTS sync_claim_status_feed_trigger ON public.shop_orders;
CREATE TRIGGER sync_claim_status_feed_trigger
AFTER INSERT OR UPDATE OF claim_status, claim_code ON public.shop_orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_claim_status_feed();

-- Add table to Supabase Realtime publication if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'claim_status_feed'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.claim_status_feed;
  END IF;
END;
$$;

-- Pre-populate feed with existing records
INSERT INTO public.claim_status_feed (claim_code, claim_status, updated_at)
SELECT claim_code, claim_status, COALESCE(fulfilled_at, created_at)
FROM public.shop_orders
ON CONFLICT (claim_code) DO NOTHING;
