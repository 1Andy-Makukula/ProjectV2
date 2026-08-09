-- =============================================================================
-- Can the scheduled jobs actually reach their Edge Functions?
--
-- WHY
-- ---
-- Every scheduled job in this system follows the same shape: pg_cron calls a
-- SECURITY DEFINER function, which reads SUPABASE_PROJECT_URL and
-- SUPABASE_SERVICE_ROLE_KEY out of Vault and POSTs to an Edge Function. That is
-- true of trigger_daily_payout_sweeper and now trigger_fx_snapshot.
--
-- All of them handle a missing secret the same way: RAISE WARNING and return.
-- That is the right call inside a cron job -- an exception there is noise in a
-- log nobody reads -- but it means the entire scheduled layer can be silently
-- inert. Nothing fails, nothing alerts, work simply never happens. Merchant
-- payouts would sit unpaid and the only symptom is an absence.
--
-- This was found while testing the FX snapshot: invoking the Edge Function
-- directly stored a snapshot, but going through trigger_fx_snapshot() stored
-- nothing, with no error surfaced anywhere.
--
-- Returns presence only. Never the values.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.scheduler_prerequisites()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'vault', 'cron'
AS $$
DECLARE
  v_has_url  BOOLEAN := FALSE;
  v_has_key  BOOLEAN := FALSE;
  v_jobs     JSONB;
BEGIN
  -- Vault access itself can fail depending on how the project is provisioned,
  -- which is a different diagnosis from "the secret is absent" and must not be
  -- reported as the same thing.
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_PROJECT_URL' AND coalesce(decrypted_secret, '') <> ''
    ) INTO v_has_url;

    SELECT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' AND coalesce(decrypted_secret, '') <> ''
    ) INTO v_has_key;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object(
      'vault_readable', false,
      'error', SQLERRM,
      'note', 'Vault could not be read at all, so secret presence is unknown.'
    );
  END;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'jobname', jobname, 'schedule', schedule, 'active', active
         ) ORDER BY jobname), '[]'::jsonb)
    INTO v_jobs
  FROM cron.job;

  RETURN jsonb_build_object(
    'vault_readable', true,
    'has_project_url', v_has_url,
    'has_service_role_key', v_has_key,
    -- The single question this exists to answer.
    'schedulers_can_dispatch', (v_has_url AND v_has_key),
    'cron_jobs', v_jobs
  );
END;
$$;

COMMENT ON FUNCTION public.scheduler_prerequisites() IS
  'Reports whether pg_cron jobs can reach their Edge Functions -- i.e. whether '
  'SUPABASE_PROJECT_URL and SUPABASE_SERVICE_ROLE_KEY are present in Vault. '
  'Every trigger_* function warns and returns when they are missing, so the '
  'whole scheduled layer can be inert with no error anywhere. Presence only, '
  'never values.';

REVOKE ALL ON FUNCTION public.scheduler_prerequisites() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scheduler_prerequisites() TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'scheduler_prerequisites'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'scheduler_prerequisites is reachable by anon or authenticated';
  END IF;
  RAISE NOTICE 'scheduler_prerequisites ready (presence only, service_role)';
END $$;
