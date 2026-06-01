/**
 * timeHelpers.ts
 *
 * Expiration calculations for escrow vouchers.
 */

export interface CountdownState {
  text: string;
  isUrgent: boolean;
  isExpired: boolean;
}

/**
 * Calculates remaining time until a voucher expires.
 * Vouchers expire exactly ttlDays (default: 30) after creation.
 *
 * @param createdAt - ISO string or Date string when the voucher was created
 * @param ttlDays - The number of days the voucher is locked before returning (default: 30)
 */
export function calculateTimeRemaining(createdAt: string, ttlDays: number = 30): CountdownState {
  if (!createdAt) {
    return { text: 'Expired', isUrgent: false, isExpired: true };
  }

  const createdTime = new Date(createdAt).getTime();
  if (isNaN(createdTime)) {
    return { text: 'Expired', isUrgent: false, isExpired: true };
  }

  const expiryTime = createdTime + ttlDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const diffMs = expiryTime - now;

  if (diffMs <= 0) {
    return { text: 'Expired', isUrgent: false, isExpired: true };
  }

  const msInDay = 24 * 60 * 60 * 1000;
  const msInHour = 60 * 60 * 1000;

  const daysRemaining = Math.floor(diffMs / msInDay);
  const hoursRemaining = Math.floor(diffMs / msInHour);

  if (diffMs > msInDay) {
    // More than 1 day remaining
    const days = Math.max(1, daysRemaining);
    return {
      text: `Expires in ${days} day${days !== 1 ? 's' : ''}`,
      isUrgent: days <= 3,
      isExpired: false,
    };
  } else {
    // Less than 24 hours remaining
    const hours = Math.max(1, hoursRemaining);
    return {
      text: `Expires in ${hours} hour${hours !== 1 ? 's' : ''}`,
      isUrgent: true,
      isExpired: false,
    };
  }
}
