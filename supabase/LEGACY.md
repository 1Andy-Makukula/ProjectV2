# Legacy code paths (V1 / Layer C)

These modules target the **pre-V2** `claim_vouchers` schema. Do not use them for new features.

| Path | Status | V2 replacement |
|------|--------|----------------|
| `supabase/snippets/layer_c_payment_sweep.sql` | Reference only | `confirm_payment_atomic` + `payment_webhook_idempotency` |
| `supabase/functions/batch-payout-sweeper/` | **Active (rewritten)** | Not legacy. Processes the merchant withdrawal queue — see below |
| `supabase/functions/get-merchant-ledger/` | **Migrated (Phase 4)** | Reads `shop_orders` in `FULFILLED` / `PARTIAL_FULFILLMENT` awaiting settlement |
| `supabase/functions/server/` | **Removed** | Split into single-purpose functions — see below |

## Retired: the monolithic `server` function

`server` routed every action through one `Deno.serve` handler keyed on a
`payload.action` string. It has been replaced by one function per capability:

| Retired action | Replacement function | Guard |
|----------------|---------------------|-------|
| `verify_payment` | `verify-payment` | Authenticated buyer; must own the transaction |
| `request_withdrawal` | `request-withdrawal` | Merchant assigned to the shop |
| `create_merchant` | `create-merchant` | Admin |
| `confirm_payment` | `admin-confirm-payment` | Admin; refuses non-`GATEWAY_PROCESSING`, writes an audit event |
| *(never routed)* `/admin-reset-password` | `admin-set-password` | Admin; refuses admin targets |
| `initialize_payment` | `checkout-init` / `checkout-retry` | Existing V2 functions |
| `flutterwave_webhook` | `flutterwave-webhook` | `verif-hash` vs `FLUTTERWAVE_WEBHOOK_SECRET` |
| bare `GET` health probe | `health` | None (liveness only) |

### Deployment checklist

1. Deploy the new functions: `verify-payment`, `request-withdrawal`,
   `create-merchant`, `admin-confirm-payment`, `admin-set-password`, `health`.
2. **Check the Flutterwave dashboard webhook URL.** If it still points at
   `/functions/v1/server`, repoint it to `/functions/v1/flutterwave-webhook`
   *before* removing the deployed function, or payment confirmations will stop.
   Note the secret differs: the retired handler read `FLUTTERWAVE_VERIF_HASH`,
   the current one reads `FLUTTERWAVE_WEBHOOK_SECRET`.
3. Once traffic is confirmed on the new endpoints, remove the old deployment:
   `supabase functions delete server`. Deleting the source from this repo does
   **not** undeploy it.

## Correction: `batch-payout-sweeper` was never legacy

This document previously listed the sweeper as a disabled V1 component gated
behind `ENABLE_LEGACY_PAYOUT_SWEEPER`. That environment variable has never
existed in the function, and the function reads the V2 `shop_orders` table, not
`claim_vouchers`. The entry was wrong on both counts.

What was true is that it never ran: it selected orders with
`payout_status = 'PENDING_BATCH'`, and nothing in the codebase has ever set that
value. Combined with `settle_payout_atomic` having no callers, merchants could
neither be credited nor paid out.

It now processes the merchant withdrawal queue instead of shop orders:

1. `request_withdrawal_atomic` debits the merchant wallet and queues a row in
   `merchant_withdrawals`.
2. The sweeper calls `claim_withdrawal_batch`, which claims pending rows with
   `FOR UPDATE SKIP LOCKED` so overlapping runs cannot wire the same money.
3. Each claimed row is sent to the Flutterwave transfers API.
4. Success calls `complete_withdrawal`; failure calls `fail_withdrawal`, which
   returns the funds to the merchant's balance and notifies them.

Paying against withdrawals rather than orders is deliberate: the wallet debit
has already happened, so a transfer cannot double-pay a merchant who was also
credited at settlement.

### Deploying it

`supabase functions deploy batch-payout-sweeper`, then invoke it on a schedule
(pg_cron with pg_net, or any external scheduler) with the
`BATCH_PAYOUT_SWEEPER_SECRET` header. It is safe to run frequently — it returns
immediately when the queue is empty.

## Removal checklist

1. Confirm production has no rows in `claim_vouchers` with `payout_status = PENDING_BATCH`.
2. Migrate any pending settlements to V2 `shop_orders.settlement_target_time` flow.
3. Delete or archive `batch-payout-sweeper` Edge Function deployment.
4. Remove `layer_c_payment_sweep.sql` from operational runbooks.
