import { describe, it, expect } from 'vitest';
import {
  ineffectiveTiers,
  nextTier,
  sortedTiers,
  unitPriceFor,
  type PriceTier,
} from '../src/app/types/items';

// These must agree with the `unit_price_for` SQL function, which is what
// checkout_init_atomic actually charges. A drift here means the cart quotes the
// buyer one total and the gateway takes another — the exact failure the old
// wholesale fields caused by being displayed but never applied.
//
// ZMW 250 / 200 / 175 expressed in ngwee.
const TIERS: PriceTier[] = [
  { min_quantity: 6, unit_price_zmw: 20000 },
  { min_quantity: 12, unit_price_zmw: 17500 },
  { min_quantity: 24, unit_price_zmw: 15000 },
];

const BASE = 25000;

describe('unitPriceFor', () => {
  it('charges the base price below the first break', () => {
    expect(unitPriceFor(BASE, TIERS, 1)).toBe(BASE);
    expect(unitPriceFor(BASE, TIERS, 5)).toBe(BASE);
  });

  it('applies a break exactly at its threshold', () => {
    expect(unitPriceFor(BASE, TIERS, 6)).toBe(20000);
    expect(unitPriceFor(BASE, TIERS, 12)).toBe(17500);
    expect(unitPriceFor(BASE, TIERS, 24)).toBe(15000);
  });

  it('holds a break until the next one is reached', () => {
    expect(unitPriceFor(BASE, TIERS, 11)).toBe(20000);
    expect(unitPriceFor(BASE, TIERS, 23)).toBe(17500);
    expect(unitPriceFor(BASE, TIERS, 1000)).toBe(15000);
  });

  it('falls back to the base price when there are no tiers', () => {
    expect(unitPriceFor(BASE, [], 50)).toBe(BASE);
    expect(unitPriceFor(BASE, null, 50)).toBe(BASE);
    expect(unitPriceFor(BASE, undefined, 50)).toBe(BASE);
  });

  // Mirrors MIN() in SQL: where several tiers qualify the buyer gets the
  // cheapest, so adding a tier can never make an order more expensive.
  it('takes the cheapest qualifying tier, not the highest threshold', () => {
    const awkward: PriceTier[] = [
      { min_quantity: 6, unit_price_zmw: 15000 },
      { min_quantity: 12, unit_price_zmw: 20000 },
    ];
    expect(unitPriceFor(BASE, awkward, 12)).toBe(15000);
  });

  it('is unaffected by the order tiers arrive in', () => {
    const shuffled = [TIERS[2], TIERS[0], TIERS[1]];
    expect(unitPriceFor(BASE, shuffled, 12)).toBe(17500);
  });

  it('treats a zero or negative quantity as one unit', () => {
    expect(unitPriceFor(BASE, TIERS, 0)).toBe(BASE);
    expect(unitPriceFor(BASE, TIERS, -3)).toBe(BASE);
  });
});

// A tier that is not cheaper is now refused at entry, by both the form and
// validate_price_tier — an accepted one still rendered on the storefront and in
// the cart's next-tier nudge, advertising bulk pricing dearer than buying
// singly.
//
// The cap in unit_price_for is kept regardless, and so are these tests: it
// should be unreachable, which is the point. It is the difference between a row
// that slipped through being inert and a buyer paying nearly four times the
// shelf price for a pack total typed into a per-unit field.
describe('a tier above the base price never overcharges', () => {
  it('falls back to the base price', () => {
    const packTotal: PriceTier[] = [{ min_quantity: 4, unit_price_zmw: 95000 }];
    expect(unitPriceFor(24999, packTotal, 4)).toBe(24999);
    expect(unitPriceFor(24999, packTotal, 100)).toBe(24999);
  });

  it('still honours a genuine discount alongside a bad tier', () => {
    const mixed: PriceTier[] = [
      { min_quantity: 6, unit_price_zmw: 20000 },
      { min_quantity: 12, unit_price_zmw: 95000 },
    ];
    expect(unitPriceFor(24999, mixed, 12)).toBe(20000);
  });
});

// Drives the block: anything this returns stops the save.
describe('ineffectiveTiers', () => {
  it('flags tiers that are not actually cheaper', () => {
    const tiers: PriceTier[] = [
      { min_quantity: 6, unit_price_zmw: 20000 },
      { min_quantity: 12, unit_price_zmw: 25000 },
      { min_quantity: 24, unit_price_zmw: 95000 },
    ];
    expect(ineffectiveTiers(25000, tiers).map((t) => t.min_quantity)).toEqual([12, 24]);
  });

  it('ignores a half-typed row with no price yet', () => {
    expect(ineffectiveTiers(25000, [{ min_quantity: 6, unit_price_zmw: 0 }])).toEqual([]);
  });

  it('is empty when every tier is a real discount', () => {
    expect(ineffectiveTiers(BASE, TIERS)).toEqual([]);
  });
});

describe('nextTier', () => {
  it('points at the next break the buyer has not reached', () => {
    expect(nextTier(TIERS, 1)?.min_quantity).toBe(6);
    expect(nextTier(TIERS, 6)?.min_quantity).toBe(12);
    expect(nextTier(TIERS, 11)?.min_quantity).toBe(12);
  });

  it('is null once the best price is reached', () => {
    expect(nextTier(TIERS, 24)).toBeNull();
    expect(nextTier(TIERS, 100)).toBeNull();
  });

  it('is null when there are no tiers', () => {
    expect(nextTier([], 3)).toBeNull();
    expect(nextTier(undefined, 3)).toBeNull();
  });
});

describe('sortedTiers', () => {
  it('orders by threshold and does not mutate the input', () => {
    const input = [TIERS[2], TIERS[0], TIERS[1]];
    const output = sortedTiers(input);
    expect(output.map((t) => t.min_quantity)).toEqual([6, 12, 24]);
    expect(input[0].min_quantity).toBe(24);
  });
});
