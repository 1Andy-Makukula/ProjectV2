import { StatusFilter } from '../app/types/orders';

export function deriveStatus(txStatus: string, claimStatus: string | null): Exclude<StatusFilter, 'all'> {
  if (txStatus === 'GATEWAY_PROCESSING') return 'pending_payment';
  if (txStatus === 'FAILED' || txStatus === 'CANCELLED') return 'cancelled';
  if (claimStatus === 'REDEEMED' || claimStatus === 'FULFILLED') return 'fulfilled';
  if (claimStatus === 'PENDING') return 'paid';
  return 'pending_payment';
}

export const STATUS_COLORS: Record<string, string> = {
  fulfilled:       'bg-green-100 text-green-800 border-green-200',
  paid:            'bg-blue-100 text-blue-800 border-blue-200',
  pending_payment: 'bg-orange-100 text-orange-800 border-orange-200',
  expired:         'bg-red-100 text-red-800 border-red-200',
  cancelled:       'bg-red-100 text-red-800 border-red-200',
};

export const STATUS_LABELS: Record<string, string> = {
  fulfilled:       'Fulfilled',
  paid:            'Paid',
  pending_payment: 'Pending',
  expired:         'Expired',
  cancelled:       'Cancelled',
};
