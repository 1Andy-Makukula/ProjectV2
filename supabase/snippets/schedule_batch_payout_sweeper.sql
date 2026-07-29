-- =============================================================================
-- KithLy Merchant Payouts — Scheduled Sweep (pg_cron + pg_net)
--
-- Purpose:
--   `batch-payout-sweeper` (the Edge Function) processes the merchant
--   withdrawal queue and wires Flutterwave transfers, but nothing has ever
--   invoked it on a schedule -- it only runs when someone calls it by hand.
--   This registers a pg_cron job that fires it automatically every 15
--   minutes, mirroring the pattern already established in
--   layer_c_payment_sweep.sql for the (legacy, V1) payment-confirmation
--   sweep.
--
-- Unlike layer_c_payment_sweep.sql, this does NOT need a two-phase
-- harvest/initiate design. That daemon parses Flutterwave's HTTP response
-- itself, inside Postgres, so it has to come back on a later tick to read
-- the async pg_net response. Here, all of that logic -- claiming the batch,
-- calling Flutterwave, recording success/failure -- already lives inside the
-- batch-payout-sweeper Edge Function and completes synchronously from its
-- own point of view. Postgres's only job is to trigger an HTTP call to that
-- function on a timer; it does not need to read the response back.
--
-- Run this entire script in your Supabase SQL Editor exactly once, after:
--   1. Enabling the pg_cron and pg_net extensions (Dashboard -> Database ->
--      Extensions).
--   2. Deploying batch-payout-sweeper and setting its secret:
--      `supabase secrets set BATCH_PAYOUT_SWEEPER_SECRET=<a-random-value>`
--   3. Replacing the two placeholders below (project URL and the same
--      secret value from step 2) before running.
-- =============================================================================


-- =============================================================================
-- PREREQUISITE: Enable required extensions
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;


-- =============================================================================
-- STEP 0: Store the project URL and sweeper secret in Supabase Vault
--
-- Postgres cannot read the Edge Function's Deno environment, so the same
-- secret configured via `supabase secrets set BATCH_PAYOUT_SWEEPER_SECRET=...`
-- has to be duplicated here for the cron job to present it back as proof the
-- call came from KithLy's own scheduler. Kept as its own narrow secret
-- (rather than reusing the service role key) so this job cannot do anything
-- beyond triggering the sweeper.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'KITHLY_PROJECT_URL') THEN
    PERFORM vault.create_secret(
      'https://YOUR-PROJECT-REF.supabase.co',  -- <- replace with your real project URL
      'KITHLY_PROJECT_URL',
      'Base URL used by scheduled jobs to reach this project''s Edge Functions'
    );
    RAISE NOTICE '[schedule_batch_payout_sweeper] Vault secret KITHLY_PROJECT_URL created — replace the placeholder value if you have not already.';
  ELSE
    RAISE NOTICE '[schedule_batch_payout_sweeper] Vault secret KITHLY_PROJECT_URL already exists — skipping.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'BATCH_PAYOUT_SWEEPER_SECRET') THEN
    PERFORM vault.create_secret(
      'YOUR_BATCH_PAYOUT_SWEEPER_SECRET_HERE',  -- <- replace with the same value passed to `supabase secrets set`
      'BATCH_PAYOUT_SWEEPER_SECRET',
      'Shared secret the payout sweep cron job presents to batch-payout-sweeper'
    );
    RAISE NOTICE '[schedule_batch_payout_sweeper] Vault secret BATCH_PAYOUT_SWEEPER_SECRET created — replace the placeholder value if you have not already.';
  ELSE
    RAISE NOTICE '[schedule_batch_payout_sweeper] Vault secret BATCH_PAYOUT_SWEEPER_SECRET already exists — skipping.';
  END IF;
END;
$$;


-- =============================================================================
-- STEP 1: Create the invoking function
-- =============================================================================
CREATE OR REPLACE FUNCTION public.invoke_batch_payout_sweeper()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
  v_project_url    text;
  v_sweeper_secret text;
  v_request_id     bigint;
BEGIN
  SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'KITHLY_PROJECT_URL' LIMIT 1;

  SELECT decrypted_secret INTO v_sweeper_secret
    FROM vault.decrypted_secrets WHERE name = 'BATCH_PAYOUT_SWEEPER_SECRET' LIMIT 1;

  IF v_project_url IS NULL OR v_project_url = '' OR v_project_url LIKE '%YOUR-PROJECT-REF%' THEN
    RAISE WARNING '[invoke_batch_payout_sweeper] KITHLY_PROJECT_URL is missing or still a placeholder. Aborting — no request sent.';
    RETURN;
  END IF;

  IF v_sweeper_secret IS NULL OR v_sweeper_secret = '' OR v_sweeper_secret LIKE '%YOUR_BATCH_PAYOUT_SWEEPER_SECRET%' THEN
    RAISE WARNING '[invoke_batch_payout_sweeper] BATCH_PAYOUT_SWEEPER_SECRET is missing or still a placeholder. Aborting — no request sent.';
    RETURN;
  END IF;

  SELECT net.http_post(
    url     => v_project_url || '/functions/v1/batch-payout-sweeper',
    headers => jsonb_build_object(
                 'Content-Type',      'application/json',
                 'x-sweeper-secret',  v_sweeper_secret
               ),
    body    => '{}'::jsonb
  ) INTO v_request_id;

  RAISE LOG '[invoke_batch_payout_sweeper] Fired request_id=% against batch-payout-sweeper.', v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invoke_batch_payout_sweeper() TO postgres;


-- =============================================================================
-- STEP 2: Schedule the cron job
--
-- Every 15 minutes, matching the cadence already established for the payment
-- sweep. Safe to run this often: batch-payout-sweeper returns immediately
-- when the withdrawal queue is empty.
-- =============================================================================
SELECT cron.unschedule('kithly-batch-payout-sweeper')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'kithly-batch-payout-sweeper'
  );

SELECT cron.schedule(
  'kithly-batch-payout-sweeper',
  '*/15 * * * *',
  'SELECT public.invoke_batch_payout_sweeper();'
);


-- =============================================================================
-- STEP 3: Verify the job was registered correctly
-- =============================================================================
SELECT
  jobid,
  jobname,
  schedule,
  command,
  active,
  username
FROM
  cron.job
WHERE
  jobname = 'kithly-batch-payout-sweeper';
