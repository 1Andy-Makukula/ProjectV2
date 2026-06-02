// Format amount in lowest unit (ngwee) to display format (ZMW)
export function formatCurrency(amountInNgwee: number | null | undefined, currency: string = 'ZMW'): string {
  if (amountInNgwee === null || amountInNgwee === undefined) {
    return `${currency} 0.00`;
  }
  const parsed = Number(amountInNgwee);
  if (isNaN(parsed)) {
    return `${currency} 0.00`;
  }
  // Values are stored as ngwee in the database, divide by 100 for ZMW.
  return `${currency} ${(parsed / 100).toFixed(2)}`;
}

// Convert display amount to lowest unit (ngwee) for storage
export function toCents(amountInZmw: number): number {
  if (!amountInZmw || isNaN(Number(amountInZmw))) return 0;
  return Math.round(Number(amountInZmw) * 100);
}

