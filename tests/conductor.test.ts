import { describe, it, expect } from 'vitest';
import {
  CONDUCTOR,
  phaseOffset,
  selectBudgeted,
  slotAt,
  subscribe,
} from '../src/app/reco/conductor';

// The Conductor is what stops forty tiles becoming forty timers firing at forty
// unrelated moments. Its value is in properties that are invisible when they
// work and obvious when they break: the wave, the budget, and the refusal to
// move anything off screen.
//
// Those are all arithmetic, so they are tested as arithmetic. The suite runs in
// node with no DOM, which is the right constraint rather than a limitation --
// a test that fakes `matchMedia` to assert a scheduling rule is testing the
// fake. The browser half (timers, visibility, reduced motion) is a thin shell
// over what is checked here.

describe('phase offsets spread the wave', () => {
  it('gives the same id the same place, every time', () => {
    // A shop that rearranged itself between visits would feel broken rather
    // than alive, and that rests entirely on this being deterministic.
    const id = '4f1a2b3c-0000-0000-0000-000000000001';
    expect(phaseOffset(id)).toBe(phaseOffset(id));
  });

  it('keeps every offset inside one cycle', () => {
    for (let i = 0; i < 200; i++) {
      const offset = phaseOffset(`item-${i}`);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(1);
    }
  });

  it('separates uuids that differ only at the end', () => {
    // Real ids from one insert are near-identical strings. If those landed in
    // step, neighbouring tiles would change together and the wave would be a
    // flash -- the failure this hash was chosen to avoid.
    const base = '4f1a2b3c-0000-0000-0000-00000000000';
    const offsets = Array.from({ length: 10 }, (_, i) => phaseOffset(`${base}${i}`));
    const buckets = new Set(offsets.map((o) => Math.floor(o * 10)));
    expect(buckets.size).toBeGreaterThanOrEqual(5);
  });

  it('spreads a large population across the whole cycle', () => {
    const offsets = Array.from({ length: 500 }, (_, i) => phaseOffset(`id-${i}`));
    const buckets = new Set(offsets.map((o) => Math.floor(o * 10)));
    expect(buckets.size).toBe(10);
  });
});

describe('slots advance', () => {
  it('stays on the cover when there is nothing to cycle', () => {
    // The common case by far: one photograph, no gallery.
    expect(slotAt(Date.now(), 0.4, 1)).toBe(0);
    expect(slotAt(Date.now(), 0.4, 0)).toBe(0);
  });

  it('visits every picture across a cycle, and only those', () => {
    const slots = 5;
    const seen = new Set<number>();
    for (let t = 0; t < CONDUCTOR.CYCLE_MS; t += 100) {
      const slot = slotAt(t, 0, slots);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(slots);
      seen.add(slot);
    }
    expect(seen.size).toBe(slots);
  });

  it('puts two tiles on different pictures at the same moment', () => {
    // This is the wave. Same instant, different offsets, different pictures.
    const now = 1_000_000;
    const a = slotAt(now, 0.0, 4);
    const b = slotAt(now, 0.5, 4);
    expect(a).not.toBe(b);
  });

  it('is stable for the same inputs', () => {
    const now = 1_234_567;
    expect(slotAt(now, 0.3, 4)).toBe(slotAt(now, 0.3, 4));
  });
});

describe('the motion budget', () => {
  const tile = (offset: number, visible: boolean) => ({ offset, visible });

  it('never lets more than the budget move at once', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => tile(i / 20, true));
    expect(selectBudgeted(candidates).length).toBe(CONDUCTOR.MOTION_BUDGET);
  });

  it('ignores anything off screen, however much is subscribed', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => tile(i / 20, false));
    expect(selectBudgeted(candidates)).toEqual([]);
  });

  it('spends the budget only on what is visible', () => {
    const candidates = [tile(0.9, false), tile(0.1, true), tile(0.5, false), tile(0.2, true)];
    const chosen = selectBudgeted(candidates);
    expect(chosen.every((c) => c.visible)).toBe(true);
    expect(chosen.length).toBe(2);
  });

  it('chooses by offset, so the permitted few are spread through the cycle', () => {
    // Insertion order would put three neighbours in step; offset order does
    // not, which is what keeps even the budgeted handful from flashing together.
    const candidates = [tile(0.8, true), tile(0.1, true), tile(0.4, true), tile(0.9, true)];
    const chosen = selectBudgeted(candidates, 3).map((c) => c.offset);
    expect(chosen).toEqual([0.1, 0.4, 0.8]);
  });
});

describe('subscribing outside a browser', () => {
  it('is inert rather than throwing', () => {
    // Server rendering and this very test suite both import the module. It has
    // to be safe to call with no window at all.
    const handle = subscribe('ssr', 5, () => {});
    expect(() => handle.setVisible(true)).not.toThrow();
    expect(() => handle.unsubscribe()).not.toThrow();
  });

  it('refuses a single-picture subscription outright', () => {
    let called = false;
    const handle = subscribe('single', 1, () => {
      called = true;
    });
    handle.setVisible(true);
    expect(called).toBe(false);
    handle.unsubscribe();
  });
});
