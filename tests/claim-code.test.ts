/**
 * Claim code visibility on merchant surfaces.
 *
 * A claim code is a bearer instrument: whoever holds it can collect the goods.
 * A merchant who can read one off their own dashboard before the customer
 * arrives can hand the order to themselves, and the recipient turns up to find
 * their gift already collected.
 */
import { describe, expect, it } from 'vitest';
import { canRevealClaimCode, maskClaimCode, claimCodeForMerchant } from '../src/utils/claimCode';

const CODE = 'N02SK1AX';

describe('claim code masking', () => {
  describe('canRevealClaimCode', () => {
    it('withholds the code for every state before handover', () => {
      // These are the states in which the code still authorises a collection.
      for (const status of ['PENDING_PAYMENT', 'PENDING', 'PROCESSING_FULFILLMENT']) {
        expect(canRevealClaimCode(status), status).toBe(false);
      }
    });

    it('reveals it once the handover it authorises has happened', () => {
      for (const status of ['FULFILLED', 'PARTIAL_FULFILLMENT', 'REDEEMED']) {
        expect(canRevealClaimCode(status), status).toBe(true);
      }
    });

    it('withholds on unknown or absent status', () => {
      // Fails closed. A status nobody anticipated must not reveal a live code.
      expect(canRevealClaimCode(null)).toBe(false);
      expect(canRevealClaimCode(undefined)).toBe(false);
      expect(canRevealClaimCode('SOMETHING_NEW')).toBe(false);
    });
  });

  describe('maskClaimCode', () => {
    it('keeps the length and the last two characters', () => {
      expect(maskClaimCode(CODE)).toBe('••••••AX');
      expect(maskClaimCode(CODE)).toHaveLength(CODE.length);
    });

    it('never leaks the leading characters', () => {
      expect(maskClaimCode(CODE)).not.toContain('N02SK1');
    });

    it('handles absent and degenerate codes without exposing them', () => {
      expect(maskClaimCode(null)).toBe('••••••••');
      expect(maskClaimCode(undefined)).toBe('••••••••');
      expect(maskClaimCode('')).toBe('••••••••');
      expect(maskClaimCode('AB')).toBe('••••••••');
    });
  });

  describe('claimCodeForMerchant', () => {
    it('masks a live code and reveals a spent one', () => {
      expect(claimCodeForMerchant(CODE, 'PENDING')).toBe('••••••AX');
      expect(claimCodeForMerchant(CODE, 'REDEEMED')).toBe(CODE);
    });

    it('does not return the full code for any pre-handover state', () => {
      for (const status of ['PENDING_PAYMENT', 'PENDING', 'PROCESSING_FULFILLMENT', null]) {
        expect(claimCodeForMerchant(CODE, status), String(status)).not.toBe(CODE);
      }
    });
  });
});
