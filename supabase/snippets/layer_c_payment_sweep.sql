-- =============================================================================
-- KithLy Payment Defense Flow — Layer C
-- Background Payment Sweep Daemon (pg_cron + pg_net)
--
-- Purpose:
--   Automatically detect and heal checkout sessions where the Flutterwave
--   webhook (Layer A) and the frontend polling hook (Layer B) both failed to
--   confirm payment. This daemon runs every 15 minutes and performs two phases:
--
--   PHASE 1 — Response Harvesting
--     Reads the net._http_response table for any Flutterwave verification
--     responses that were initiated by a previous sweep cycle. For each
--     successful response, it promotes the voucher and writes a ledger event.
--
--   PHASE 2 — Request Initiation
--     Identifies claim_vouchers that are still UNFUNDED after 10+ minutes
--     and have not already had a sweep request fired for them in the last
--     15 minutes. Fires a new async pg_net.http_get for each.
--
-- Why two phases?
--   pg_net is fundamentally asynchronous — http_get() dispatches the request
--   to a background worker and immediately returns a request_id (BIGINT).
--   The HTTP response is written to net._http_response asynchronously, minutes
--   later. A single-phase function would fire and read responses in the same
--   tick, which means it would always read back empty (the request hasn't
--   completed yet). The two-phase design solves this correctly.
--
-- Execution order per 15-minute cron tick:
--   [tick N]   Phase 1 harvests responses from tick N-1.
--              Phase 2 fires new requests for newly-hanging vouchers.
--   [tick N+1] Phase 1 harvests the responses from tick N's requests.
--              And so on.
--
-- Security:
--   The Flutterwave Secret Key is stored in Supabase Vault — never hardcoded.
--   See Step 0 for the vault.create_secret() call you must run once first.
--   The function is SECURITY DEFINER so pg_cron (which runs as the postgres
--   superuser) can execute it, but the function itself only touches the tables
--   it owns.
--
-- Run this entire script in your Supabase SQL Editor exactly once.
-- =============================================================================


-- =============================================================================
-- PREREQUISITE: Enable required extensions
-- =============================================================================

-- pg_cron: allows scheduling SQL functions on a cron schedule.
-- Requires the extension to be enabled in Supabase Dashboard → Database → Extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- pg_net: allows making async HTTP requests from within PostgreSQL.
-- Also enabled in Supabase Dashboard → Database → Extensions.
CREATE EXTENSION IF NOT EXISTS pg_net;


-- =============================================================================
-- STEP 0: Store the Flutterwave secret in Supabase Vault (run once manually)
-- =============================================================================
-- You must run this ONCE with your real secret before deploying this function.
-- After this, the secret is encrypted at rest and never appears in query logs.
--
-- Replace 'YOUR_FLUTTERWAVE_SECRET_KEY_HERE' with your actual secret.
-- The vault.create_secret() call is idempotent-safe — subsequent runs of this
-- migration can skip this block by checking for existence first.

DO $$
BEGIN
  -- Only insert if the secret does not already exist by this name.
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'FLUTTERWAVE_SECRET_KEY'
  ) THEN
    PERFORM vault.create_secret(
      'YOUR_FLUTTERWAVE_SECRET_KEY_HERE',  -- ← replace this value
      'FLUTTERWAVE_SECRET_KEY',
      'Flutterwave API secret key used by the Layer C payment sweep daemon'
    );
    RAISE NOTICE '[Layer C] Vault secret FLUTTERWAVE_SECRET_KEY created.';
  ELSE
    RAISE NOTICE '[Layer C] Vault secret FLUTTERWAVE_SECRET_KEY already exists — skipping.';
  END IF;
END;
$$;


-- =============================================================================
-- STEP 1: Create the claim_vouchers and transaction_events tables
--         if they don't exist yet (safe to re-run — uses IF NOT EXISTS)
-- =============================================================================

-- claim_vouchers: the central voucher lifecycle table.
-- If you have already created this table, this block is a no-op.
CREATE TABLE IF NOT EXISTS public.claim_vouchers (
  voucher_id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_uuid                UUID        NOT NULL REFERENCES auth.users(id),
  shop_id                   UUID        NOT NULL REFERENCES public.shops(id),
  item_id                   UUID        NOT NULL REFERENCES public.items(id),
  recipient_name            TEXT        NOT NULL,
  recipient_phone           TEXT        NOT NULL,
  origin_type               TEXT        NOT NULL CHECK (origin_type IN ('LOCAL', 'INTERNATIONAL')),
  claim_code                TEXT        NOT NULL UNIQUE,
  checkout_price            INTEGER     NOT NULL CHECK (checkout_price > 0),

  -- Redemption lifecycle — owned by the merchant fulfillment flow.
  -- The sweep daemon NEVER touches this column.
  claim_status              TEXT        NOT NULL DEFAULT 'PENDING'
                              CHECK (claim_status IN ('PENDING', 'REDEEMED', 'EXPIRED')),

  -- Payment lifecycle — owned by the payment defense layers.
  payout_status             TEXT        NOT NULL DEFAULT 'UNFUNDED'
                              CHECK (payout_status IN ('UNFUNDED', 'PENDING_BATCH', 'SETTLED')),

  -- Flutterwave references — populated when payment is confirmed.
  flutterwave_transaction_id TEXT,
  flw_ref                   TEXT,
  funded_at                 TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- transaction_events: immutable append-only audit ledger.
-- Every payment-related event is written here, regardless of outcome.
CREATE TABLE IF NOT EXISTS public.transaction_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   UUID        NOT NULL REFERENCES public.claim_vouchers(voucher_id),
  event_type   TEXT        NOT NULL,
  payload      TEXT,         -- Raw JSON string from the event source
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance indexes for the sweep daemon's two query patterns.
CREATE INDEX IF NOT EXISTS idx_claim_vouchers_payout_status_created_at
  ON public.claim_vouchers (payout_status, created_at)
  WHERE payout_status = 'UNFUNDED';

CREATE INDEX IF NOT EXISTS idx_transaction_events_voucher_event_type
  ON public.transaction_events (voucher_id, event_type);

CREATE INDEX IF NOT EXISTS idx_transaction_events_event_type_created_at
  ON public.transaction_events (event_type, created_at)
  WHERE event_type = 'POLLING_SYNC_INITIATED';


-- =============================================================================
-- STEP 2: Create the sweep function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sweep_hanging_payments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- Set a safe search_path to prevent search_path injection attacks.
SET search_path = public, net, vault
AS $$
DECLARE
  -- Shared
  v_flw_secret            TEXT;
  v_now                   TIMESTAMPTZ := now();

  -- Phase 1 loop variables
  v_initiated_rec         RECORD;
  v_response_status_code  INTEGER;
  v_response_body         TEXT;
  v_response_timed_out    BOOLEAN;
  v_response_error        TEXT;
  v_flw_json              JSONB;
  v_flw_top_status        TEXT;
  v_flw_data_status       TEXT;
  v_flw_txn_id            TEXT;
  v_flw_ref               TEXT;

  -- Phase 2 loop variables
  v_hanging_rec           RECORD;
  v_request_id            BIGINT;
  v_phase2_count          INTEGER := 0;
  v_phase1_processed      INTEGER := 0;

BEGIN
  RAISE LOG '[sweep_hanging_payments] ===== SWEEP CYCLE START @ % =====', v_now;

  -- -------------------------------------------------------------------------
  -- Read the Flutterwave secret from Supabase Vault.
  -- This is the ONLY place the secret is accessed — it never appears in
  -- application logs, pg_stat_activity, or query plans.
  -- -------------------------------------------------------------------------
  SELECT decrypted_secret
    INTO v_flw_secret
    FROM vault.decrypted_secrets
   WHERE name = 'FLUTTERWAVE_SECRET_KEY'
   LIMIT 1;

  IF v_flw_secret IS NULL OR v_flw_secret = '' THEN
    RAISE WARNING '[sweep_hanging_payments] CRITICAL: Vault secret FLUTTERWAVE_SECRET_KEY is missing or empty. '
                  'Aborting sweep — no requests will be fired and no responses will be processed.';
    RETURN;
  END IF;

  -- =========================================================================
  -- PHASE 1 — Response Harvesting
  --
  -- Find all POLLING_SYNC_INITIATED events that do NOT yet have a
  -- corresponding terminal event (SUCCESS or FAILED). For each one, check
  -- net._http_response to see if the async HTTP call has completed.
  -- =========================================================================
  RAISE LOG '[sweep_hanging_payments] --- Phase 1: Harvesting async responses ---';

  FOR v_initiated_rec IN
    SELECT
      te.id              AS event_id,
      te.voucher_id,
      te.created_at      AS initiated_at,
      -- The request_id stored in the payload was written as a JSONB object:
      -- {"request_id": 12345}. We cast it back to BIGINT for the lookup.
      (te.payload::jsonb ->> 'request_id')::bigint AS pg_net_request_id
    FROM
      public.transaction_events te
    WHERE
      te.event_type = 'POLLING_SYNC_INITIATED'
      -- Only look at initiations from the last 2 hours to avoid scanning
      -- stale rows that will never have a response (request expired).
      AND te.created_at > v_now - INTERVAL '2 hours'
      -- Exclude vouchers that already have a terminal event from a previous
      -- successful harvest — prevents double-processing on slow responses.
      AND NOT EXISTS (
        SELECT 1
          FROM public.transaction_events te2
         WHERE te2.voucher_id  = te.voucher_id
           AND te2.event_type  IN ('POLLING_SYNC_SUCCESS', 'POLLING_SYNC_FAILED')
           AND te2.created_at  > te.created_at
      )
    ORDER BY
      te.created_at ASC
  LOOP
    -- Check net._http_response for a completed response for this request_id.
    -- If the row doesn't exist yet, the HTTP call is still in flight — skip it.
    SELECT
      status_code,
      body,
      timed_out,
      error_msg
    INTO
      v_response_status_code,
      v_response_body,
      v_response_timed_out,
      v_response_error
    FROM
      net._http_response
    WHERE
      id = v_initiated_rec.pg_net_request_id;

    -- No row yet → request still pending; will be picked up by the next tick.
    IF NOT FOUND THEN
      RAISE LOG '[sweep_hanging_payments] Phase 1: Request % for voucher % not yet complete — skipping.',
        v_initiated_rec.pg_net_request_id,
        v_initiated_rec.voucher_id;
      CONTINUE;
    END IF;

    v_phase1_processed := v_phase1_processed + 1;

    -- ----- Timed-out or transport error -----
    IF v_response_timed_out OR v_response_error IS NOT NULL THEN
      RAISE WARNING '[sweep_hanging_payments] Phase 1: Request % for voucher % failed — timed_out=%, error=%',
        v_initiated_rec.pg_net_request_id,
        v_initiated_rec.voucher_id,
        v_response_timed_out,
        v_response_error;

      -- Write a non-terminal POLLING_SYNC_FAILED event so Phase 2 of the
      -- NEXT sweep can re-fire a new request for this voucher.
      INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.voucher_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',     COALESCE(v_response_error, 'request_timeout'),
          'timed_out',  v_response_timed_out,
          'request_id', v_initiated_rec.pg_net_request_id
        )::text,
        v_now
      );
      CONTINUE;
    END IF;

    -- ----- Parse the Flutterwave response body -----
    BEGIN
      v_flw_json := v_response_body::jsonb;
    EXCEPTION WHEN others THEN
      RAISE WARNING '[sweep_hanging_payments] Phase 1: Response body for request % is not valid JSON: %',
        v_initiated_rec.pg_net_request_id,
        left(v_response_body, 200);

      INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.voucher_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',      'invalid_json_response',
          'http_status', v_response_status_code,
          'body_prefix', left(v_response_body, 500),
          'request_id',  v_initiated_rec.pg_net_request_id
        )::text,
        v_now
      );
      CONTINUE;
    END;

    -- Extract the two status fields we care about:
    --   .status       → "success" (Flutterwave API envelope status)
    --   .data.status  → "successful" (the actual transaction outcome)
    v_flw_top_status  := v_flw_json ->> 'status';
    v_flw_data_status := v_flw_json -> 'data' ->> 'status';
    v_flw_txn_id      := (v_flw_json -> 'data' ->> 'id');
    v_flw_ref         := v_flw_json -> 'data' ->> 'flw_ref';

    RAISE LOG '[sweep_hanging_payments] Phase 1: voucher=% | http_status=% | flw_status=% | data_status=%',
      v_initiated_rec.voucher_id,
      v_response_status_code,
      v_flw_top_status,
      v_flw_data_status;

    -- ----- SUCCESS: Flutterwave confirmed payment -----
    IF v_response_status_code = 200
       AND v_flw_top_status  = 'success'
       AND v_flw_data_status = 'successful'
    THEN
      -- Immutable ledger: record the sweep confirmation event.
      -- Storing the full raw response body preserves the complete audit trail.
      INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.voucher_id,
        'POLLING_SYNC_SUCCESS',
        v_response_body,   -- Full Flutterwave JSON string
        v_now
      );

      -- Promote payout_status from UNFUNDED → PENDING_BATCH.
      --
      -- The WHERE payout_status = 'UNFUNDED' filter makes this idempotent:
      -- if the webhook (Layer A) already promoted this row, this UPDATE
      -- matches zero rows and is a safe no-op — no regression possible.
      --
      -- claim_status is deliberately NOT touched here.
      -- That column belongs to the merchant redemption flow.
      UPDATE public.claim_vouchers
         SET
           payout_status             = 'PENDING_BATCH',
           flutterwave_transaction_id = v_flw_txn_id,
           flw_ref                   = v_flw_ref,
           funded_at                 = v_now
       WHERE
           voucher_id   = v_initiated_rec.voucher_id
           AND payout_status = 'UNFUNDED';   -- Idempotency guard

      RAISE LOG '[sweep_hanging_payments] Phase 1: voucher % CONFIRMED and promoted to PENDING_BATCH.',
        v_initiated_rec.voucher_id;

    -- ----- NOT PAID: Flutterwave says the transaction is not successful -----
    ELSE
      INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.voucher_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',      'payment_not_confirmed',
          'http_status', v_response_status_code,
          'flw_status',  v_flw_top_status,
          'data_status', v_flw_data_status,
          'request_id',  v_initiated_rec.pg_net_request_id
        )::text,
        v_now
      );

      RAISE LOG '[sweep_hanging_payments] Phase 1: voucher % not paid per Flutterwave (flw_status=%, data_status=%).',
        v_initiated_rec.voucher_id,
        v_flw_top_status,
        v_flw_data_status;
    END IF;

  END LOOP;

  RAISE LOG '[sweep_hanging_payments] Phase 1 complete: % response(s) processed.', v_phase1_processed;


  -- =========================================================================
  -- PHASE 2 — Request Initiation
  --
  -- Find all claim_vouchers that are:
  --   1. Still UNFUNDED (not yet confirmed by webhook or a previous sweep)
  --   2. Older than 10 minutes (give the webhook enough time to arrive first)
  --   3. Not already under an active sweep request from the last 15 minutes
  --      (prevents firing duplicate requests for the same voucher per cycle)
  --
  -- For each match, fire an async pg_net.http_get to the Flutterwave
  -- transaction verification API and store the returned request_id in the
  -- transaction_events ledger so Phase 1 of the next tick can harvest it.
  -- =========================================================================
  RAISE LOG '[sweep_hanging_payments] --- Phase 2: Firing verification requests ---';

  FOR v_hanging_rec IN
    SELECT
      cv.voucher_id
    FROM
      public.claim_vouchers cv
    WHERE
      cv.payout_status = 'UNFUNDED'
      -- Must be older than 10 minutes to give Layer A (webhook) and Layer B
      -- (frontend polling) a fair window to succeed before we intervene.
      AND cv.created_at < v_now - INTERVAL '10 minutes'
      -- Don't re-fire if we already sent a sweep request within the last
      -- 15 minutes. This prevents multiple in-flight requests for the same
      -- voucher in a single cycle (one request per sweep cycle is enough).
      AND NOT EXISTS (
        SELECT 1
          FROM public.transaction_events te
         WHERE te.voucher_id = cv.voucher_id
           AND te.event_type = 'POLLING_SYNC_INITIATED'
           AND te.created_at > v_now - INTERVAL '15 minutes'
      )
    ORDER BY
      cv.created_at ASC   -- Process oldest-hanging vouchers first
  LOOP
    -- Fire the async HTTP GET to Flutterwave's verify-by-reference endpoint.
    -- The tx_ref we originally passed to Flutterwave was the voucher_id itself
    -- (set in checkout-init), so we use it directly here.
    --
    -- pg_net.http_get() returns a BIGINT request_id immediately.
    -- The actual HTTP call happens in a background worker.
    -- The response is written to net._http_response when it completes.
    SELECT net.http_get(
      url     => format(
                   'https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=%s',
                   v_hanging_rec.voucher_id
                 ),
      headers => jsonb_build_object(
                   'Authorization', 'Bearer ' || v_flw_secret,
                   'Content-Type',  'application/json'
                 )
    ) INTO v_request_id;

    -- Persist the request_id in the ledger so Phase 1 of the next cycle
    -- can look it up in net._http_response.
    INSERT INTO public.transaction_events (voucher_id, event_type, payload, created_at)
    VALUES (
      v_hanging_rec.voucher_id,
      'POLLING_SYNC_INITIATED',
      jsonb_build_object(
        'request_id',  v_request_id,
        'initiated_at', v_now
      )::text,
      v_now
    );

    v_phase2_count := v_phase2_count + 1;

    RAISE LOG '[sweep_hanging_payments] Phase 2: Fired request_id=% for voucher=%.',
      v_request_id,
      v_hanging_rec.voucher_id;

  END LOOP;

  RAISE LOG '[sweep_hanging_payments] Phase 2 complete: % request(s) fired.', v_phase2_count;
  RAISE LOG '[sweep_hanging_payments] ===== SWEEP CYCLE END @ % =====', clock_timestamp();

END;
$$;


-- =============================================================================
-- STEP 3: Grant execution rights
-- =============================================================================

-- Allow pg_cron's background worker (which runs as the postgres role) to call
-- this function. The SECURITY DEFINER attribute ensures the function itself
-- always executes with the privileges of its owner (postgres), not the caller.
GRANT EXECUTE ON FUNCTION public.sweep_hanging_payments() TO postgres;


-- =============================================================================
-- STEP 4: Schedule the cron job
-- =============================================================================

-- Remove any previously registered version of this job before (re-)creating it.
-- This makes the migration idempotent — safe to run multiple times.
SELECT cron.unschedule('kithly-sweep-hanging-payments')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'kithly-sweep-hanging-payments'
  );

-- Register the 15-minute sweep.
-- Cron expression: '*/15 * * * *' → fires at :00, :15, :30, :45 of every hour.
SELECT cron.schedule(
  'kithly-sweep-hanging-payments',   -- Unique job name (used by unschedule above)
  '*/15 * * * *',                    -- Every 15 minutes
  'SELECT public.sweep_hanging_payments();'
);


-- =============================================================================
-- STEP 5: Verify the job was registered correctly
-- =============================================================================

-- Run this SELECT to confirm the job appears in the cron registry.
-- Expected output: one row with jobname='kithly-sweep-hanging-payments',
--                  schedule='*/15 * * * *', active=true.
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
  jobname = 'kithly-sweep-hanging-payments';
