# Legacy code paths (V1 / Layer C)

These modules target the **pre-V2** `claim_vouchers` schema. Do not use them for new features.

| Path | Status | V2 replacement |
|------|--------|----------------|
| `supabase/snippets/layer_c_payment_sweep.sql` | Reference only | `confirm_payment_atomic` + `payment_webhook_idempotency` |
| `supabase/functions/batch-payout-sweeper/` | **Disabled by default** | Set `ENABLE_LEGACY_PAYOUT_SWEEPER=true` only during V1 migration; prefer `settle_payout_atomic` |
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

## Removal checklist

1. Confirm production has no rows in `claim_vouchers` with `payout_status = PENDING_BATCH`.
2. Migrate any pending settlements to V2 `shop_orders.settlement_target_time` flow.
3. Delete or archive `batch-payout-sweeper` Edge Function deployment.
4. Remove `layer_c_payment_sweep.sql` from operational runbooks.
