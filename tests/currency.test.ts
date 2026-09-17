import { describe, expect, it } from 'vitest';
import { formatCurrency, toCents } from '../src/utils/currency';

// WHY THIS EXISTS
// ---------------
// formatCurrency is the single display formatter for money, with ~36 consumers.
// Until 2026-09-17 a second one existed -- `formatZMW` in app/utils/formatters.ts
// -- and the only behavioural difference between them was that formatZMW grouped
// thousands and this one did not. The two were merged by moving grouping here,
// which means every screen that already used formatCurrency changed appearance.
//
// These assertions pin that down, because the failure mode is silent: a total
// renders as "ZMW 12500.00" instead of "ZMW 12,500.00" and nothing throws.

describe('formatCurrency', () => {
  it('converts ngwee to kwacha', () => {
    expect(formatCurrency(100)).toBe('ZMW 1.00');
    expect(formatCurrency(12345)).toBe('ZMW 123.45');
    expect(formatCurrency(1)).toBe('ZMW 0.01');
  });

  it('groups thousands', () => {
    expect(formatCurrency(100000)).toBe('ZMW 1,000.00');
    expect(formatCurrency(125000)).toBe('ZMW 1,250.00');
    expect(formatCurrency(1234567890)).toBe('ZMW 12,345,678.90');
  });

  it('does not group the decimal part', () => {
    expect(formatCurrency(99999)).toBe('ZMW 999.99');
  });

  // Wallet ledger entries are signed, so the separator must not land after the
  // minus sign.
  it('groups negative amounts correctly', () => {
    expect(formatCurrency(-125000)).toBe('ZMW -1,250.00');
    expect(formatCurrency(-100)).toBe('ZMW -1.00');
  });

  it('honours a non-default currency label', () => {
    expect(formatCurrency(125000, 'GBP')).toBe('GBP 1,250.00');
  });

  it('degrades to zero rather than NaN', () => {
    expect(formatCurrency(null)).toBe('ZMW 0.00');
    expect(formatCurrency(undefined)).toBe('ZMW 0.00');
    expect(formatCurrency(Number('nonsense'))).toBe('ZMW 0.00');
  });

  it('round-trips through toCents', () => {
    expect(formatCurrency(toCents(1250))).toBe('ZMW 1,250.00');
  });
});
