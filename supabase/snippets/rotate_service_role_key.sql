-- =============================================================================
-- Service-role key rotation — the database half
--
-- Run this in the Supabase SQL editor AFTER rotating the key in the dashboard,
-- in the same sitting. It is a snippet rather than a migration on purpose:
-- migrations are sequential, immutable and replayed from empty in CI, and a
-- secret must never be committed into one.
--
-- WHY THIS IS NEEDED AT ALL
-- -------------------------
-- Three scheduled jobs authenticate to their edge functions with a key read
-- from Vault, not from an environment variable:
--
--   * the FX snapshot          (20260809100000)
--   * the batch payout sweeper (20260729010000)
--   * the WhatsApp expiry dispatcher (20260729020000)
--
-- Each of them handles a missing or stale secret by raising a WARNING and
-- returning. That is the right behaviour for a scheduled job -- it must not
-- take the database down -- but it means a rotation that stops at the
-- dashboard leaves FX rates going stale and payouts unswept with nothing in
-- the app to show for it. This closes that gap.
--
-- HOW TO USE
-- ----------
-- Replace PASTE_NEW_SERVICE_ROLE_KEY_HERE below, run the whole file, and read
-- the notices. Then run section 3 on its own to confirm.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Update the stored secret
--
--    Updated in place rather than deleted and recreated: the readers look the
--    secret up by name, and two rows sharing that name would have them pick
--    one arbitrarily -- which fails intermittently, the worst way to fail.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_new_key CONSTANT text := 'PASTE_NEW_SERVICE_ROLE_KEY_HERE';
  v_id      uuid;
  v_count   integer;
BEGIN
  IF v_new_key = 'PASTE_NEW_SERVICE_ROLE_KEY_HERE' OR btrim(v_new_key) = '' THEN
    RAISE EXCEPTION 'Paste the new service-role key into this script first.';
  END IF;

  SELECT count(*) INTO v_count
    FROM vault.secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'There are % secrets named SUPABASE_SERVICE_ROLE_KEY. Delete the extras first, or the schedulers will read one at random.',
      v_count;
  END IF;

  IF v_count = 0 THEN
    PERFORM vault.create_secret(
      v_new_key,
      'SUPABASE_SERVICE_ROLE_KEY',
      'Used by pg_cron jobs to authenticate to edge functions.'
    );
    RAISE NOTICE 'Vault: secret created.';
  ELSE
    SELECT id INTO v_id FROM vault.secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';
    PERFORM vault.update_secret(v_id, v_new_key);
    RAISE NOTICE 'Vault: secret updated in place.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Prove the new value is readable and is actually the new one
--
--    Never select the secret itself into a result grid -- query results get
--    cached, screenshotted and pasted into chats. Length and last four
--    characters are enough to tell the new key from the old one.
-- ---------------------------------------------------------------------------
SELECT
  name,
  length(decrypted_secret)                    AS key_length,
  right(decrypted_secret, 4)                  AS ends_with,
  updated_at
FROM vault.decrypted_secrets
WHERE name IN ('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_PROJECT_URL')
ORDER BY name;

-- ---------------------------------------------------------------------------
-- 3. Ask the scheduler whether it is happy
--
--    Installed by 20260809110000. Reports whether Vault is readable, whether
--    both secrets are present, and whether pg_cron and pg_net are available.
--    Every flag should come back true.
-- ---------------------------------------------------------------------------
SELECT jsonb_pretty(public.scheduler_prerequisites()) AS scheduler_health;

-- ---------------------------------------------------------------------------
-- 4. Watch the next run actually succeed
--
--    The real proof is a job completing after the rotation, not a flag. Run
--    this a few minutes after the next scheduled tick; `status` should read
--    'succeeded' and the timestamp should be after you rotated.
-- ---------------------------------------------------------------------------
SELECT
  j.jobname,
  r.status,
  r.start_time,
  r.end_time,
  left(coalesce(r.return_message, ''), 180) AS message
FROM cron.job_run_details r
JOIN cron.job j ON j.jobid = r.jobid
WHERE r.start_time > now() - interval '2 hours'
ORDER BY r.start_time DESC
LIMIT 20;
