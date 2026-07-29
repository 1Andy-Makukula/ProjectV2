-- =============================================================================
-- Schedule the merchant payout sweep
--
-- 20260615000000_harden_and_remediate_data_layer.sql already defined
-- public.trigger_daily_payout_sweeper() -- it reads SUPABASE_SERVICE_ROLE_KEY
-- and SUPABASE_PROJECT_URL from Vault and posts to
-- /functions/v1/batch-payout-sweeper with an Authorization: Bearer header,
-- which satisfies that function's own auth check (it falls back to
-- SUPABASE_SERVICE_ROLE_KEY when BATCH_PAYOUT_SWEEPER_SECRET isn't set). It
-- was written expecting to be scheduled, but no migration ever called
-- cron.schedule for it -- the same gap as batch-payout-sweeper itself, one
-- level up.
--
-- This reuses that function rather than adding a second, differently-named
-- dispatch mechanism, and schedules it the same direct way
-- process_due_redemptions() and notify_expiring_vouchers() already are
-- elsewhere in this migration history -- pg_cron/pg_net/Vault are already
-- active in this project, so no extension setup or new secrets are needed
-- here.
-- =============================================================================

SELECT cron.unschedule('kithly-batch-payout-sweeper')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'kithly-batch-payout-sweeper'
  );

-- Every 15 minutes, matching the cadence of the (legacy) payment-confirmation
-- sweep. Safe to run often: batch-payout-sweeper returns immediately when the
-- withdrawal queue is empty.
SELECT cron.schedule(
  'kithly-batch-payout-sweeper',
  '*/15 * * * *',
  $$ SELECT public.trigger_daily_payout_sweeper(); $$
);
