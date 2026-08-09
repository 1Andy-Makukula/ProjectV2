# ADR 0001 — `checkout_init_atomic` takes a context object, and its signature is frozen

**Status:** accepted
**Date:** 2026-08-09
**Migration:** `20260809080000_checkout_context_object.sql`

## Context

`checkout_init_atomic` is the entry point to the money path. Between the V2
schema and August 2026 it was rewritten **nine times** and grew from seven
positional parameters to twelve. Each new selling mode — wallet credits,
scheduled services, curated experiences, expiry windows — was added by appending
another argument.

That pattern had two costs, both of which were paid:

1. **Every change reproduced the whole function.** `CREATE OR REPLACE` has no
   partial form, so adding one parameter meant retyping ~150 lines of money
   handling. Elsewhere in this same series of migrations, that trade nearly
   destroyed 160 lines of `sweep_hanging_payments`, caught only because the
   original was read in full first.

2. **The `DROP`s did not keep up.** Production ended up holding several
   signatures at once, and a four-argument call returned `PGRST203` because
   PostgREST could not resolve which was meant. Each stale copy also kept its own
   inherited grants, so revoking the live one hardened nothing.

The FX work in Phase C needs to pass a rate-lock ID into checkout. Under the old
shape that would have been parameter thirteen.

## Decision

The signature is:

```sql
checkout_init_atomic(
  p_buyer_id       UUID,
  p_origin_type    TEXT,
  p_gateway_tx_ref TEXT,
  p_vendors        JSONB,
  p_context        JSONB DEFAULT '{}'::JSONB
)
```

Four arguments **identify** a checkout — who is buying, where from, the gateway
reference, the basket. Everything that merely **describes** it travels in
`p_context`.

**`p_context` is a closed set.** Unknown keys raise, they are not ignored. This
is the condition on which the decision rests: the standard objection to a
property bag is that a misspelled positional parameter fails at call time while
a misspelled key silently becomes `NULL` — an order quietly losing its recipient
or its expiry, with nothing to notice. Rejecting unrecognised keys removes that
failure mode. Without it, this shape would be worse than what it replaced.

Recognised keys today:

`recipient_name`, `recipient_phone`, `message`, `sender_phone`,
`credits_to_apply`, `target_execution_date`, `experience_id`, `expires_at`

## Consequences

**Adding a vertical adds a key.** It does not touch the signature, does not
require reproducing the body, and cannot leave a stale overload behind.

**The signature is pinned in CI.** `supabase/tests/ci_smoke_checks.sql` asserts
it exactly. Changing it fails the build, and the failure message points here.
That is deliberate friction: the freeze is worth nothing if it can be undone
without anyone noticing, and this function's history is nine rewrites that each
seemed locally reasonable.

**Changing it is allowed — silently changing it is not.** To change the
signature: update the pin, add an ADR superseding this one saying why the
context object was insufficient, and drop the old signature explicitly in the
same migration.

**A changed signature creates a new `pg_proc` entry**, which is created with the
`PUBLIC` default `EXECUTE` grant. The ACL does *not* carry over from the old one.
Any migration that changes this signature must revoke and re-grant explicitly —
see `20260809000000` for why that matters, and note that
`ci_smoke_checks.sql` will catch it if forgotten.

## Alternatives considered

**Keep appending parameters.** Rejected: it is what produced the ghost overloads
and the nine rewrites.

**Separate functions per vertical** (`checkout_gift`, `checkout_service`, …).
Rejected: the escrow state machine is the one thing that must not fork. Tiers
and modes are parameters of a single machine, not variants of it — and four
copies of this body would be four places for the money handling to drift apart.

**A composite SQL type instead of `JSONB`.** Rejected for now: it gives real
field-name checking, but altering a composite type used in a function signature
has its own migration hazards, and the closed-set check recovers most of the
safety at far lower cost. Worth revisiting if `p_context` grows large.
