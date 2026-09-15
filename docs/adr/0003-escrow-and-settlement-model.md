# ADR 0003 — KithLy holds no stored value

**Status:** accepted, staged (not yet cut over)
**Date:** 2026-09-15
**Migrations:** `20260915000000` … `20260915070000`
**Supersedes:** the wallet / float / withdrawal model
**Blocked on, before cutover:** legal opinion on the segregated account
structure; Airtel commercial terms for the disbursement tariff

## Context

KithLy's money model was built incrementally and ended up with three things
that are, legally, the same thing: a **sender wallet balance**, a **merchant
float balance**, and a **withdrawal** path from the second to a bank.

Each of them is a balance a user controls and can spend or withdraw. That is
stored value, and taking stored value is a licensed activity under Zambian
financial services law. KithLy is not licensed for it.

This was not a theoretical exposure. Expired gifts refunded 80% of their value
into a sender wallet — converting a customer's money, paid by card, into credit
redeemable only with us, without asking. Merchants accrued a float against an
exposure limit and asked for it back. Neither was intended as a banking product
and both functioned as one.

## Decision

Customer money lives in a **segregated client funds account** and is tracked in
a **double-entry ledger**. No user ever holds a balance.

Five invariants follow, and every design decision below is downstream of them:

1. **No user-controlled balance exists.** Not for senders, not for merchants.
2. **The segregated account holds customer funds only.** Never operating cash,
   never fees, never payroll.
3. **Fees accrue at redemption, never at funding.** Before an item is
   collected, every ngwee in the account belongs to a sender.
4. **Custody is measured and minimised.** The sender leg is unavoidable. The
   merchant leg should be seconds.
5. **The ledger reconciles daily against the bank.** Internal consistency is
   not correctness.

Asserted daily, and the single most important control in the system:

```
segregated_account_balance == open_sender_liabilities
                            + pending_merchant_payouts
                            + accrued_unswept_fees
```

## The decisions worth recording

### Double entry, and one writer

`ledger_entries` replaces the single-entry `wallet_ledger`. Every movement
writes two rows sharing an `entry_pair_id`, one debit and one credit.

Single entry is internally consistent by construction and therefore proves
nothing: a code path that credits a balance without a corresponding debit
leaves no trace. Double entry makes that class of bug loud, and
`assert_ledger_balanced()` is what makes it loud on a schedule.

`post_ledger_pair` is the **only** writer. CI smoke check 9 fails the build if
any other function learns to INSERT into the table, because the guarantee lives
in that one function and a second writer silently voids it.

### Ngwee, at exactly one boundary

The ledger stores hundredths. The rest of the schema stores whole kwacha. A fee
of a small percentage of a small item rounds to zero in whole kwacha, and a fee
that rounds to zero is revenue that silently disappears.

`zmw_to_ngwee` is the only conversion in the money path. The fee split is
asserted exact across 1,004 values: `merchant + fee == gross`, always, with the
merchant taking the rounding remainder rather than the house.

### The guard is on the tables, not the functions

§9 of the model lists functions to remove. Dropping them would have been the
obvious implementation and the wrong one: it removes the call sites we *found*.
Any path we missed — an Edge Function, an admin tool, a future migration — would
still write a balance, silently.

So `refuse_stored_value` is a trigger on `wallet_ledger`,
`merchant_float_ledger` and `merchant_withdrawals`, plus `refuse_float_increase`
on `shops`. Whatever calls them, the write is refused once `escrow_mode` is
`escrow_v2`. That covers the call sites nobody remembered, which is the only
kind that matters.

### Verification gates redemption, not payout

A merchant whose payout destination is unverified **cannot accept a
collection**. Checking at payout time would mean discovering a bad number after
the goods have left the counter, and there is no mechanism to get goods back.

The cost is real: on cutover, every existing merchant must verify before
trading. The backfill in `20260915010000` deliberately imports existing payout
details as **unverified**, because every one of those numbers was typed into a
free-text field and never checked against anything. Marking them verified would
assert a fact nobody established.

### Tiered settlement replaces the global dispute window

Mobile money is final; once sent it cannot be reversed. So any window in which a
dispute could arrive is a window in which we must not have paid, and any delay
is a merchant waiting for money they earned.

One global `dispute_window_minutes` resolves that badly — it is necessarily too
slow for a proven merchant or too reckless with a new one. Tiers resolve it and
turn the hold into an incentive: *new* waits 24 hours, *established* is paid at
the scan, *flagged* waits 72 hours under review. "Get paid instantly" becomes
something a merchant earns, which is a better reason to care about their record
than any badge.

Containment beats promotion: an open dispute flags a merchant regardless of
volume.

### Expiry compensation is conditional and disclosed

Blanket "some to the shop" is hard to defend. If the shop reserved nothing, it
lost nothing, and taking a slice of the sender's money to cover a loss that did
not occur is indefensible to the sender and to a regulator.

Compensation is now per item, set by the merchant where they genuinely hold or
prepare stock, and **shown to the sender at checkout before they pay**. The
percentage is snapshotted onto the order line by trigger at purchase, so a
merchant cannot raise it after the sale — the disclosed terms are the contract.

Refunds go to the original payment method. Never to a balance.

### Three outcomes from a payment rail, not two

The most expensive available mistake is treating "the request threw" as "the
payment failed". A timeout means the money may already be moving; retrying or
reversing there pays the merchant twice.

Every rail call returns `ok` | `failed` | `unknown`. An `unknown` is parked in
`SENT` and resolved by asking the rail what happened to the reference — never by
guessing. `batch-payout-sweeper` learned this the hard way; the rule is carried
over rather than rediscovered.

### A failed payout does not reverse the redemption

The goods are already over the counter. `MERCHANT_PAYABLE` stays open, visible
to the merchant as money owed, and retries with capped backoff. After the budget
is exhausted the instruction is `ABANDONED` — a human's problem by design,
because an automatic system retrying a payout to a number that does not exist
will do so forever.

### The sweep is two-phase

A fee sweep is proposed with an amount, the bank transfer is made, and the
ledger pair is posted when the transfer is confirmed with its reference. Posting
first would make the ledger claim the segregated account is lower than it really
is, and the daily reconciliation — which might run in that window — would report
drift for our own bookkeeping getting ahead of itself.

## What was deliberately not done

**`wallet_ledger` is not dropped.** §11.9 makes that conditional on dual-write
running clean for a full cycle, which has not happened yet. It is a later
migration written against a production already running on `escrow_v2`.

**The cutover has not happened.** `escrow_mode` defaults to `dual_write`:
ledger pairs are written alongside the existing balances, and nothing
observable changes. CI check 9 asserts that default, because a default that
drifted to `escrow_v2` would cut production over on deploy.

**Opening balances are not posted automatically.** `escrow_open_balances`
defaults to a dry run and is an operational step taken once, against real data,
reviewed against the bank statement first. Posting a large set of financial
entries as a side effect of a deploy is not acceptable.

**Bank rail payouts have no dispatcher adapter.** Airtel is implemented; bank
transfers are settled manually and the dispatcher fails them explicitly and
retryably rather than skipping them silently.

## Consequences

- Rolling back a bad cutover is `UPDATE platform_settings SET escrow_mode =
  'dual_write'`. No deploy, no migration.
- Every existing merchant must verify their payout details before they can take
  a collection under `escrow_v2`. This needs an outreach plan, not a default.
- Senders who hold wallet credit at cutover keep it: the guard blocks new
  credit, not existing balances. Draining them is a migration task with its own
  plan.
- `REFUND_PENDING` is the one place value rests with no active counterparty. It
  needs a written unclaimed-funds policy before launch — see §10 of the model
  and the open questions below.

## Open questions, owned elsewhere

| Question | Blocked on |
|---|---|
| Trust deed structure for the segregated account | Zambian financial services lawyer |
| Whether this structure requires a BoZ licence | Lawyer, then a written approach to BoZ |
| Unclaimed funds policy after failed refunds | Lawyer |
| Airtel per-transaction disbursement tariff — is instant-at-scan viable on small items? | Airtel commercial conversation |
| MTN MoMo as a second payout rail | Merchant mix once recruiting begins |
| Redemption window: 14 days | Product decision; shorter reduces float and expiry handling |

None of these block the code. All of them block the cutover.
