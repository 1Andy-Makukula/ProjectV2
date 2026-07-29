-- =============================================================================
-- WhatsApp delivery for expiry reminders
--
-- notify_expiring_vouchers() (20260727030000_pricing_and_expiry_protocol.sql)
-- already writes a durable in-app notification and an EXPIRY_REMINDER_SENT
-- ledger event, but says so itself in its own comment: it does not deliver
-- over WhatsApp, and that delivery "still needs to be wired to this sweep".
-- It never was.
--
-- This adds that wiring as a separate function rather than editing
-- notify_expiring_vouchers() in place, mirroring how trigger_daily_payout_sweeper()
-- is kept separate from request_withdrawal_atomic(): detection/bookkeeping and
-- external dispatch are different concerns with different failure modes, and
-- keeping them apart means a dispatch problem can never block the reminder
-- from being recorded.
--
-- Reuses send-notification's now-generic `message` field (see the
-- accompanying Edge Function change) rather than its gift-claim template --
-- a "your gift hasn't been collected yet" reminder is not a claim
-- notification and forcing it through that template would be misleading.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_expiry_reminder_whatsapp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
  v_edge_function_url text;
  v_service_role_key  text;
  v_row               RECORD;
  v_request_id        bigint;
  v_count             integer := 0;
BEGIN
  SELECT decrypted_secret INTO v_service_role_key
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

  SELECT decrypted_secret INTO v_edge_function_url
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_PROJECT_URL' LIMIT 1;

  IF v_service_role_key IS NULL OR v_service_role_key = ''
     OR v_edge_function_url IS NULL OR v_edge_function_url = '' THEN
    RAISE WARNING '[dispatch_expiry_reminder_whatsapp] SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PROJECT_URL missing in Vault. Skipping.';
    RETURN 0;
  END IF;

  v_edge_function_url := rtrim(v_edge_function_url, '/') || '/functions/v1/send-notification';

  FOR v_row IN
    SELECT
      te.transaction_id,
      te.payload ->> 'shop_order_id' AS shop_order_id,
      so.recipient_name,
      so.recipient_phone,
      so.claim_code,
      s.name AS shop_name
    FROM public.transaction_events te
    JOIN public.shop_orders so ON so.shop_order_id = (te.payload ->> 'shop_order_id')::uuid
    JOIN public.shops s ON s.id = so.shop_id
    WHERE te.event_type = 'EXPIRY_REMINDER_SENT'
      -- Generous window relative to the 15-minute dispatch cadence below, so
      -- a missed or failed tick still gets retried on the next one.
      AND te.created_at > now() - interval '2 hours'
      AND so.recipient_phone IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.transaction_events te2
        WHERE te2.transaction_id = te.transaction_id
          AND te2.event_type = 'EXPIRY_REMINDER_WHATSAPP_SENT'
          AND te2.payload ->> 'shop_order_id' = te.payload ->> 'shop_order_id'
      )
    LIMIT 200
  LOOP
    SELECT net.http_post(
      url     := v_edge_function_url,
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_service_role_key
                 ),
      body    := jsonb_build_object(
                   'recipient_name',  v_row.recipient_name,
                   'recipient_phone', v_row.recipient_phone,
                   'message',
                     'Hi ' || v_row.recipient_name || ', your gift from ' || v_row.shop_name ||
                     ' (code ' || v_row.claim_code || ') has not been collected yet and will expire soon. ' ||
                     'Please visit the shop to redeem it.'
                 )
    ) INTO v_request_id;

    INSERT INTO public.transaction_events (transaction_id, event_type, payload)
    VALUES (
      v_row.transaction_id,
      'EXPIRY_REMINDER_WHATSAPP_SENT',
      jsonb_build_object('shop_order_id', v_row.shop_order_id, 'request_id', v_request_id)
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

ALTER FUNCTION public.dispatch_expiry_reminder_whatsapp() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.dispatch_expiry_reminder_whatsapp() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_expiry_reminder_whatsapp() TO service_role;

-- ---------------------------------------------------------------------------
-- Schedule: every 15 minutes. notify-expiring-vouchers-job only runs once a
-- day (09:00), but this can run far more often than the events it's looking
-- for are produced -- it does nothing when there is nothing new to send.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('kithly-dispatch-expiry-reminder-whatsapp')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'kithly-dispatch-expiry-reminder-whatsapp'
  );

SELECT cron.schedule(
  'kithly-dispatch-expiry-reminder-whatsapp',
  '*/15 * * * *',
  $$ SELECT public.dispatch_expiry_reminder_whatsapp(); $$
);
