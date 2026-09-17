import { describe, expect, it } from 'vitest';
import {
  isUuid,
  normalizeClaimCode,
  partitionItemIds,
  resolveTransactionLookupKey,
} from '../src/lib/money/validation';

describe('money validation', () => {
  it('recognises UUID transaction refs', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('KITHLY-123-ABC')).toBe(false);
  });

  it('normalises valid claim codes', () => {
    expect(normalizeClaimCode(' ab12cd34 ')).toBe('AB12CD34');
    expect(normalizeClaimCode('short')).toBeNull();
  });

  // The transaction public code is a second redeemable shape. It is not
  // hypothetical: fulfill-voucher accepts it, so a normaliser that rejected it
  // would turn a valid code into "invalid" before the server ever saw it.
  it('accepts the transaction public code shape', () => {
    expect(normalizeClaimCode(' 1234-567890 ')).toBe('1234-567890');
    expect(normalizeClaimCode('abcd-ef1234')).toBe('ABCD-EF1234');
  });

  it('still rejects codes of the wrong shape', () => {
    expect(normalizeClaimCode('AB12CD3')).toBeNull();     // 7 chars
    expect(normalizeClaimCode('AB12CD345')).toBeNull();   // 9 chars
    expect(normalizeClaimCode('123-4567890')).toBeNull(); // dash misplaced
    expect(normalizeClaimCode('AB12CD3!')).toBeNull();    // non-alphanumeric
  });

  it('rejects duplicate item ids across present/missing', () => {
    const result = partitionItemIds(['a'], ['a']);
    expect(result.ok).toBe(false);
  });

  it('chooses lookup column from tx ref shape', () => {
    expect(resolveTransactionLookupKey('550e8400-e29b-41d4-a716-446655440000')).toBe(
      'transaction_id',
    );
    expect(resolveTransactionLookupKey('KITHLY-1-ABC')).toBe('gateway_tx_ref');
  });
});
