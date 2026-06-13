-- =============================================================================
-- Migration: Harden & Remediate Data Layer (V2 Alignment)
-- Description: 
--  1. Remediates exposed master service role JWT secret.
--  2. Binds immutability triggers on payout_ledger and transaction_events.
--  3. Creates wallet_ledger schema and trigger-driven cache sync.
--  4. Removes V1 claim_vouchers table references from sweepers and overloads.
--  5. Hardens RLS on order_items and marketing_campaigns.
--  6. Deploys high-speed search indexes.
-- =============================================================================

-- 1. REMEDIATE EXPOSED MASTER SECRET (CRITICAL)
-- Drop hardcoded JWT service_role credentials and fetch dynamically from Vault
CREATE OR REPLACE FUNCTION public.trigger_daily_payout_sweeper() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'net', 'vault'
    AS $$
DECLARE
  edge_function_url text;
  service_role_key text;
  request_id bigint;
BEGIN
  -- Retrieve secret and URL from vault
  SELECT decrypted_secret INTO service_role_key
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
   LIMIT 1;

  SELECT decrypted_secret INTO edge_function_url
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_PROJECT_URL'
   LIMIT 1;

  IF service_role_key IS NULL OR service_role_key = '' OR edge_function_url IS NULL OR edge_function_url = '' THEN
    RAISE WARNING 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PROJECT_URL is missing in vault.decrypted_secrets. Skipping payout sweeper.';
    RETURN;
  END IF;

  edge_function_url := rtrim(edge_function_url, '/') || '/functions/v1/batch-payout-sweeper';

  -- Shoot the internal network payload to start the payout Edge Function
  SELECT net.http_post(
      url := edge_function_url,
      headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_role_key
      ),
      body := '{}'::jsonb
  ) INTO request_id;
END;
$$;

ALTER FUNCTION public.trigger_daily_payout_sweeper() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.trigger_payment_sweeper() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'net', 'vault'
    AS $$
DECLARE
  edge_function_url text;
  service_role_key text;
  request_id bigint;
BEGIN
  -- Retrieve secret and URL from vault
  SELECT decrypted_secret INTO service_role_key
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
   LIMIT 1;

  SELECT decrypted_secret INTO edge_function_url
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_PROJECT_URL'
   LIMIT 1;

  IF service_role_key IS NULL OR service_role_key = '' OR edge_function_url IS NULL OR edge_function_url = '' THEN
    RAISE WARNING 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PROJECT_URL is missing in vault.decrypted_secrets. Skipping payment sweeper.';
    RETURN;
  END IF;

  edge_function_url := rtrim(edge_function_url, '/') || '/functions/v1/sweep-hanging-payments';

  -- Perform an asynchronous HTTP POST to the Edge Function
  SELECT net.http_post(
      url := edge_function_url,
      headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_role_key
      ),
      body := '{}'::jsonb
  ) INTO request_id;
END;
$$;

ALTER FUNCTION public.trigger_payment_sweeper() OWNER TO postgres;


-- 2. BIND ORPHANED IMMUTABILITY TRIGGERS (HIGH)
-- Attach enforce_immutable_ledger to transaction_events and payout_ledger
DROP TRIGGER IF EXISTS enforce_immutable_transaction_events ON public.transaction_events;
CREATE TRIGGER enforce_immutable_transaction_events
BEFORE UPDATE OR DELETE ON public.transaction_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

DROP TRIGGER IF EXISTS enforce_immutable_payout_ledger ON public.payout_ledger;
CREATE TRIGGER enforce_immutable_payout_ledger
BEFORE UPDATE OR DELETE ON public.payout_ledger
FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();


-- 3. VERIFY AND HARDEN GHOST TABLES & OBSOLETE CLAUSES (HIGH)
-- Create wallet_ledger table matching V2 topology
CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.kithly_wallets(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  transaction_id UUID REFERENCES public.transactions(transaction_id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Secure wallet_ledger table with RLS
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_ledger_select ON public.wallet_ledger;
CREATE POLICY wallet_ledger_select ON public.wallet_ledger
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.kithly_wallets w
      WHERE w.id = wallet_ledger.wallet_id
        AND w.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- Attach immutability protection to wallet_ledger
DROP TRIGGER IF EXISTS enforce_immutable_wallet_ledger ON public.wallet_ledger;
CREATE TRIGGER enforce_immutable_wallet_ledger
BEFORE UPDATE OR DELETE ON public.wallet_ledger
FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

-- Trigger function to synchronize balance cache on kithly_wallets
CREATE OR REPLACE FUNCTION public.sync_wallet_balance_from_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.kithly_wallets
  SET balance = balance + NEW.amount,
      updated_at = now()
  WHERE id = NEW.wallet_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_wallet_balance ON public.wallet_ledger;
CREATE TRIGGER trg_sync_wallet_balance
AFTER INSERT ON public.wallet_ledger
FOR EACH ROW
EXECUTE FUNCTION public.sync_wallet_balance_from_ledger();

-- Rewrite increment_wallet_balance to resolve and persist transaction_id
CREATE OR REPLACE FUNCTION public.increment_wallet_balance(
  p_user_id UUID,
  p_amount INTEGER,
  p_reference TEXT DEFAULT NULL,
  p_shop_order_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_transaction_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN;
  END IF;

  -- 1. Ensure the wallet exists and get its ID
  INSERT INTO public.kithly_wallets (user_id, balance, currency)
  VALUES (p_user_id, 0, 'ZMW')
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_wallet_id;

  IF v_wallet_id IS NULL THEN
    SELECT id INTO v_wallet_id FROM public.kithly_wallets WHERE user_id = p_user_id;
  END IF;

  -- 2. Resolve transaction_id if shop_order_id is provided
  IF p_shop_order_id IS NOT NULL THEN
    SELECT transaction_id INTO v_transaction_id FROM public.shop_orders WHERE shop_order_id = p_shop_order_id;
  END IF;

  -- 3. Insert into the immutable ledger (Postgres trigger updates cache)
  INSERT INTO public.wallet_ledger (wallet_id, amount, transaction_id, description)
  VALUES (v_wallet_id, p_amount, v_transaction_id, COALESCE(p_reference, 'WALLET_CREDIT'));
END;
$$;

ALTER FUNCTION public.increment_wallet_balance(UUID, INTEGER, TEXT, UUID) OWNER TO postgres;

-- Drop obsolete V1 claim_vouchers atomic_fulfill_voucher overload
DROP FUNCTION IF EXISTS public.atomic_fulfill_voucher(character varying, uuid);

-- Rewrite sweep_hanging_payments to target V2 transactions and shop_orders
CREATE OR REPLACE FUNCTION public.sweep_hanging_payments() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'net', 'vault'
    AS $$
DECLARE
  v_flw_secret            text;
  v_now                   timestamptz := now();

  -- Phase 1 loop variables
  v_initiated_rec         record;
  v_response_status_code  integer;
  v_response_body         text;
  v_response_timed_out    boolean;
  v_response_error        text;
  v_flw_json              jsonb;
  v_flw_top_status        text;
  v_flw_data_status       text;
  v_flw_amount            numeric;

  -- Phase 2 loop variables
  v_hanging_rec           record;
  v_request_id            bigint;
  v_phase2_count          integer := 0;
  v_phase1_processed      integer := 0;

BEGIN
  RAISE LOG '[sweep_hanging_payments] ===== SWEEP CYCLE START @ % =====', v_now;

  -- 1. Read the Flutterwave secret from Supabase Vault
  SELECT decrypted_secret
    INTO v_flw_secret
    FROM vault.decrypted_secrets
   WHERE name = 'FLUTTERWAVE_SECRET_KEY'
   LIMIT 1;

  IF v_flw_secret IS NULL OR v_flw_secret = '' THEN
    RAISE WARNING '[sweep_hanging_payments] CRITICAL: Vault secret FLUTTERWAVE_SECRET_KEY is missing or empty. Aborting sweep.';
    RETURN;
  END IF;

  -- =========================================================================
  -- PHASE 1 — Response Harvesting
  -- =========================================================================
  RAISE LOG '[sweep_hanging_payments] --- Phase 1: Harvesting async responses ---';

  FOR v_initiated_rec IN
    SELECT
      te.id              AS event_id,
      te.transaction_id,
      te.created_at      AS initiated_at,
      (te.payload::jsonb ->> 'request_id')::bigint AS pg_net_request_id
    FROM
      public.transaction_events te
    WHERE
      te.event_type = 'POLLING_SYNC_INITIATED'
      AND te.created_at > v_now - INTERVAL '2 hours'
      AND te.transaction_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
          FROM public.transaction_events te2
         WHERE te2.transaction_id = te.transaction_id
           AND te2.event_type IN ('POLLING_SYNC_SUCCESS', 'POLLING_SYNC_FAILED')
           AND te2.created_at > te.created_at
      )
    ORDER BY
      te.created_at ASC
  LOOP
    -- Check net._http_response for a completed response for this request_id
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

    IF NOT FOUND THEN
      RAISE LOG '[sweep_hanging_payments] Phase 1: Request % for transaction % not yet complete — skipping.',
        v_initiated_rec.pg_net_request_id,
        v_initiated_rec.transaction_id;
      CONTINUE;
    END IF;

    v_phase1_processed := v_phase1_processed + 1;

    -- Timed-out or transport error
    IF v_response_timed_out OR v_response_error IS NOT NULL THEN
      RAISE WARNING '[sweep_hanging_payments] Phase 1: Request % for transaction % failed — timed_out=%, error=%',
        v_initiated_rec.pg_net_request_id,
        v_initiated_rec.transaction_id,
        v_response_timed_out,
        v_response_error;

      INSERT INTO public.transaction_events (transaction_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.transaction_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',     COALESCE(v_response_error, 'request_timeout'),
          'timed_out',  v_response_timed_out,
          'request_id', v_initiated_rec.pg_net_request_id
        ),
        v_now
      );
      CONTINUE;
    END IF;

    -- Parse response
    BEGIN
      v_flw_json := v_response_body::jsonb;
    EXCEPTION WHEN others THEN
      RAISE WARNING '[sweep_hanging_payments] Phase 1: Response body for request % is not valid JSON: %',
        v_initiated_rec.pg_net_request_id,
        left(v_response_body, 200);

      INSERT INTO public.transaction_events (transaction_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.transaction_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',      'invalid_json_response',
          'http_status', v_response_status_code,
          'body_prefix', left(v_response_body, 500),
          'request_id',  v_initiated_rec.pg_net_request_id
        ),
        v_now
      );
      CONTINUE;
    END;

    v_flw_top_status  := v_flw_json ->> 'status';
    v_flw_data_status := v_flw_json -> 'data' ->> 'status';
    v_flw_amount      := (v_flw_json -> 'data' ->> 'amount')::numeric;

    RAISE LOG '[sweep_hanging_payments] Phase 1: transaction=% | http_status=% | flw_status=% | data_status=%',
      v_initiated_rec.transaction_id,
      v_response_status_code,
      v_flw_top_status,
      v_flw_data_status;

    IF v_response_status_code = 200
       AND v_flw_top_status  = 'success'
       AND v_flw_data_status = 'successful'
    THEN
      -- Promote transaction using confirm_payment_atomic
      BEGIN
        PERFORM public.confirm_payment_atomic(
          v_initiated_rec.transaction_id,
          v_flw_amount,
          'ZMW',
          v_response_body,
          'sweep-' || v_initiated_rec.transaction_id
        );

        INSERT INTO public.transaction_events (transaction_id, event_type, payload, created_at)
        VALUES (
          v_initiated_rec.transaction_id,
          'POLLING_SYNC_SUCCESS',
          v_response_body::jsonb,
          v_now
        );

        RAISE LOG '[sweep_hanging_payments] Phase 1: transaction % CONFIRMED.', v_initiated_rec.transaction_id;
      EXCEPTION WHEN others THEN
        RAISE WARNING '[sweep_hanging_payments] Phase 1: confirm_payment_atomic failed for transaction %: %',
          v_initiated_rec.transaction_id, SQLERRM;

        INSERT INTO public.transaction_events (transaction_id, event_type, payload, created_at)
        VALUES (
          v_initiated_rec.transaction_id,
          'POLLING_SYNC_FAILED',
          jsonb_build_object(
            'reason', 'confirm_payment_atomic_failed',
            'error', SQLERRM,
            'request_id', v_initiated_rec.pg_net_request_id
          ),
          v_now
        );
      END;
    ELSE
      INSERT INTO public.transaction_events (transaction_id, event_type, payload, created_at)
      VALUES (
        v_initiated_rec.transaction_id,
        'POLLING_SYNC_FAILED',
        jsonb_build_object(
          'reason',      'payment_not_confirmed',
          'http_status', v_response_status_code,
          'flw_status',  v_flw_top_status,
          'data_status', v_flw_data_status,
          'request_id',  v_initiated_rec.pg_net_request_id
        ),
        v_now
      );
    END IF;
  END LOOP;

  RAISE LOG '[sweep_hanging_payments] Phase 1 complete: % response(s) processed.', v_phase1_processed;

  -- =========================================================================
  -- PHASE 2 — Request Initiation
  -- =========================================================================
  RAISE LOG '[sweep_hanging_payments] --- Phase 2: Firing verification requests ---';

  FOR v_hanging_rec IN
    SELECT
      t.transaction_id
    FROM
      public.transactions t
    WHERE
      t.status = 'GATEWAY_PROCESSING'
      AND t.created_at < v_now - INTERVAL '10 minutes'
      AND NOT EXISTS (
        SELECT 1
          FROM public.transaction_events te
         WHERE te.transaction_id = t.transaction_id
           AND te.event_type = 'POLLING_SYNC_INITIATED'
           AND te.created_at > v_now - INTERVAL '15 minutes'
      )
    ORDER BY
      t.created_at ASC
  LOOP
    SELECT net.http_get(
      url     => format(
                   'https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=%s',
                   v_hanging_rec.transaction_id
                 ),
      headers => jsonb_build_object(
                   'Authorization', 'Bearer ' || v_flw_secret,
                   'Content-Type',  'application/json'
                 )
    ) INTO v_request_id;

    INSERT INTO public.transaction_events (transaction_id, event_type, payload, created_at)
    VALUES (
      v_hanging_rec.transaction_id,
      'POLLING_SYNC_INITIATED',
      jsonb_build_object(
        'request_id',  v_request_id,
        'initiated_at', v_now
      ),
      v_now
    );

    v_phase2_count := v_phase2_count + 1;

    RAISE LOG '[sweep_hanging_payments] Phase 2: Fired request_id=% for transaction=%.',
      v_request_id,
      v_hanging_rec.transaction_id;
  END LOOP;

  RAISE LOG '[sweep_hanging_payments] Phase 2 complete: % request(s) fired.', v_phase2_count;
  RAISE LOG '[sweep_hanging_payments] ===== SWEEP CYCLE END @ % =====', clock_timestamp();
END;
$$;

ALTER FUNCTION public.sweep_hanging_payments() OWNER TO postgres;


-- 4. HARDEN ROW-LEVEL SECURITY POLICIES (MEDIUM)
-- Secure order_items RLS select policy
DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shop_orders so
      JOIN public.transactions t ON t.transaction_id = so.transaction_id
      WHERE so.shop_order_id = order_items.shop_order_id
        AND (
          t.buyer_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.merchant_shops ms
            WHERE ms.shop_id = so.shop_id AND ms.user_id = auth.uid()
          )
        )
    )
    OR public.current_user_role() = 'admin'
  );

-- Fix colliding marketing campaign policies
DROP POLICY IF EXISTS "Campaigns are viewable by everyone" ON public.marketing_campaigns;
DROP POLICY IF EXISTS "Marketing campaigns are publicly readable" ON public.marketing_campaigns;

CREATE POLICY marketing_campaigns_select ON public.marketing_campaigns
  FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.current_user_role() = 'admin');

CREATE POLICY marketing_campaigns_admin ON public.marketing_campaigns
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');


-- 5. DEPLOY HIGH-SPEED INDEX COVERAGE (MEDIUM)
-- Create missing foreign key indexes to optimize queries and RLS evaluation
CREATE INDEX IF NOT EXISTS idx_merchant_shops_user_id ON public.merchant_shops(user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_shops_shop_id ON public.merchant_shops(shop_id);
CREATE INDEX IF NOT EXISTS idx_order_items_shop_order_id ON public.order_items(shop_order_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_shop_id ON public.shop_orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_items_shop_id ON public.items(shop_id);
CREATE INDEX IF NOT EXISTS idx_payout_ledger_shop_id ON public.payout_ledger(shop_id);
