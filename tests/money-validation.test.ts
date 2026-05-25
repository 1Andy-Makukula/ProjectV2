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
