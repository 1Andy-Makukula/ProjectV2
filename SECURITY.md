# Security operations

## If this repository was shared or published

1. **Rotate immediately** in Supabase Dashboard → Settings → API:
   - Service role key (treat as root password)
   - Anon key (if RLS was ever misconfigured)
2. Rotate **Flutterwave** secret + webhook hash.
3. Rotate **USSD_GATEWAY_SECRET** and update the telecom gateway headers.
4. Regenerate any **GEMINI / Twilio / FX** keys referenced in Edge Function secrets.
5. Remove local `.env` from shared machines; use `.env.local` (gitignored).

## Secret storage

| Location | Allowed |
|----------|---------|
| `.env.local` (gitignored) | Local dev only |
| Supabase Edge Function secrets | Production/staging |
| Git / CI logs | **Never** |

## Production checklist

- [ ] All migrations applied (`20260525120000` → `20260525140000`)
- [ ] `USSD_GATEWAY_SECRET` set; USSD provider sends `X-Kithly-USSD-Secret` or `X-USSD-HMAC`
- [ ] `APP_URL` / `ALLOWED_ORIGINS` match deployed SPA origin
- [ ] `ENABLE_LEGACY_PAYOUT_SWEEPER` unset or `false`
- [ ] RLS enabled (migration `20260525140000`)
- [ ] `pnpm audit` reviewed after dependency changes

## Reporting

Document suspected incidents with: timestamp, affected `transaction_id` / `shop_order_id`, and whether webhook idempotency keys appear in `payment_webhook_idempotency`.
