-- =============================================================================
-- Rate limiting and failed-attempt recording on voucher redemption
--
-- THE GAP
-- -------
-- There is no rate limiting anywhere in this system, and redemption is the one
-- endpoint where that matters: a claim code is a bearer instrument, and the
-- whole-order `public_code` is only six symbols from a 36-symbol alphabet --
-- about 2.2 billion combinations. That survives a casual guess and does not
-- survive a script with an authenticated merchant account behind it.
--
-- Worse than the guessing is the blindness. Nothing records a failed
-- redemption. Repeated failures against a shop, or repeated attempts at one
-- code from different tills, are the clearest fraud signals this platform will
-- ever produce, and until now they left no trace at all -- successes were
-- written to transaction_events and failures evaporated.
--
-- TWO WINDOWS, BECAUSE THEY CATCH DIFFERENT ATTACKS
-- -------------------------------------------------
-- Per actor: one merchant account making many failed attempts is someone
--   enumerating codes. Default 10 failures in 15 minutes.
-- Per code:  many actors converging on one code is a leaked or shared code
--   being raced -- a recipient's WhatsApp message forwarded, say. Default 5
--   failures in 60 minutes.
--
-- Either limit alone is trivially evaded: a per-actor limit does not stop a
-- ring of merchant accounts, and a per-code limit does not stop enumeration.
--
-- WHAT THIS IS NOT
-- ----------------
-- Not a lockout of the merchant's account, and not a hold on anyone's money.
-- It refuses further *redemption attempts* for a cooling-off period and says
-- when to retry. A shopkeeper who fat-fingers a code four times is not locked
-- out of their till; the thresholds are set well above honest mistyping.
--
-- Enforcement is in the Edge Functions, which is the only place both entry
-- points (the app's fulfill-voucher and ussd-gateway) pass through. It is not
-- in the money RPCs: those are service-role only and already atomic, and
-- putting a time-window check inside a transaction that holds a row lock is
-- how you turn a rate limiter into a queue.
--
-- BLAST RADIUS 🟡
-- ---------------
-- Additive. New table, four new settings columns with defaults, two new
-- service-role functions. Nothing existing is redefined. If the Edge Functions
-- are deployed without these, they fall back to allowing the attempt (see
-- their call sites) -- fail-open is deliberate here, because a redemption
-- refused by a broken rate limiter is a customer standing at a counter with a
-- gift they cannot collect.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The attempt log
--
-- Failures only. Successes are already in transaction_events with the full
-- audit payload, and mixing them here would make "how many failures" a filter
-- rather than a count -- on the hot path of every redemption.
--
-- The attempted code is stored in full. It is normally a guess or a typo
-- rather than a live credential, the per-code window cannot work without
-- correlating on it, and the table is unreadable to anyone but admins and the
-- service role. This is the same call 20260807060000 made for
-- transaction_events, and for the same reason: the audit trail is
-- access-controlled, the logs are not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.redemption_attempts (
  attempt_id     BIGSERIAL PRIMARY KEY,
  attempted_code TEXT        NOT NULL,
  shop_id        UUID        REFERENCES public.shops(id) ON DELETE SET NULL,
  actor_user_id  UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  channel        TEXT        NOT NULL CHECK (channel IN ('app', 'ussd')),
  failure_reason TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.redemption_attempts IS
  'Append-only log of FAILED voucher redemption attempts. Feeds the per-actor '
  'and per-code rate limits and is the fraud signal for code enumeration. '
  'Successes live in transaction_events.';

-- Both indexes are partial on a recent window rather than covering all of
-- history: the limiter only ever reads the trailing hour or so, and an index
-- over every failure ever recorded would keep growing for no reader. They are
-- ordinary composite indexes because `now()` is not immutable and cannot
-- appear in a partial index predicate.
CREATE INDEX IF NOT EXISTS redemption_attempts_actor_idx
  ON public.redemption_attempts (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS redemption_attempts_code_idx
  ON public.redemption_attempts (attempted_code, created_at DESC);

ALTER TABLE public.redemption_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS redemption_attempts_admin_read ON public.redemption_attempts;
CREATE POLICY redemption_attempts_admin_read ON public.redemption_attempts
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

-- No-rewrite, where the shared trigger exists. enforce_immutable_ledger() is
-- attached by five migrations but defined in none of them (it predates the
-- tracked history and lives only in the deployed database), so this is guarded
-- rather than assumed -- scripts/sql-test.sh runs on a bare cluster that has
-- never seen it.
--
-- UPDATE only, unlike the five financial ledgers that use the same trigger for
-- UPDATE OR DELETE. This is an operational security log, not a book of record:
-- it accumulates a row per failed attempt forever and therefore needs a
-- retention story, and a trigger that forbids DELETE forbids pruning too.
-- Rewriting history is the thing worth preventing here; ageing it out is
-- housekeeping. Only admins and the service role can reach the table at all.
--
-- Retention is not automated yet. When the table gets large, the right move is
-- a pg_cron job deleting rows older than the widest window -- the limiter only
-- ever reads the trailing hour.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enforce_immutable_ledger'
  ) THEN
    DROP TRIGGER IF EXISTS redemption_attempts_immutable ON public.redemption_attempts;
    CREATE TRIGGER redemption_attempts_immutable
      BEFORE UPDATE ON public.redemption_attempts
      FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();
  ELSE
    RAISE NOTICE 'enforce_immutable_ledger() absent; redemption_attempts is append-only by convention only here.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Thresholds live in platform_settings, like every other tunable
--
-- Deliberately generous. The point is to stop a script, not to punish a
-- shopkeeper squinting at a handwritten code in bad light.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS redemption_max_failures_per_actor INTEGER NOT NULL DEFAULT 10;
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS redemption_actor_window_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS redemption_max_failures_per_code INTEGER NOT NULL DEFAULT 5;
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS redemption_code_window_minutes INTEGER NOT NULL DEFAULT 60;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_redemption_limits_check'
  ) THEN
    ALTER TABLE public.platform_settings
      ADD CONSTRAINT platform_settings_redemption_limits_check CHECK (
        redemption_max_failures_per_actor >= 1
        AND redemption_actor_window_minutes >= 1
        AND redemption_max_failures_per_code >= 1
        AND redemption_code_window_minutes >= 1
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. check_redemption_rate_limit — read-only, called before an attempt
--
-- Returns, rather than raises, so the caller can shape the message the
-- shopkeeper actually sees. `retry_after_seconds` is computed from the oldest
-- failure still inside the window, which is the moment the count drops below
-- the threshold -- a fixed cooldown would either over- or under-block.
--
-- A NULL actor (an unauthenticated or unresolved caller) skips the per-actor
-- window. It cannot be attributed, so counting it would let one bad actor
-- exhaust the budget of every anonymous caller at once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_redemption_rate_limit(
  p_code          TEXT,
  p_shop_id       UUID DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code            TEXT := upper(btrim(COALESCE(p_code, '')));
  v_max_actor       INTEGER;
  v_win_actor       INTEGER;
  v_max_code        INTEGER;
  v_win_code        INTEGER;
  v_count           INTEGER;
  v_oldest          TIMESTAMPTZ;
  v_retry           INTEGER;
BEGIN
  SELECT redemption_max_failures_per_actor, redemption_actor_window_minutes,
         redemption_max_failures_per_code,  redemption_code_window_minutes
    INTO v_max_actor, v_win_actor, v_max_code, v_win_code
  FROM public.platform_settings WHERE id = 1;

  -- No settings row is not a reason to stop a legitimate redemption.
  IF v_max_actor IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'retry_after_seconds', 0);
  END IF;

  -- Per actor.
  IF p_actor_user_id IS NOT NULL THEN
    SELECT count(*), min(created_at) INTO v_count, v_oldest
    FROM public.redemption_attempts
    WHERE actor_user_id = p_actor_user_id
      AND created_at > now() - make_interval(mins => v_win_actor);

    IF v_count >= v_max_actor THEN
      v_retry := GREATEST(
        1,
        ceil(extract(epoch FROM (v_oldest + make_interval(mins => v_win_actor)) - now()))::INTEGER
      );
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'too_many_attempts',
        'retry_after_seconds', v_retry
      );
    END IF;
  END IF;

  -- Per code.
  IF v_code <> '' THEN
    SELECT count(*), min(created_at) INTO v_count, v_oldest
    FROM public.redemption_attempts
    WHERE attempted_code = v_code
      AND created_at > now() - make_interval(mins => v_win_code);

    IF v_count >= v_max_code THEN
      v_retry := GREATEST(
        1,
        ceil(extract(epoch FROM (v_oldest + make_interval(mins => v_win_code)) - now()))::INTEGER
      );
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'code_locked',
        'retry_after_seconds', v_retry
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'retry_after_seconds', 0);
END;
$$;

COMMENT ON FUNCTION public.check_redemption_rate_limit(TEXT, UUID, UUID) IS
  'Read-only pre-check for voucher redemption. Returns '
  '{allowed, reason, retry_after_seconds}. Never raises: the caller decides '
  'how to present a refusal.';

-- ---------------------------------------------------------------------------
-- 4. record_redemption_failure — called after an attempt fails
--
-- Separate from the check so a caller cannot accidentally count its own
-- pre-check as an attempt, and so a failure is recorded exactly once at the
-- point the outcome is actually known.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_redemption_failure(
  p_code          TEXT,
  p_shop_id       UUID DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL,
  p_channel       TEXT DEFAULT 'app',
  p_reason        TEXT DEFAULT 'unknown'
)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.redemption_attempts
    (attempted_code, shop_id, actor_user_id, channel, failure_reason)
  VALUES (
    upper(btrim(COALESCE(p_code, ''))),
    p_shop_id,
    p_actor_user_id,
    CASE WHEN p_channel IN ('app', 'ussd') THEN p_channel ELSE 'app' END,
    left(COALESCE(p_reason, 'unknown'), 200)
  );
END;
$$;

COMMENT ON FUNCTION public.record_redemption_failure(TEXT, UUID, UUID, TEXT, TEXT) IS
  'Appends one failed redemption attempt. Failures only — successes are '
  'recorded in transaction_events.';

-- ---------------------------------------------------------------------------
-- 5. Privileges: service role only, matching every other money-path function.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.check_redemption_rate_limit(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_redemption_failure(TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC;

DO $$
DECLARE
  v_role TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.check_redemption_rate_limit(TEXT, UUID, UUID) FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.record_redemption_failure(TEXT, UUID, UUID, TEXT, TEXT) FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON TABLE public.redemption_attempts FROM %I', v_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    -- The admin read policy needs the table-level SELECT to be reachable
    -- before RLS is consulted; RLS then narrows it to admins.
    EXECUTE 'GRANT SELECT ON TABLE public.redemption_attempts TO authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.check_redemption_rate_limit(TEXT, UUID, UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_redemption_failure(TEXT, UUID, UUID, TEXT, TEXT) TO service_role';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.redemption_attempts TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.redemption_attempts_attempt_id_seq TO service_role';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Prove the limiter actually limits, then leave no test rows behind.
--
-- A rate limiter that has never been shown to refuse anything is decoration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_max   INTEGER;
  v_res   JSONB;
  i       INTEGER;
  v_code  TEXT := 'ZZTEST99';
BEGIN
  SELECT redemption_max_failures_per_code INTO v_max
  FROM public.platform_settings WHERE id = 1;

  IF v_max IS NULL THEN
    RAISE NOTICE 'No platform_settings row; skipping rate-limit self-test.';
    RETURN;
  END IF;

  -- Clean state, unattributed so the per-actor window is not involved.
  DELETE FROM public.redemption_attempts WHERE attempted_code = v_code;

  v_res := public.check_redemption_rate_limit(v_code, NULL, NULL);
  IF (v_res->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Fresh code was refused before any failure: %', v_res;
  END IF;

  FOR i IN 1..v_max LOOP
    PERFORM public.record_redemption_failure(v_code, NULL, NULL, 'app', 'self-test');
  END LOOP;

  v_res := public.check_redemption_rate_limit(v_code, NULL, NULL);
  IF (v_res->>'allowed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Code was still allowed after % failures: %', v_max, v_res;
  END IF;
  IF v_res->>'reason' <> 'code_locked' THEN
    RAISE EXCEPTION 'Expected reason code_locked, got %', v_res->>'reason';
  END IF;
  IF (v_res->>'retry_after_seconds')::integer < 1 THEN
    RAISE EXCEPTION 'retry_after_seconds must be positive while locked, got %', v_res->>'retry_after_seconds';
  END IF;

  -- An unrelated code is unaffected: the limit is per code, not global.
  v_res := public.check_redemption_rate_limit('ZZTEST00', NULL, NULL);
  IF (v_res->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Per-code limit leaked onto an unrelated code: %', v_res;
  END IF;

  DELETE FROM public.redemption_attempts WHERE attempted_code IN (v_code, 'ZZTEST00');

  RAISE NOTICE 'redemption rate limit: refuses after % failures on one code, leaves others alone.', v_max;
END;
$$;
