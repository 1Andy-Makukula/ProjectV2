ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS child_claim_code character varying;
ALTER TABLE public.order_items DROP CONSTRAINT order_items_fulfillment_status_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_fulfillment_status_check CHECK (fulfillment_status = ANY (ARRAY['PENDING'::text, 'COLLECTED'::text, 'MISSING'::text, 'FLOATING'::text, 'CONVERTED'::text]));
