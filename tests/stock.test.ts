import { describe, it, expect } from 'vitest';
import { isOutOfStock } from '../src/app/types/items';

// The single most important property in Phase 4: stock_quantity is nullable and
// NULL means "not tracked". Every item that existed before the migration has
// NULL, so if that ever read as out-of-stock the whole catalogue would show as
// sold out and checkout_init_atomic would refuse every basket.
describe('isOutOfStock', () => {
  it('treats an untracked item as always purchasable', () => {
    expect(isOutOfStock({})).toBe(false);
    expect(isOutOfStock({ stock_quantity: null })).toBe(false);
    expect(isOutOfStock({ stock_quantity: undefined })).toBe(false);
  });

  it('treats a tracked zero as out of stock', () => {
    expect(isOutOfStock({ stock_quantity: 0 })).toBe(true);
  });

  it('treats any positive count as in stock', () => {
    expect(isOutOfStock({ stock_quantity: 1 })).toBe(false);
    expect(isOutOfStock({ stock_quantity: 250 })).toBe(false);
  });

  // items_stock_quantity_check forbids negatives, but a stale client payload
  // must not read as "in stock" if one ever appeared.
  it('treats a negative count as out of stock', () => {
    expect(isOutOfStock({ stock_quantity: -1 })).toBe(true);
  });
});
