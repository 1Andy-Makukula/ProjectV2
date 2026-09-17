import { StatusFilter } from '../app/types/orders';

/**
 * The single source of truth for what an order looks like to a customer.
 *
 * This used to end in `return 'pending_payment'` as a catch-all, and three
 * pages carried their own copy of it. Every claim_status the switch below does
 * not name -- PROCESSING_FULFILLMENT, PARTIAL_FULFILLMENT, EXPIRED -- therefore
 * displayed as "Pending" with a "Complete Payment" button, on orders that were
 * paid, handed over, and in one case already refunded for the missing items.
 *
 * Order #cff033ed was the reported case: transaction SUCCESS, twelve items
 * COLLECTED, two MISSING and refunded to the buyer's wallet, sitting at
 * PARTIAL_FULFILLMENT -- and the dashboard asked the customer to pay again.
 *
 * Hence the default. An unrecognised claim_status on a transaction that has
 * NOT failed means the money is confirmed and only the fulfilment stage is
 * unknown, so the honest answer is 'paid'. Defaulting to 'pending_payment'
 * fails in the one direction that must never happen on a financial product:
 * telling someone who has paid that they have not.
 */
export function deriveStatus(txStatus: string, claimStatus: string | null): Exclude<StatusFilter, 'all'> {
  if (txStatus === 'GATEWAY_PROCESSING') return 'pending_payment';
  if (txStatus === 'FAILED' || txStatus === 'CANCELLED') return 'cancelled';
  if (txStatus === 'EXPIRED') return 'expired';

  switch (claimStatus) {
    // Payment has not landed yet; this is the only genuine "pay now" state.
    case 'PENDING_PAYMENT':
      return 'pending_payment';

    // Paid and with the merchant. PROCESSING_FULFILLMENT is the window while
    // they are picking the order; the funds are already in escrow.
    case 'PENDING':
    case 'PROCESSING_FULFILLMENT':
      return 'paid';

    // Handover is done. PARTIAL_FULFILLMENT is not a lesser state than
    // FULFILLED -- fulfill_voucher_atomic sets it when some items were
    // missing, having already refunded them, and complete_redemption accepts
    // the two interchangeably on the way to REDEEMED.
    case 'PARTIAL_FULFILLMENT':
    case 'FULFILLED':
    case 'REDEEMED':
      return 'fulfilled';

    case 'CANCELLED':
      return 'cancelled';
    case 'EXPIRED':
      return 'expired';

    default:
      return 'paid';
  }
}

export const STATUS_COLORS: Record<string, string> = {
  fulfilled:       'bg-ok-100 text-ok-800 border-ok-200',
  paid:            'bg-info-100 text-info-800 border-info-200',
  pending_payment: 'bg-brand-100 text-brand-800 border-brand-200',
  expired:         'bg-danger-100 text-danger-800 border-danger-200',
  cancelled:       'bg-danger-100 text-danger-800 border-danger-200',
};

export const STATUS_LABELS: Record<string, string> = {
  fulfilled:       'Fulfilled',
  paid:            'Paid',
  pending_payment: 'Pending',
  expired:         'Expired',
  cancelled:       'Cancelled',
};
