/** Pure validation helpers for money paths (unit-tested). */

// RFC-strict: versions 1-5, variants 8/9/a/b. The money-path Edge Functions
// (fulfill-voucher, flutterwave-webhook) use a permissive any-hex form instead.
// The two agree on everything Postgres actually mints -- gen_random_uuid() is
// v4 -- so the difference is theoretical, and this file deliberately keeps the
// strict form because the call site it replaces was strict. Reconciling the two
// dialects means loosening `_shared/auth.ts`, which is an auth path and wants
// its own review.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Two shapes are redeemable, and both must be accepted here or this helper
// silently breaks a live path:
//
//   AB12CD34      a per-shop claim code, from gen_claim_code(8)
//   1234-567890   a transaction public code, one buyer-facing code for a whole
//                 multi-shop order (20260807060000_transaction_public_code.sql)
//
// This mirrors the regex in supabase/functions/fulfill-voucher/index.ts, which
// is the server that ultimately decides. Narrowing it to the 8-character form
// would reject every public code.
const CLAIM_CODE_RE = /^(?:[A-Z0-9]{8}|[A-Z0-9]{4}-[A-Z0-9]{6})$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function normalizeClaimCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CLAIM_CODE_RE.test(code) ? code : null;
}

export function partitionItemIds(
  present: string[],
  missing: string[],
): { ok: true } | { ok: false; reason: string } {
  if (present.length === 0 && missing.length === 0) {
    return { ok: false, reason: 'At least one item must be present or missing.' };
  }
  const presentSet = new Set(present);
  for (const id of missing) {
    if (presentSet.has(id)) {
      return { ok: false, reason: `Item '${id}' appears in both present and missing lists.` };
    }
  }
  return { ok: true };
}

export function resolveTransactionLookupKey(txRef: string): 'transaction_id' | 'gateway_tx_ref' {
  return isUuid(txRef) ? 'transaction_id' : 'gateway_tx_ref';
}
