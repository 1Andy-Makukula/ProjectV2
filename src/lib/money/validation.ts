/** Pure validation helpers for money paths (unit-tested). */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLAIM_CODE_RE = /^[A-Z0-9]{8}$/;

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
