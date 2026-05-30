-- =============================================================================
-- KithLy V2 — Shop Image Columns
-- Adds logo_url and cover_image_url to the shops table for the unified UI
-- =============================================================================

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
