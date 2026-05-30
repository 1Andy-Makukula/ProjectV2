// Format amount in lowest unit (ngwee) to display format (ZMW)
export function formatCurrency(amountInNgwee: number, currency: string = 'ZMW'): string {
  // Values are stored as ngwee in the database, divide by 100 for ZMW.
  return `${currency} ${(amountInNgwee / 100).toFixed(2)}`;
}

// Convert display amount to lowest unit (ngwee) for storage
export function toCents(amountInZmw: number): number {
  return Math.round(amountInZmw * 100);
}
