// Buyer-facing pricing.
//
// The server is authoritative — `checkout_init_atomic` recomputes the fee from
// `platform_settings` and prices the basket from the database, never from the
// client. These helpers exist so the checkout screen shows the buyer the same
// number they will actually be charged, and must stay in step with the SQL:
// both round half-up on the basket total.

export type OriginType = 'LOCAL' | 'INTERNATIONAL';

/**
 * The origin the checkout flow currently sends. `checkout-init` is hardcoded to
 * LOCAL today; the INTERNATIONAL rate is live server-side and applies as soon
 * as an origin selector sets it.
 */
export const CHECKOUT_ORIGIN: OriginType = 'LOCAL';

export interface PlatformFeeRates {
  local: number;
  international: number;
}

/** Matches the column defaults, used until the live rates load. */
export const DEFAULT_FEE_RATES: PlatformFeeRates = {
  local: 8,
  international: 10,
};

/**
 * Deducted from the merchant's settlement. Mirrors
 * `platform_settings.merchant_fee_percent`, which is authoritative.
 */
export const MERCHANT_FEE_PERCENT = 2;

export function feePercentFor(origin: OriginType, rates: PlatformFeeRates): number {
  return origin === 'INTERNATIONAL' ? rates.international : rates.local;
}

/** Service fee in ngwee. Mirrors `round(subtotal * pct / 100.0)` in Postgres. */
export function serviceFeeFor(
  subtotalNgwee: number,
  origin: OriginType,
  rates: PlatformFeeRates,
): number {
  if (!Number.isFinite(subtotalNgwee) || subtotalNgwee <= 0) return 0;
  return Math.round((subtotalNgwee * feePercentFor(origin, rates)) / 100);
}

/**
 * What the buyer owes before any wallet credits: the basket plus the fee.
 * Credits are capped against this, not against the basket alone.
 */
export function grossPayableFor(
  subtotalNgwee: number,
  origin: OriginType,
  rates: PlatformFeeRates,
): number {
  return subtotalNgwee + serviceFeeFor(subtotalNgwee, origin, rates);
}

export interface CreditsApplication {
  creditsToApply: number;
  finalPayable: number;
}

/**
 * The one place "how much wallet credit gets applied" is computed. Credits
 * are capped against the gross payable (basket + fee), matching
 * `checkout_init_atomic` server-side — capping against the basket alone
 * understates how much can be applied and disagrees with what's charged.
 */
export function creditsApplicationFor(
  subtotalNgwee: number,
  origin: OriginType,
  rates: PlatformFeeRates,
  walletBalance: number,
  applyCredits: boolean,
): CreditsApplication {
  const grossPayable = grossPayableFor(subtotalNgwee, origin, rates);
  const creditsToApply = applyCredits ? Math.min(Math.max(walletBalance, 0), grossPayable) : 0;
  return { creditsToApply, finalPayable: grossPayable - creditsToApply };
}
