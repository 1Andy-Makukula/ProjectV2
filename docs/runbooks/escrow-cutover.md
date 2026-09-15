# Runbook — cutting over to the escrow model

This is the operational half of [ADR 0003](../adr/0003-escrow-and-settlement-model.md).
The code is deployed and inert. This document is how it is switched on, and how
it is switched back off.

**Nothing in this runbook should be run until the legal opinion on the
segregated account structure is in hand.** The code does not depend on it; the
decision to hold customer money this way does.

---

## The switch

One column governs everything:

```sql
SELECT escrow_mode FROM public.platform_settings WHERE id = 1;
```

| Mode | What happens |
|---|---|
| `legacy` | Pre-escrow behaviour. No ledger writes. Rollback target of last resort. |
| `dual_write` | **Default.** Ledger pairs written alongside the existing wallet and float movements. Observable behaviour is identical to `legacy`. |
| `escrow_v2` | The ledger is authoritative. Fees accrue at redemption, refunds go to source, stored value is refused. |

Moving forward is an `UPDATE`. Moving back is the same `UPDATE`. There is no
migration in either direction, which is the whole point of staging it this way.

---

## Stage 1 — deploy, and do nothing

Deploying `20260915000000` … `20260915070000` changes nothing a user can see.
Verify that:

```sql
-- Should be dual_write. CI check 9 fails the build if the default ever drifts.
SELECT escrow_mode FROM public.platform_settings WHERE id = 1;

-- Should be true, always, forever.
SELECT public.ledger_is_balanced();
```

Deploy the Edge Functions:

```
supabase functions deploy payout-dispatcher
supabase functions deploy verify-payout-destination
supabase functions deploy escrow-reconcile
```

Set their configuration. **`payout-dispatcher` must not be scheduled yet** —
there is nothing in the queue and Airtel may not be configured.

```
AIRTEL_BASE_URL            https://openapi.airtel.africa
AIRTEL_CLIENT_ID           …
AIRTEL_CLIENT_SECRET       …
AIRTEL_COUNTRY             ZM
AIRTEL_CURRENCY            ZMW
AIRTEL_PIN                 the RSA-encrypted disbursement PIN
PAYOUT_DISPATCHER_SECRET   …
RECONCILE_SECRET           …
BANK_BALANCE_URL           optional; omit and pass the balance by hand
```

---

## Stage 2 — post the opening balances

A ledger that starts empty cannot record the redemption of a voucher funded
before it existed: the debit drives a sender liability negative and the master
invariant drifts by the value of every in-flight gift.

**Preview first. Always.**

```sql
SELECT public.escrow_open_balances(true);   -- dry run, writes nothing
```

Compare `total_zmw` against the segregated account statement. They should agree
to within whatever is genuinely in flight at the bank. If they do not, stop and
find out why — this number is the foundation every later reconciliation is
measured against.

When it agrees:

```sql
SELECT public.escrow_open_balances(false);  -- posts, once
```

Safe to run twice; the second pass finds nothing left to post.

---

## Stage 3 — get merchants verified

This is the long pole, and it is outreach rather than engineering.

Every existing merchant was backfilled as **unverified** — deliberately, because
every one of those numbers was typed into a free-text field and never checked.
Under `escrow_v2` an unverified merchant cannot accept a collection.

```sql
-- Who is not ready, and how much of your volume do they represent?
SELECT s.name,
       d.rail,
       d.verification_status,
       d.verification_error,
       count(so.shop_order_id) FILTER (
         WHERE so.created_at > now() - interval '30 days') AS orders_30d
FROM public.shops s
LEFT JOIN public.merchant_payout_destinations d
       ON d.shop_id = s.id AND d.is_active
LEFT JOIN public.shop_orders so ON so.shop_id = s.id
WHERE s.is_active
  AND (d.id IS NULL OR d.verification_status <> 'verified')
GROUP BY s.name, d.rail, d.verification_status, d.verification_error
ORDER BY orders_30d DESC;
```

**Do not cut over while that list holds meaningful volume.** A merchant who
cannot scan is a merchant whose customer is standing at the counter.

The merchant panel walks them through it; the blocking banner is the first thing
on their dashboard and says exactly what to fix.

---

## Stage 4 — run reconciliation daily, in dual-write

Schedule `escrow-reconcile` daily. Feed it the real balance:

```
POST /functions/v1/escrow-reconcile
x-reconcile-secret: …
{ "bank_balance_zmw": 148230.55 }
```

Omitting the balance is allowed and records `BANK_UNAVAILABLE` — a day that
could not be checked is recorded as such, never as a day that balanced.

HTTP status carries the finding so a scheduler alerts without parsing anything:

| Status | Meaning |
|---|---|
| `200` | Balanced. |
| `409` | Drift, or an internal imbalance. Investigate today. |
| `503` | Could not read the bank. The internal check still ran. |

**`INTERNAL_IMBALANCE` outranks everything.** It means a code path wrote a
single-sided entry and the ledger's own numbers cannot be trusted. Find the
entry before comparing anything against the bank:

```sql
SELECT entry_pair_id, count(*), array_agg(direction), array_agg(reason)
FROM public.ledger_entries
GROUP BY entry_pair_id
HAVING count(*) <> 2;
```

**Run this for a full cycle before proceeding.** "Clean" means every day
`BALANCED`, with no manual corrections. That is what §11 asks for and it is the
only evidence that the dual-write model tracks reality.

---

## Stage 5 — cut over

```sql
UPDATE public.platform_settings SET escrow_mode = 'escrow_v2' WHERE id = 1;
```

Then, immediately:

- Schedule `payout-dispatcher` (every 2–5 minutes; it returns instantly when
  the queue is empty). Add a second daily run with `?resolve=1` to settle
  anything parked in `SENT`.
- Schedule `escrow_process_expiries()` in place of `process_expired_vouchers()`.
  The old one returns 0 under `escrow_v2` rather than erroring, so leaving it
  scheduled is harmless — but it is doing nothing, and a job that does nothing
  should be removed rather than trusted.
- Watch the first redemptions individually. The first instant payout to a real
  Airtel number is the moment this model becomes real.

### Rolling back

```sql
UPDATE public.platform_settings SET escrow_mode = 'dual_write' WHERE id = 1;
```

That is the whole rollback. Legacy behaviour resumes immediately. Ledger entries
already written stay written — they are history, and history is not rewritten.

Note what rollback does **not** undo: payouts already sent are sent. Mobile money
is final. Rolling back stops new escrow behaviour; it does not recall money.

---

## Watching it, day to day

```sql
SELECT public.escrow_position();
```

Returns the master invariant plus the four operational numbers that need eyes:
payouts awaiting, payouts stuck, refunds pending, unswept fees.

### Things that need a human

| Symptom | Query | What it means |
|---|---|---|
| Payouts stuck in `SENT` | `SELECT * FROM payout_instructions WHERE status = 'SENT' AND sent_at < now() - interval '15 minutes';` | Outcome unknown. Money may be in flight. Resolve via `?resolve=1`, never by retrying. |
| `ABANDONED` payouts | `SELECT * FROM payout_instructions WHERE status = 'ABANDONED';` | We owe a merchant and cannot deliver. The payable is still open. Contact them. |
| `REFUND_PENDING` | `SELECT * FROM refund_requests WHERE status IN ('REFUND_PENDING','UNCLAIMED');` | A sender's money we cannot return. **Needs the unclaimed-funds policy.** |
| A rail marked down | `SELECT * FROM payment_rails WHERE NOT is_available;` | Redemptions are blocked at affected merchants, by design. |

---

## The daily fee sweep

```sql
SELECT public.propose_fee_sweep();        -- returns the amount to transfer
-- make the bank transfer out of the segregated account
SELECT public.confirm_fee_sweep('<sweep_id>', '<bank reference>', '<admin uuid>');
```

Two phases on purpose: the ledger records money that has actually moved. A bank
reference is required and an empty one is refused — see ADR 0003.

---

## What is still deferred

- **`wallet_ledger` is not dropped.** §11.9 makes that conditional on a full
  clean cycle on `escrow_v2`. It is a separate migration, written later.
- **Existing wallet balances are not drained.** The guard blocks new credit, not
  balances people already hold. Draining them needs its own plan — most likely
  paying them out to source rather than expiring them.
- **Bank-rail payouts are manual.** The dispatcher fails them explicitly and
  retryably rather than skipping them, so they show up rather than disappear.
- **The unclaimed-funds policy does not exist.** Until it does, `REFUND_PENDING`
  rows accumulate and are worked by hand. This is the one part of the model with
  no defined ending, and it needs the lawyer before launch.
