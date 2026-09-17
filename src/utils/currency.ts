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
  //
  // Grouped in threes. This was the one behaviour the older `formatZMW` in
  // app/utils/formatters.ts had that this function did not, and it is the
  // better of the two: a checkout total reading "ZMW 12500.00" is materially
  // harder to check at a glance than "ZMW 12,500.00". Folding it in here is
  // what lets the two formatters become one.
  //
  // Done with a regex rather than toLocaleString because the separator must not
  // depend on the viewer's locale -- several European locales would render this
  // as "12.500,00", and a price is not a place to surprise anyone.
  const fixed = (parsed / 100).toFixed(2);
  return `${currency} ${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Convert display amount to lowest unit (ngwee) for storage
export function toCents(amountInZmw: number): number {
  if (!amountInZmw || isNaN(Number(amountInZmw))) return 0;
  return Math.round(Number(amountInZmw) * 100);
}

