-- =============================================================================
-- Schedule the hourly FX pull
--
-- Same shape as trigger_daily_payout_sweeper: pg_cron calls a SECURITY DEFINER
-- function, which reads the project URL and service key from Vault and POSTs to
-- an Edge Function. The Edge Function does the outside-world work because the
-- OpenExchangeRates app id is a Function secret, readable through Deno.env but
-- not from Postgres -- and duplicating it into Vault would mean two copies of
-- one secret to rotate.
--
-- Hourly, not more often. The free plan allows ~1,000 calls a month and 720
-- fits with room for retries. Rates for a currency pair do not move enough
-- within an hour to matter against a 1.5% spread, and the staleness gate
-- (fx_max_snapshot_age_minutes, 180) tolerates two consecutive failures before
-- international checkout stops quoting.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trigger_fx_snapshot()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'net', 'vault'
AS $$
DECLARE
  v_edge_function_url TEXT;
  v_service_role_key  TEXT;
  v_request_id        BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_service_role_key
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
   LIMIT 1;

  SELECT decrypted_secret INTO v_edge_function_url
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_PROJECT_URL'
   LIMIT 1;

  -- A warning rather than an exception: this runs on a schedule with nobody
  -- watching, and a raised error in a cron job is noise in a log nobody reads.
  -- The visible consequence is the snapshot ageing out, which the staleness
  -- gate surfaces at the point it actually matters -- a refused quote.
  IF v_service_role_key IS NULL OR v_service_role_key = ''
     OR v_edge_function_url IS NULL OR v_edge_function_url = '' THEN
    RAISE WARNING
      'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PROJECT_URL missing from vault.decrypted_secrets. Skipping FX snapshot.';
    RETURN;
  END IF;

  v_edge_function_url := rtrim(v_edge_function_url, '/') || '/functions/v1/fx-snapshot';

  SELECT net.http_post(
      url     := v_edge_function_url,
      headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_role_key
      ),
      body    := '{}'::jsonb
  ) INTO v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_fx_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_fx_snapshot() TO service_role;

-- ---------------------------------------------------------------------------
-- Schedule it.
--
-- Unscheduled first so re-applying this migration does not leave two jobs
-- racing each other and burning double the quota.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('kithly-fx-snapshot')
  FROM cron.job WHERE jobname = 'kithly-fx-snapshot';

SELECT cron.schedule(
  'kithly-fx-snapshot',
  '7 * * * *',   -- seven minutes past the hour, off the crowded top of the hour
  $$SELECT public.trigger_fx_snapshot()$$
);

-- ---------------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_jobs INT;
BEGIN
  SELECT count(*) INTO v_jobs FROM cron.job WHERE jobname = 'kithly-fx-snapshot';

  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 kithly-fx-snapshot cron job, found %', v_jobs;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'trigger_fx_snapshot'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'trigger_fx_snapshot is reachable by anon or authenticated';
  END IF;

  RAISE NOTICE 'fx snapshot scheduled hourly at :07, service_role only';
END $$;
