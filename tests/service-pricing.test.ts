import { describe, it, expect } from 'vitest';
import { requiresConversation, servicePriceLabel } from '../src/app/types/items';

// These must agree with items_price_is_minimum_check, which enforces that a
// minimum price only exists on a service that also accepts custom quotes. If
// the label appeared without that quote route, the buyer would see "From K250"
// with no way to discover the real figure — the exact confusion the flag was
// added to remove.
describe('servicePriceLabel', () => {
  it('renders a plain price for an ordinary item', () => {
    expect(servicePriceLabel({ price_is_minimum: false, allow_custom_quote: false }))
      .toEqual({ prefix: null, note: null });
  });

  it('renders a plain price for a quotable item with no declared minimum', () => {
    expect(servicePriceLabel({ price_is_minimum: false, allow_custom_quote: true }))
      .toEqual({ prefix: null, note: null });
  });

  it('marks the price as a floor when a minimum is declared', () => {
    const label = servicePriceLabel({ price_is_minimum: true, allow_custom_quote: true });
    expect(label.prefix).toBe('From');
    expect(label.note).toMatch(/minimum service fee/i);
  });

  it('suppresses the label when there is no quote route to the real price', () => {
    // Should be unreachable through the database constraint; the guard exists
    // for rows written before it, and for the admin form's optimistic state.
    expect(servicePriceLabel({ price_is_minimum: true, allow_custom_quote: false }))
      .toEqual({ prefix: null, note: null });
  });

  it('treats missing flags as an ordinary price', () => {
    expect(servicePriceLabel({})).toEqual({ prefix: null, note: null });
    expect(servicePriceLabel({ price_is_minimum: null, allow_custom_quote: null }))
      .toEqual({ prefix: null, note: null });
  });
});

// A minimum price does not change whether the item can go straight to the cart:
// it is still quote-enabled work that needs its terms read first.
describe('requiresConversation is unaffected by a minimum price', () => {
  it('still routes a quotable service through the detail view', () => {
    expect(
      requiresConversation({
        item_type: 'service',
        requires_scheduling: false,
        allow_custom_quote: true,
      }),
    ).toBe(true);
  });

  it('leaves a plain product addable to the cart', () => {
    expect(
      requiresConversation({
        item_type: 'product',
        requires_scheduling: false,
        allow_custom_quote: false,
      }),
    ).toBe(false);
  });
});
