# Phone verification — design for the follow-up to VULN-01

**Status:** specified, not built. Migration `20260903010000` shipped the containment (phone frozen); this is what lifts it.

**Why this document exists:** the containment makes `users.phone` un-editable by its owner. That is correct security and poor product — a user who changes number has to contact support. This is the design that gives the number back to them safely.

---

## The problem being solved

`convert_floating_item_to_credits` decides whose gift a FLOATING item is by matching `users.phone` against `shop_orders.recipient_phone`. That match is the only thing separating a caller from someone else's escrowed money.

Nothing has ever verified `users.phone`. It is a form field from `SignUp.tsx`, carried through `raw_user_meta_data` and written by `handle_new_user`. So the match answers "did this person type the right number", not "does this person hold that number".

The obvious fix — compare `auth.jwt() ->> 'phone'` instead, as the P2P policies do — does not work, because signup is email + password and `auth.users.phone` is never populated. That claim is NULL for every account. (Which also means the P2P policies in `20260614000000` are matching NULL and are, as written, dead. Confirm and fix separately; loosening them has its own blast radius.)

## The design

Make the platform's phone number the one Supabase Auth verified, and derive `public.users.phone` from it.

### 1. Verification flow (client)

In Settings, replace the frozen field with a "Change number" flow:

```ts
// step 1 — request
const { error } = await supabase.auth.updateUser({ phone: e164 });
// Supabase sends an OTP via the configured provider and does NOT
// change auth.users.phone yet.

// step 2 — confirm
const { error } = await supabase.auth.verifyOtp({
  phone: e164,
  token: code,
  type: 'phone_change',
});
// On success auth.users.phone is set and phone_confirmed_at is stamped.
```

### 2. Sync into `public.users` (database)

A trigger on `auth.users`, mirroring `handle_new_user`, so `public.users.phone` is a projection of the verified value and never an independently writable field:

```sql
CREATE OR REPLACE FUNCTION public.sync_verified_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone
     AND NEW.phone_confirmed_at IS NOT NULL THEN
    UPDATE public.users SET phone = NEW.phone WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_phone_changed
  AFTER UPDATE OF phone ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_verified_phone();
```

The RLS freeze from `20260903010000` **stays**. The column keeps being un-writable by its owner; it just now has a legitimate way to change. The unique index also stays, and will now reject a verified change to a number another account already holds — which is the right answer, and needs a specific error message in the UI.

### 3. Gate the money path on verification

Add a `phone_verified_at` column on `public.users` (set by the same trigger) and require it in `convert_floating_item_to_credits`:

```sql
IF v_user_phone_verified_at IS NULL THEN
  RAISE EXCEPTION 'Verify your phone number before converting a gift to credit';
END IF;
```

This is the step that actually closes VULN-01 rather than containing it. Without it, every pre-existing account still has an unverified number that the RPC trusts.

### 4. Backfill

Every existing account is unverified. Two options, and this is a product call:

- **Soft:** conversions keep working for legacy accounts, and a banner asks users to verify. Preserves the exploit for anyone who has not verified.
- **Hard:** conversions require verification from day one. Closes it completely; every user hits a verification wall the first time they try to claim a floating gift.

Recommend **hard**, scoped to the conversion path only — it is the only path that turns a phone match into money, it is comparatively rare, and the wall appears exactly where the stakes justify it.

## Cost and prerequisites

- **Supabase:** phone auth is available on the free tier. No Supabase charge.
- **SMS provider:** Supabase does not send messages; it calls yours. Twilio credentials already exist in `.env`. Roughly **$0.05–0.09 per SMS** to Zambian MSISDNs, billed by Twilio.
- **Trial-account limit:** a Twilio trial can only send to pre-verified numbers. This is the same wall as VULN-09, and it blocks both.
- **Cheaper channel:** Supabase supports **Twilio Verify** as the phone provider, which can deliver OTP over WhatsApp. Lower per-message cost, and it shares infrastructure with claim-code delivery — but it needs an approved WhatsApp Business sender, which is the VULN-09 prerequisite again.

**Sequencing note:** getting the WhatsApp Business sender approved unblocks VULN-09 *and* makes this cheaper. Do that first.

## Scope

- `src/app/pages/sender/Settings.tsx` — change-number flow with OTP entry
- `src/utils/auth/AuthContext.tsx` — `requestPhoneChange` / `confirmPhoneChange`
- new migration — `sync_verified_phone` trigger, `phone_verified_at`, the conversion gate
- `src/types/database.types.ts` — regenerate after the migration
- Supabase dashboard — Auth → Providers → Phone, pointed at Twilio

## Related

- `supabase/migrations/20260903010000_freeze_user_phone_and_unique_msisdn.sql` — the containment
- `supabase/migrations/20260809040000_authorize_floating_conversion.sql` — binds the RPC to the session
- VULN-09 in the audit — the shared WhatsApp-sender prerequisite
