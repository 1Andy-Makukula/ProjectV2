// Format amount in lowest currency unit (ngwee) to display format
export function formatCurrency(amount: number, currency: string = 'ZMW'): string {
  const displayAmount = amount / 100; // Convert from ngwee to kwacha
  return `${currency} ${displayAmount.toFixed(2)}`;
}

// Convert display amount to lowest unit for storage
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
