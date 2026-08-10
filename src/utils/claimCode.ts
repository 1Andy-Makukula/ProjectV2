/**
 * Claim codes are bearer instruments.
 *
 * Whoever holds the code can collect the goods -- src/utils/whatsapp.ts spells
 * this out, and it is why the code is masked in the ussd-gateway logs and why
 * send-notification no longer logs its full payload. The same reasoning applies
 * to the merchant's own screen: a shop that can read a code off a dashboard can
 * hand the order to itself, and the recipient turns up to find their gift gone.
 *
 * So the merchant sees the code only AFTER the handover it authorises. Before
 * that the code travels one way -- buyer to recipient to counter -- and the
 * merchant's job is to verify what is presented, not to look it up.
 */

/** Fulfilment states in which the code has already done its job. */
const SPENT_STATUSES = new Set(['FULFILLED', 'PARTIAL_FULFILLMENT', 'REDEEMED']);

/**
 * Whether a merchant may see the full code for an order in this state.
 *
 * True only once the handover has happened, when revealing it can no longer
 * authorise anything and it is useful as a reconciliation reference.
 */
export function canRevealClaimCode(claimStatus: string | null | undefined): boolean {
  return SPENT_STATUSES.has(claimStatus ?? '');
}

/**
 * The code with everything identifying removed but its shape.
 *
 * The last two characters are kept so a cashier can confirm they are looking
 * at the same order the customer is reading from, which is the one legitimate
 * reason to want the code before redemption. Two characters out of eight over
 * a 36-character alphabet leaves ~1.7 million possibilities, so it confirms
 * without enabling a guess.
 */
export function maskClaimCode(code: string | null | undefined): string {
  if (!code) return '••••••••';
  if (code.length <= 2) return '••••••••';
  return '•'.repeat(code.length - 2) + code.slice(-2);
}

/** The code as a merchant should see it for an order in this state. */
export function claimCodeForMerchant(
  code: string | null | undefined,
  claimStatus: string | null | undefined,
): string {
  return canRevealClaimCode(claimStatus) ? (code ?? '') : maskClaimCode(code);
}
