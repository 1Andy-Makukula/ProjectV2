// Format amount in currency to display format
export function formatCurrency(amount: number, currency: string = 'ZMW'): string {
  // Values are stored as whole ZMW in the database, no need to divide by 100.
  return `${currency} ${amount.toFixed(2)}`;
}

// Convert display amount to lowest unit for storage (legacy, returns same amount now)
export function toCents(amount: number): number {
  return Math.round(amount);
}
