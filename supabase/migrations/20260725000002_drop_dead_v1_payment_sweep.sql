-- Remove the dead V1 "Layer C" payment sweep daemon.
--
-- sweep_hanging_payments() references public.claim_vouchers (dropped in the
-- V2 schema) and transaction_events.voucher_id (the V2 transaction_events
-- table has shop_order_id/transaction_id instead, not voucher_id) — it
-- cannot execute successfully against the current schema.
--
-- trigger_payment_sweeper() POSTs to an edge function "sweep-hanging-payments"
-- that does not exist in supabase/functions/ — only batch-payout-sweeper does,
-- which is the working V2 replacement for this daemon.
--
-- If a pg_cron job still points at sweep_hanging_payments(), it has been
-- failing on every tick since the V2 migration; unscheduling it here is a
-- pure cleanup, not a behavior change.

SELECT cron.unschedule('kithly-sweep-hanging-payments')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'kithly-sweep-hanging-payments'
  );

DROP FUNCTION IF EXISTS "public"."sweep_hanging_payments"();
DROP FUNCTION IF EXISTS "public"."trigger_payment_sweeper"();
