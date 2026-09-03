import { describe, it, expect } from 'vitest';
import {
  birthdayLabel,
  countdownLabel,
  daysInMonth,
  daysUntilBirthday,
  upcomingBirthdays,
  type Contact,
} from '../src/app/types/contacts';

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    name: 'Mum',
    phone: '+260971234567',
    relationship: 'Mum',
    birthMonth: 3,
    birthDay: 14,
    birthYear: null,
    source: 'manual',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Date arithmetic is where this feature quietly goes wrong: an off-by-one puts
// somebody's birthday reminder a day late, which is worse than not sending it.
describe('daysUntilBirthday', () => {
  it('counts whole days, not elapsed hours', () => {
    // Late at night, the day before. The answer is 1, not 0.
    const lateTonight = new Date(2026, 2, 13, 23, 30);
    expect(daysUntilBirthday(contact(), lateTonight)).toBe(1);
  });

  it('is zero on the day itself, whatever the hour', () => {
    expect(daysUntilBirthday(contact(), new Date(2026, 2, 14, 0, 1))).toBe(0);
    expect(daysUntilBirthday(contact(), new Date(2026, 2, 14, 23, 59))).toBe(0);
  });

  it('rolls into next year once the day has passed', () => {
    const dayAfter = new Date(2026, 2, 15, 9, 0);
    expect(daysUntilBirthday(contact(), dayAfter)).toBe(364);
  });

  it('marks a 29 February birthday on 1 March in a common year', () => {
    const leapling = contact({ birthMonth: 2, birthDay: 29 });
    // 2027 is not a leap year, so the 28th is the last day of February.
    const feb27 = new Date(2027, 1, 27);
    expect(daysUntilBirthday(leapling, feb27)).toBe(2);
  });

  it('keeps 29 February on the day itself in a leap year', () => {
    const leapling = contact({ birthMonth: 2, birthDay: 29 });
    expect(daysUntilBirthday(leapling, new Date(2028, 1, 29))).toBe(0);
  });

  it('is null for somebody with no birthday recorded', () => {
    expect(daysUntilBirthday(contact({ birthMonth: null, birthDay: null }))).toBeNull();
  });
});

describe('upcomingBirthdays', () => {
  it('windows, sorts soonest first, and drops anyone without a date', () => {
    const today = new Date(2026, 2, 1);
    const soon = contact({ id: 'soon', birthMonth: 3, birthDay: 5 });
    const later = contact({ id: 'later', birthMonth: 4, birthDay: 2 });
    const farOff = contact({ id: 'far', birthMonth: 11, birthDay: 20 });
    const undated = contact({ id: 'none', birthMonth: null, birthDay: null });

    const result = upcomingBirthdays([farOff, later, undated, soon], 60, today);
    expect(result.map((entry) => entry.contact.id)).toEqual(['soon', 'later']);
  });
});

describe('labels', () => {
  it('reads a birthday the way a person would say it', () => {
    expect(birthdayLabel(contact())).toBe('14 March');
    expect(birthdayLabel(contact({ birthMonth: null, birthDay: null }))).toBeNull();
  });

  it('names the near days rather than counting them', () => {
    expect(countdownLabel(0)).toBe('Today');
    expect(countdownLabel(1)).toBe('Tomorrow');
    expect(countdownLabel(9)).toBe('In 9 days');
    expect(countdownLabel(60)).toBe('In 2 months');
  });

  it('knows February has 29 days to offer', () => {
    // The picker must let a leapling be entered at all.
    expect(daysInMonth(2)).toBe(29);
    expect(daysInMonth(4)).toBe(30);
    expect(daysInMonth(12)).toBe(31);
  });
});
