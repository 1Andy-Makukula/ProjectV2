/**
 * Order status derivation.
 *
 * This is the function that decides what a customer is told about their own
 * order, so its failure mode matters more than its happy path. It used to end
 * in a `return 'pending_payment'` catch-all, which meant every claim_status it
 * did not explicitly name displayed as "Pending" with a "Complete Payment"
 * button -- on orders that were paid, handed over, and partly refunded.
 *
 * Reported as order #cff033ed: transaction SUCCESS, twelve items COLLECTED,
 * two MISSING and refunded, claim_status PARTIAL_FULFILLMENT, dashboard asking
 * the customer to pay again.
 */
import { describe, expect, it } from 'vitest';
import { deriveStatus } from '../src/utils/orderStatus';

/** Every value shop_orders_claim_status_check admits. */
const ALL_CLAIM_STATUSES = [
  'PENDING_PAYMENT',
  'PENDING',
  'PROCESSING_FULFILLMENT',
  'PARTIAL_FULFILLMENT',
  'FULFILLED',
  'REDEEMED',
  'CANCELLED',
  'EXPIRED',
] as const;

describe('deriveStatus', () => {
  describe('the reported bug', () => {
    it('shows a partially fulfilled order as fulfilled, not as awaiting payment', () => {
      expect(deriveStatus('SUCCESS', 'PARTIAL_FULFILLMENT')).toBe('fulfilled');
    });

    it('never asks for payment on a transaction that already succeeded', () => {
      // The core invariant. A paid transaction must not produce
      // 'pending_payment' for ANY fulfilment state, because that is the string
      // that renders the "Complete Payment" button.
      for (const claim of ALL_CLAIM_STATUSES) {
        if (claim === 'PENDING_PAYMENT') continue; // genuinely unpaid
        expect(deriveStatus('SUCCESS', claim), `claim_status ${claim}`).not.toBe('pending_payment');
      }
    });

    it('does not fall back to pending_payment for an unknown claim status', () => {
      // The catch-all that caused this. A status nobody has taught it about
      // must not be reported as unpaid.
      expect(deriveStatus('SUCCESS', 'SOME_FUTURE_STATE')).toBe('paid');
      expect(deriveStatus('SUCCESS', null)).toBe('paid');
    });
  });

  describe('transaction state wins over fulfilment state', () => {
    it('reports an unpaid transaction as awaiting payment', () => {
      expect(deriveStatus('GATEWAY_PROCESSING', 'PENDING_PAYMENT')).toBe('pending_payment');
    });

    it('reports failed and cancelled transactions as cancelled', () => {
      expect(deriveStatus('FAILED', 'PENDING')).toBe('cancelled');
      // A released abandoned checkout: the transaction is cancelled even
      // though the shop_order may not have been flipped yet.
      expect(deriveStatus('CANCELLED', 'PENDING_PAYMENT')).toBe('cancelled');
    });

    it('reports an expired transaction as expired', () => {
      expect(deriveStatus('EXPIRED', 'PENDING')).toBe('expired');
    });
  });

  describe('fulfilment stages', () => {
    it('treats money-in-escrow states as paid', () => {
      expect(deriveStatus('SUCCESS', 'PENDING')).toBe('paid');
      expect(deriveStatus('SUCCESS', 'PROCESSING_FULFILLMENT')).toBe('paid');
    });

    it('treats every completed-handover state as fulfilled', () => {
      // fulfill_voucher_atomic writes FULFILLED or PARTIAL_FULFILLMENT, and
      // complete_redemption accepts both on the way to REDEEMED. They are the
      // same thing to a customer: the handover happened.
      expect(deriveStatus('SUCCESS', 'FULFILLED')).toBe('fulfilled');
      expect(deriveStatus('SUCCESS', 'PARTIAL_FULFILLMENT')).toBe('fulfilled');
      expect(deriveStatus('SUCCESS', 'REDEEMED')).toBe('fulfilled');
    });

    it('passes through terminal non-delivery states', () => {
      expect(deriveStatus('SUCCESS', 'CANCELLED')).toBe('cancelled');
      expect(deriveStatus('SUCCESS', 'EXPIRED')).toBe('expired');
    });
  });

  it('returns a value the status maps can render, for every reachable input', () => {
    // Guards the other half: a status the derivation emits but the UI has no
    // entry for renders as undefined rather than failing loudly.
    const txStatuses = ['GATEWAY_PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'];
    const known = ['pending_payment', 'paid', 'fulfilled', 'expired', 'cancelled'];

    for (const tx of txStatuses) {
      for (const claim of [...ALL_CLAIM_STATUSES, null]) {
        expect(known, `${tx} / ${claim}`).toContain(deriveStatus(tx, claim));
      }
    }
  });
});
