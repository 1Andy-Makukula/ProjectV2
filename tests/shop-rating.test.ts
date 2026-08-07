import { describe, it, expect } from 'vitest';
import { shopRating } from '../src/app/types/shops';

// An unrated shop must render as nothing, never as a zero. It has not been
// judged badly — it has not been judged at all, and the verified badge and
// fulfilment count already speak for it.
describe('shopRating', () => {
  it('is null before anybody has rated', () => {
    expect(shopRating({ rating_count: 0, rating_sum: 0 })).toBeNull();
    expect(shopRating({})).toBeNull();
    expect(shopRating({ rating_count: null, rating_sum: null })).toBeNull();
  });

  it('averages to one decimal place', () => {
    expect(shopRating({ rating_count: 4, rating_sum: 18 })).toBe(4.5);
    expect(shopRating({ rating_count: 3, rating_sum: 13 })).toBe(4.3);
  });

  it('handles a single perfect rating', () => {
    expect(shopRating({ rating_count: 1, rating_sum: 5 })).toBe(5);
  });

  // rating_sum can only be 0 when every rating is 0, which the CHECK
  // constraint forbids — so this is a corrupt-data guard, not a real state.
  it('does not divide by a missing sum', () => {
    expect(shopRating({ rating_count: 3, rating_sum: 0 })).toBeNull();
  });
});
