import { describe, it, expect } from 'vitest';
import {
  aliveness,
  currentWeight,
  nextDelayMs,
  pickNext,
  statementKey,
  statementText,
  type PulseStatement,
} from '../src/app/reco/pulse';

// The Pulse is the one part of the aliveness work where a bug is an honesty
// problem rather than a rendering one. The buffer must only ever DELAY -- never
// invent a statement, never inflate a count, never emit one it was not given --
// and it must be willing to say nothing at all. Those are the properties pinned
// here.

const statement = (over: Partial<PulseStatement> = {}): PulseStatement => ({
  kind: 'collected',
  subject: 'Mama Africa',
  quantity: 7,
  window_days: 7,
  weight: 1,
  ...over,
});

describe('decay', () => {
  it('is full value the moment it arrives', () => {
    expect(aliveness(statement(), 0)).toBe(1);
  });

  it('halves over the kind’s half-life', () => {
    // Collections are warm for about six hours.
    expect(aliveness(statement({ kind: 'collected' }), 6 * 3600_000)).toBeCloseTo(0.5, 5);
  });

  it('lets different kinds go stale at different rates', () => {
    const age = 24 * 3600_000;
    const collected = aliveness(statement({ kind: 'collected' }), age);
    const journeys = aliveness(statement({ kind: 'journeys' }), age);
    // A day-old collection is furniture; a day-old journey is still news.
    expect(journeys).toBeGreaterThan(collected);
  });

  it('never lets “open right now” go stale', () => {
    // It is not an event. It is true at this minute or it is not.
    expect(aliveness(statement({ kind: 'open_now' }), 30 * 86_400_000)).toBe(1);
  });

  it('never goes negative or above full', () => {
    for (const age of [-1000, 0, 1000, 86_400_000, 30 * 86_400_000]) {
      const value = aliveness(statement(), age);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('pacing', () => {
  const steady = () => 0.5;

  it('waits longer when there is less to say', () => {
    const thin = nextDelayMs(1, { jitter: steady });
    const full = nextDelayMs(10, { jitter: steady });
    // A thin pool slows down rather than repeating itself.
    expect(thin).toBeGreaterThan(full);
  });

  it('never goes below the floor, whatever the jitter does', () => {
    for (const j of [0, 0.25, 0.5, 0.75, 1]) {
      expect(nextDelayMs(20, { jitter: () => j, minGapMs: 4000 })).toBeGreaterThanOrEqual(4000);
    }
  });

  it('varies, so it does not read as a carousel', () => {
    const low = nextDelayMs(6, { jitter: () => 0 });
    const high = nextDelayMs(6, { jitter: () => 1 });
    expect(low).not.toBe(high);
  });

  it('waits the longest when there is nothing at all', () => {
    expect(nextDelayMs(0, { jitter: steady })).toBe(11_000);
  });
});

describe('choosing what to say', () => {
  const fresh = () => 0;

  it('says nothing when there is nothing', () => {
    expect(pickNext([], new Set(), fresh)).toBeNull();
  });

  it('says nothing rather than something stale', () => {
    // Everything has decayed past meaning. Reaching for the least-dead
    // statement would be exactly the dishonesty this feature avoids.
    const old = [statement({ kind: 'collected' })];
    const ancient = () => 365 * 86_400_000;
    expect(pickNext(old, new Set(), ancient)).toBeNull();
  });

  it('only ever returns something it was given', () => {
    // The buffer cannot invent. This is the property the whole ethics rests on.
    const pool = [statement({ subject: 'A' }), statement({ subject: 'B' })];
    for (let i = 0; i < 50; i++) {
      const picked = pickNext(pool, new Set(), fresh, () => i / 50);
      expect(pool).toContain(picked);
    }
  });

  it('does not repeat what was just said', () => {
    const pool = [statement({ subject: 'A' }), statement({ subject: 'B' })];
    const justSaid = new Set([statementKey(pool[0])]);
    expect(pickNext(pool, justSaid, fresh)).toBe(pool[1]);
  });

  it('repeats rather than falling silent once everything is used', () => {
    // Going quiet because the memory is full would be worse than a repeat.
    const pool = [statement({ subject: 'A' })];
    const allSaid = new Set([statementKey(pool[0])]);
    expect(pickNext(pool, allSaid, fresh)).toBe(pool[0]);
  });

  it('favours the heavier statement over many draws', () => {
    const pool = [
      statement({ subject: 'heavy', weight: 1 }),
      statement({ subject: 'light', weight: 0.1 }),
    ];
    let heavy = 0;
    for (let i = 0; i < 200; i++) {
      const picked = pickNext(pool, new Set(), fresh, () => i / 200);
      if (picked?.subject === 'heavy') heavy++;
    }
    expect(heavy).toBeGreaterThan(120);
    // ...but not always, or the strip would show one sentence until it decayed.
    expect(heavy).toBeLessThan(200);
  });
});

describe('what it says', () => {
  it('always speaks in counts, never about a person', () => {
    const texts = [
      statementText(statement({ kind: 'collected', quantity: 7 })),
      statementText(statement({ kind: 'saved', subject: 'Braai weekend', quantity: 4 })),
      statementText(statement({ kind: 'rated', quantity: 5 })),
      statementText(statement({ kind: 'journeys', subject: null, quantity: 3 })),
      statementText(statement({ kind: 'open_now', subject: null, quantity: 12 })),
    ];
    for (const text of texts) {
      expect(text).toMatch(/\d/);
    }
  });

  it('gets the grammar right for one', () => {
    // "1 people collected" is how a fake looks.
    expect(statementText(statement({ quantity: 1 }))).toContain('1 person');
    expect(statementText(statement({ quantity: 2 }))).toContain('2 people');
    expect(statementText(statement({ kind: 'journeys', quantity: 1 }))).toContain('1 new journey');
  });

  it('weights decay into the ordering rather than being ignored', () => {
    const a = currentWeight(statement({ weight: 1, kind: 'collected' }), 6 * 3600_000);
    const b = currentWeight(statement({ weight: 0.6, kind: 'collected' }), 0);
    // A half-decayed heavy statement should now sit below a fresh lighter one.
    expect(a).toBeLessThan(b);
  });
});
