import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FEE_RATES,
  feePercentFor,
  grossPayableFor,
  serviceFeeFor,
} from '../src/utils/pricing';

// These must agree with `checkout_init_atomic`, which recomputes the same
// figures server-side. A drift here means the checkout screen quotes the buyer
// one number and the gateway charges another.
describe('buyer-facing pricing', () => {
  it('adds 8 percent on a local basket', () => {
    // ZMW 100.00 expressed in ngwee.
    expect(serviceFeeFor(10000, 'LOCAL', DEFAULT_FEE_RATES)).toBe(800);
    expect(grossPayableFor(10000, 'LOCAL', DEFAULT_FEE_RATES)).toBe(10800);
  });

  it('adds 10 percent on an international basket', () => {
    expect(serviceFeeFor(10000, 'INTERNATIONAL', DEFAULT_FEE_RATES)).toBe(1000);
    expect(grossPayableFor(10000, 'INTERNATIONAL', DEFAULT_FEE_RATES)).toBe(11000);
  });

  it('rounds half-up, matching Postgres round()', () => {
    // 1234 * 8% = 98.72 -> 99
    expect(serviceFeeFor(1234, 'LOCAL', DEFAULT_FEE_RATES)).toBe(99);
    // 1250 * 8% = 100 exactly
    expect(serviceFeeFor(1250, 'LOCAL', DEFAULT_FEE_RATES)).toBe(100);
    // 1244 * 8% = 99.52 -> 100
    expect(serviceFeeFor(1244, 'LOCAL', DEFAULT_FEE_RATES)).toBe(100);
  });

  it('treats an empty or invalid basket as fee-free', () => {
    expect(serviceFeeFor(0, 'LOCAL', DEFAULT_FEE_RATES)).toBe(0);
    expect(serviceFeeFor(-100, 'LOCAL', DEFAULT_FEE_RATES)).toBe(0);
    expect(serviceFeeFor(Number.NaN, 'LOCAL', DEFAULT_FEE_RATES)).toBe(0);
  });

  it('honours configured rates over the defaults', () => {
    const rates = { local: 5, international: 12 };
    expect(feePercentFor('LOCAL', rates)).toBe(5);
    expect(feePercentFor('INTERNATIONAL', rates)).toBe(12);
    expect(serviceFeeFor(20000, 'INTERNATIONAL', rates)).toBe(2400);
  });

  it('leaves the merchant margin intact against real gateway costs', () => {
    // Local: 3% gateway on what the buyer actually pays; merchant keeps 98%.
    const basket = 10000;
    const buyerPays = grossPayableFor(basket, 'LOCAL', DEFAULT_FEE_RATES);
    const gatewayCost = buyerPays * 0.03;
    const merchantShare = Math.floor(basket * 0.98);
    expect(buyerPays - gatewayCost - merchantShare).toBeGreaterThan(0);

    // International: 4.8% on card payments.
    const buyerPaysIntl = grossPayableFor(basket, 'INTERNATIONAL', DEFAULT_FEE_RATES);
    expect(buyerPaysIntl - buyerPaysIntl * 0.048 - merchantShare).toBeGreaterThan(0);
  });
});
