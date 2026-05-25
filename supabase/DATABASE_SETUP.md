# KithLy V2 Database Schema (canonical)

This document matches the **application code and Edge Functions** in this repo.
Apply `supabase/migrations/20260525120000_v2_canonical_schema.sql` to align an existing Supabase project.

> **Legacy note:** Older exports used `transactions.id`, `sender_id`, `payment_status`, `items.base_price`, and `transaction_events.shop_order_id`. Those names are obsolete in V2.

## Core tables

### `transactions`
| Column | Type | Notes |
|--------|------|-------|
| `transaction_id` | UUID PK | Parent checkout record |
| `buyer_id` | UUID FK → `users` | Payer |
| `total_amount` | integer | Ngwee (ZMW × 100) or whole ZMW per deployment |
| `status` | text | `GATEWAY_PROCESSING` → `SUCCESSFUL` |
| `gateway_tx_ref` | text unique | `KITHLY-{ts}-{suffix}` — **not** overwritten on webhook |
| `origin_type` | text | `LOCAL` \| `INTERNATIONAL` |
| `created_at` | timestamptz | |

Flutterwave `tx_ref` is set to `transaction_id` (UUID) in `checkout-init`.

### `shop_orders`
| Column | Type | Notes |
|--------|------|-------|
| `shop_order_id` | UUID PK | One per vendor in a cart |
| `transaction_id` | UUID FK | |
| `shop_id` | UUID FK | |
| `claim_code` | varchar(8) unique | Gift redemption code |
| `claim_status` | text | `PENDING_PAYMENT` → `PENDING` → `PROCESSING_FULFILLMENT` → `FULFILLED` / `PARTIAL_FULFILLMENT` |
| `subtotal` | integer | Server-calculated |
| `recipient_name`, `recipient_phone`, `message` | text | Gift metadata |

### `order_items`
| Column | Type | Notes |
|--------|------|-------|
| `order_item_id` | UUID PK | |
| `shop_order_id` | UUID FK | |
| `item_id` | UUID FK → `items.id` | |
| `allocated_price` | integer | Snapshot at checkout |
| `fulfillment_status` | text | `PENDING` \| `COLLECTED` \| `MISSING` |

### `items`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `shop_id` | UUID FK | |
| `name`, `description`, `image_url` | text | |
| `price_zmw` | integer | Authoritative price for checkout-init |

### `transaction_events` (append-only audit)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `transaction_id` | UUID FK → `transactions` | Was `voucher_id` / `shop_order_id` in legacy |
| `event_type` | text | e.g. `WEBHOOK_RECEIVED` |
| `payload` | text / jsonb | Raw event body |
| `created_at` | timestamptz | |

### `merchant_shops`
| Column | Type | Notes |
|--------|------|-------|
| `user_id` | UUID FK | Merchant staff |
| `shop_id` | UUID FK | Shop they may fulfil / settle |

## Payment flow (intended)

1. `checkout-init` inserts `transactions` + `shop_orders` (`PENDING_PAYMENT`) + `order_items`.
2. User pays on Flutterwave; redirect goes to `{APP_URL}/confirmation/{transaction_id}?tx_ref={transaction_id}`.
3. `flutterwave-webhook` (POST only) sets `transactions.status = SUCCESSFUL` and `shop_orders.claim_status = PENDING`.
4. Frontend polls `transactions.status` (or reads confirmation page).

## Environment variables (Edge Functions)

| Variable | Used by |
|----------|---------|
| `APP_URL` | `checkout-init`, `server` — Flutterwave redirect target |
| `FLUTTERWAVE_SECRET_KEY` | Payment init / verify |
| `FLUTTERWAVE_WEBHOOK_SECRET` | Webhook signature |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | All privileged functions |

## Phase 2 — Atomic RPCs & RLS

| Migration | Purpose |
|-----------|---------|
| `20260525130000_v2_atomic_money_rpcs.sql` | `checkout_init_atomic`, `confirm_payment_atomic`, `fulfill_voucher_atomic`, `settle_payout_atomic`, `register_merchant_shop` |
| `20260525140000_v2_rls_policies.sql` | Row-level security; blocks client `users.role` escalation |

Edge Functions call the RPCs with the **service role**. `register_merchant_shop` is callable by **authenticated** users via `supabase.rpc()`.

## Applying migrations

```bash
supabase db push
```

Apply in order: `20260525120000` → `20260525130000` → `20260525140000`.

Or paste each file into the Supabase SQL Editor.

## Phase 3 — Security, CI, ops

| Change | Location |
|--------|----------|
| USSD gateway auth | `USSD_GATEWAY_SECRET` + `X-Kithly-USSD-Secret` or `X-USSD-HMAC` on `ussd-gateway` |
| Restricted CORS | `APP_URL` / `ALLOWED_ORIGINS` via `supabase/functions/_shared/cors.ts` |
| Receipt XSS fix | `src/lib/html.ts` + `receiptGenerator.ts` |
| nginx security headers | `nginx.conf` |
| Removed unused `jspdf` | CVE surface reduced |
| GitHub Actions CI | `.github/workflows/ci.yml` |
| Route code-splitting | `src/app/routes.tsx` |
| Legacy deprecation | `supabase/LEGACY.md` |

### Edge Function secrets (Phase 3)

| Variable | Function |
|----------|----------|
| `USSD_GATEWAY_SECRET` | `ussd-gateway` — required in production |
| `ALLOWED_ORIGINS` | Browser-facing functions — comma-separated origins (optional; defaults to `APP_URL`) |

## Tests

```bash
pnpm test              # unit tests
pnpm test:integration  # optional; needs RUN_INTEGRATION_TESTS=true + Supabase secrets
```

Runs validation helpers (`tests/money-validation.test.ts`), HTML escaping (`tests/html.test.ts`), upload rules (`tests/upload-validation.test.ts`), and optional RPC integration tests.

## Phase 4 — Hardening & ops hygiene

| Change | Location |
|--------|----------|
| V2 merchant ledger API | `get-merchant-ledger` → `shop_orders` pending settlement |
| Server-side image upload | `upload-item-image` Edge Function + `src/utils/uploadImage.ts` |
| Legacy sweeper off by default | `ENABLE_LEGACY_PAYOUT_SWEEPER` must be `true` to run V1 sweeper |
| Secrets template | `.env.example` |
| Rotation playbook | `SECURITY.md` |
| Hardcoded project ref removed | `utils/supabase/info.tsx` re-exports env-based `projectId` |

Deploy **`upload-item-image`** alongside other Edge Functions. Ensure Storage bucket `kithly-images` exists with public read for `items/` paths.
