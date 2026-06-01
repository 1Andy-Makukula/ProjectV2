-- =============================================================================
-- KithLy V10 — The Escrow Graveyard (The Expiration Protocol)
-- =============================================================================

-- 1. Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Expand fulfillment_status constraint to include 'EXPIRED'
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_fulfillment_status_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_fulfillment_status_check 
  CHECK (fulfillment_status = ANY (ARRAY['PENDING'::text, 'COLLECTED'::text, 'MISSING'::text, 'FLOATING'::text, 'CONVERTED'::text, 'EXPIRED'::text]));

-- 3. Expiration function
CREATE OR REPLACE FUNCTION public.process_expired_vouchers()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- We loop through all PENDING or FLOATING order items that are older than 30 days.
  -- This PL/pgSQL function runs entirely in a single atomic transaction block.
  -- If any single refund or insert fails, the entire transaction is rolled back.
  FOR v_item IN 
    SELECT oi.order_item_id, oi.allocated_price, oi.shop_order_id, so.transaction_id, t.buyer_id
    FROM public.order_items oi
    JOIN public.shop_orders so ON oi.shop_order_id = so.shop_order_id
    JOIN public.transactions t ON so.transaction_id = t.transaction_id
    WHERE oi.fulfillment_status IN ('PENDING', 'FLOATING')
      AND oi.created_at < now() - INTERVAL '30 days'
    FOR UPDATE
  LOOP
    -- A. Transition item status to EXPIRED
    UPDATE public.order_items
    SET fulfillment_status = 'EXPIRED',
        fulfilled_at = now()
    WHERE order_item_id = v_item.order_item_id;

    -- B. Refund locked value back to the original buyer's wallet
    PERFORM public.increment_wallet_balance(v_item.buyer_id, v_item.allocated_price, 'REFUND_EXPIRY:' || v_item.order_item_id, v_item.shop_order_id);

    -- C. Log AUTO_EXPIRED telemetry event
    INSERT INTO public.transaction_events (
      transaction_id,
      event_type,
      payload
    ) VALUES (
      v_item.transaction_id,
      'AUTO_EXPIRED',
      jsonb_build_object(
        'order_item_id', v_item.order_item_id,
        'allocated_price', v_item.allocated_price,
        'buyer_id', v_item.buyer_id,
        'refunded_amount', v_item.allocated_price
      )
    );
  END LOOP;
END;
$$;

-- 4. Schedule pg_cron background worker job
-- Unschedule first if exists to prevent duplicates
SELECT cron.unschedule('expire-stale-vouchers-job') FROM cron.job WHERE jobname = 'expire-stale-vouchers-job';

SELECT cron.schedule(
  'expire-stale-vouchers-job', 
  '0 0 * * *', -- Everyday at midnight (UTC)
  $$ SELECT public.process_expired_vouchers(); $$
);
