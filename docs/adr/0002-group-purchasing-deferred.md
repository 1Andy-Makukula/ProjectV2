# ADR 0002 — Group purchasing is deferred, and leaves a documented seam

**Status:** accepted
**Date:** 2026-09-13
**Migration:** `20260913040000_wallet_provenance_and_budgets.sql`

## Context

Stage 2 of the V3 plan set out to build a personal life-management layer:
occasion reminders, budgets, and price alerts. One of the four components
originally scoped was **group purchasing** — several people contributing small
amounts toward one gift, with automated nudges to complete their share before
the date.

It was cut from Stage 2 deliberately. This ADR records why, and what was left
behind so the decision can be revisited without re-deriving it.

## Why it was cut

Group purchasing reads like a feature of reminders. It is not. It is a change to
the money path, and specifically to escrow:

- **One hold, many payers.** Today a `shop_order` is funded by one transaction
  from one buyer. Splitting it means a hold that is partially funded for a
  period, which every downstream consumer — fulfilment, expiry, payout
  batching, refunds — currently has no state for.
- **The payer who never pays.** A group of five where one drops out needs a
  rule: does the gift shrink, does someone cover it, does the whole thing
  refund? Each answer is a different set of states and a different set of
  notifications.
- **Refunds when the group falls short.** Money already taken from four people
  has to go back to four people, through Flutterwave, with idempotency, before
  the expiry sweeper reclaims the order.
- **`checkout_intent = 'friends'` already exists** in the baseline `CHECK`
  constraint and in `src/types/status-enums.ts`, and nothing reads or writes it.
  It has been a dead value since the V2 schema.

That is work on the scale of the FX workstream, and hiding it inside a stage
called "reminders" would have made Stage 2 unreviewable.

## Decision

Group purchasing is **not built** in Stage 2. It gets its own track, after V3.

Two seams are left, both inert and both documented:

1. **`budget_goals.visibility`**, constrained to `'private'`. Admitting a second
   value later is a one-line migration rather than a table rewrite. There is a
   test asserting the seam stays shut, so it cannot be opened by accident.
2. **`checkout_intent = 'friends'`**, which already exists, is recorded here as
   reserved rather than vestigial — so the next person to find it does not
   delete it as dead weight, and does not assume it works.

## Why a seam and not a scaffold

This codebase has already had to strip two scaffolds that pretended to work:
`fastapi-gateway` reported `{"status": "healthy", "database_connected": true}`
from a file that had never opened a connection, and `worker-engine` logged
`[TELEMETRY] Scanning for stale vouchers...` on a sixty-second loop while doing
nothing. Both now say "NOT IMPLEMENTED" and return 501 or idle, because a
component that looks functional is worse than an absent one — somebody debugging
a real voucher failure read those logs and looked elsewhere.

So there is no placeholder UI, no greyed-out "invite friends" button, and no
half-written contribution table. A constrained column and this document.

## Consequences

- Stage 2 stays reviewable, and its money-path change is one line in
  `checkout_init_atomic` rather than a new funding model.
- When group purchasing is built, the questions above are already written down
  and do not have to be rediscovered.
- Until then, a shopper saving for a gift does so alone. `budget_goals` supports
  that fully — the meter, the reservation, and the guard that stops checkout
  spending it.

## What would need designing first

Not code, but answers:

1. Does a partially funded hold exist as a state, or is money held outside the
   order until the group completes?
2. What happens at the deadline when a group is short?
3. Who may see a group goal, and may a contributor see what others gave?
4. Does the recipient learn it was a group gift, and does that change the
   claim flow?
