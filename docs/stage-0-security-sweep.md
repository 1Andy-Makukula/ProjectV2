# Stage 0 — security sweep

Run 2026-09-12 on `main` at `6754d70`. Companion to `performance-baseline.md`.
Stage 0 confirms; it does not fix. Anything below that needs changing belongs to
the stage that owns the surface.

## RLS on everything added since the 2026-09-03 audit

Nine tables have landed since: `contacts`, `contact_occasions`, `posts`,
`post_images`, `post_items`, `post_likes`, `post_saves`, `post_wishes`,
`post_wish_audience`.

All nine have RLS enabled **and** policies attached — enabled-with-no-policy
would deny everything, which is safe but broken, and that is not the case here.
No `USING (true)` appears on any posts table.

New `SECURITY DEFINER` functions follow the established privilege pattern:
`REVOKE ALL ... FROM PUBLIC` then a scoped `GRANT EXECUTE`. The scoping is
correct rather than uniform — `can_view_post` reaches `anon`, `can_edit_post`
does not, and `save_post_wish` is granted to `authenticated` only.

No `service_role` reference exists anywhere in `src/`.

**Result: pass.**

## Confirmed: the P2P policies are dead as written

Carried over as "worth confirming separately". It is now confirmed.

`20260614000000_v2_p2p_unified_rls.sql` and `20260614100000_fix_rls_deadlock.sql`
gate recipient access on `auth.jwt() ->> 'phone'`. Migration
`20260903010000_freeze_user_phone_and_unique_msisdn.sql` documents, in its own
header, why that claim is **NULL for every account on the platform**: signup is
email+password, and phone rides in `raw_user_meta_data` to `public.users` via
`handle_new_user`, so `auth.users.phone` is never populated.

No later migration supersedes either policy.

**These fail closed, so this is not an exposure.** A NULL comparison matches no
rows, so the effect is the opposite: a signed-in recipient cannot see their own
order or transaction through these policies. It is a broken feature wearing a
security policy's clothes.

**Not fixed here, deliberately.** These are money tables and loosening their RLS
has real blast radius; the correct predicate is almost certainly a join to
`public.users.phone` the way `20260903010000` does it, but that is a change that
needs its own migration, its own test, and someone deciding what recipient access
should actually mean. Flagged for the stage that owns it.

## Still open, unchanged

| Item | Owner | Blocked on |
|---|---|---|
| **service_role key rotation** | Andy | Nothing — leaked in git history since 1 Jun 2026, still the live key |
| Phone OTP verification | — | Twilio spend; needs the approved WhatsApp Business sender first |
| Rate limiting `get_shop_order_by_claim_code` | — | Cloudflare/Upstash; cannot be done from the repo |
| Sweeping historic public chat images | — | New uploads are private; `storefront-assets/chat/**` backlog remains |

## Method note

`pnpm typecheck` excludes `supabase/`, and Deno is not installed here, so neither
edge functions nor migrations are covered by the standard commands. Everything
above was established by reading the migration chain rather than executing it.
Claims about runtime behaviour of these policies should be confirmed against a
branch database before anything is changed on their basis.
