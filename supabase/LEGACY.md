# Legacy code paths (V1 / Layer C)

These modules target the **pre-V2** `claim_vouchers` schema. Do not use them for new features.

| Path | Status | V2 replacement |
|------|--------|----------------|
| `supabase/snippets/layer_c_payment_sweep.sql` | Reference only | `confirm_payment_atomic` + `payment_webhook_idempotency` |
| `supabase/functions/batch-payout-sweeper/` | **Disabled by default** | Set `ENABLE_LEGACY_PAYOUT_SWEEPER=true` only during V1 migration; prefer `settle_payout_atomic` |
| `supabase/functions/get-merchant-ledger/` | **Migrated (Phase 4)** | Reads `shop_orders` in `FULFILLED` / `PARTIAL_FULFILLMENT` awaiting settlement |

## Removal checklist

1. Confirm production has no rows in `claim_vouchers` with `payout_status = PENDING_BATCH`.
2. Migrate any pending settlements to V2 `shop_orders.settlement_target_time` flow.
3. Delete or archive `batch-payout-sweeper` Edge Function deployment.
4. Remove `layer_c_payment_sweep.sql` from operational runbooks.
