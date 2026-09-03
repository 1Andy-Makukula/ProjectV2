import { describe, it, expect } from 'vitest';
import {
  countdownLabel,
  daysInMonth,
  daysUntil,
  occasionTitle,
  occasionWhen,
  upcomingOccasions,
  type Contact,
  type Occasion,
} from '../src/app/types/contacts';

function occasion(overrides: Partial<Occasion> = {}): Occasion {
  return {
    id: 'o1',
    contact_id: 'c1',
    kind: 'birthday',
    label: null,
    recurrence: 'annual',
    month: 3,
    day: 14,
    year: null,
    notes: null,
    ...overrides,
  };
}

function contact(occasions: Occasion[], overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    name: 'Mum',
    phone: '+260971234567',
    relationship: 'Mum',
    source: 'manual',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    occasions,
    ...overrides,
  };
}

// Date arithmetic is where this feature quietly goes wrong: an off-by-one puts
// somebody's reminder a day late, which is worse than not sending it.
describe('daysUntil — every year', () => {
  it('counts whole days, not elapsed hours', () => {
    expect(daysUntil(occasion(), new Date(2026, 2, 13, 23, 30))).toBe(1);
  });

  it('is zero on the day itself, whatever the hour', () => {
    expect(daysUntil(occasion(), new Date(2026, 2, 14, 0, 1))).toBe(0);
    expect(daysUntil(occasion(), new Date(2026, 2, 14, 23, 59))).toBe(0);
  });

  it('rolls into next year once the day has passed', () => {
    expect(daysUntil(occasion(), new Date(2026, 2, 15, 9, 0))).toBe(364);
  });

  it('marks a 29 February date on 1 March in a common year', () => {
    const leapling = occasion({ month: 2, day: 29 });
    expect(daysUntil(leapling, new Date(2027, 1, 27))).toBe(2);
  });

  it('keeps 29 February on the day itself in a leap year', () => {
    const leapling = occasion({ month: 2, day: 29 });
    expect(daysUntil(leapling, new Date(2028, 1, 29))).toBe(0);
  });
});

describe('daysUntil — every month', () => {
  const groceries = occasion({ kind: 'groceries', recurrence: 'monthly', month: null, day: 3 });

  it('finds this month when the day is still ahead', () => {
    expect(daysUntil(groceries, new Date(2026, 5, 1))).toBe(2);
  });

  it('rolls to next month once the day has gone', () => {
    // 4 June -> 3 July is 29 days.
    expect(daysUntil(groceries, new Date(2026, 5, 4))).toBe(29);
  });

  it('is zero on the day', () => {
    expect(daysUntil(groceries, new Date(2026, 5, 3, 18))).toBe(0);
  });

  it('rolls a 31st forward in a short month rather than back', () => {
    const rent = occasion({ kind: 'rent', recurrence: 'monthly', month: null, day: 31 });
    // June has 30 days, so it lands on 1 July rather than being announced early.
    expect(daysUntil(rent, new Date(2026, 5, 15))).toBe(16);
  });
});

describe('daysUntil — just once', () => {
  const graduation = occasion({
    kind: 'graduation',
    recurrence: 'once',
    month: 11,
    day: 20,
    year: 2026,
  });

  it('counts down to the date', () => {
    expect(daysUntil(graduation, new Date(2026, 10, 18))).toBe(2);
  });

  it('is null once it has passed — history is not upcoming', () => {
    expect(daysUntil(graduation, new Date(2026, 10, 21))).toBeNull();
  });
});

describe('upcomingOccasions', () => {
  it('windows, sorts soonest first, and spans contacts', () => {
    const today = new Date(2026, 2, 1);
    const mum = contact([occasion({ id: 'soon', month: 3, day: 5 })]);
    const uncle = contact(
      [
        occasion({ id: 'later', month: 4, day: 2 }),
        occasion({ id: 'far', month: 11, day: 20 }),
      ],
      { id: 'c2', name: 'Uncle' },
    );

    const result = upcomingOccasions([uncle, mum], 60, today);
    expect(result.map((entry) => entry.occasion.id)).toEqual(['soon', 'later']);
    expect(result[0].contact.name).toBe('Mum');
  });

  it('lists every date a single person has, not just the first', () => {
    const today = new Date(2026, 2, 1);
    const busy = contact([
      occasion({ id: 'birthday', month: 3, day: 20 }),
      occasion({ id: 'groceries', recurrence: 'monthly', month: null, day: 4 }),
    ]);

    const result = upcomingOccasions([busy], 60, today);
    expect(result.map((entry) => entry.occasion.id)).toEqual(['groceries', 'birthday']);
  });
});

describe('labels', () => {
  it('falls back to the kind, and prefers what the owner called it', () => {
    expect(occasionTitle(occasion())).toBe('Birthday');
    expect(occasionTitle(occasion({ label: "Mum's 60th" }))).toBe("Mum's 60th");
  });

  it('says when in the form that suits the recurrence', () => {
    expect(occasionWhen(occasion())).toBe('14 March');
    expect(occasionWhen(occasion({ recurrence: 'monthly', month: null, day: 3 }))).toBe(
      '3rd of each month',
    );
    expect(
      occasionWhen(occasion({ recurrence: 'once', month: 11, day: 20, year: 2026 })),
    ).toBe('20 November 2026');
  });

  it('gets its ordinals right, including the teens', () => {
    expect(occasionWhen(occasion({ recurrence: 'monthly', month: null, day: 1 }))).toContain('1st');
    expect(occasionWhen(occasion({ recurrence: 'monthly', month: null, day: 2 }))).toContain('2nd');
    expect(occasionWhen(occasion({ recurrence: 'monthly', month: null, day: 11 }))).toContain('11th');
    expect(occasionWhen(occasion({ recurrence: 'monthly', month: null, day: 22 }))).toContain('22nd');
  });

  it('names the near days rather than counting them', () => {
    expect(countdownLabel(0)).toBe('Today');
    expect(countdownLabel(1)).toBe('Tomorrow');
    expect(countdownLabel(9)).toBe('In 9 days');
    expect(countdownLabel(60)).toBe('In 2 months');
  });

  it('knows February has 29 days to offer', () => {
    expect(daysInMonth(2)).toBe(29);
    expect(daysInMonth(4)).toBe(30);
    expect(daysInMonth(12)).toBe(31);
  });
});
