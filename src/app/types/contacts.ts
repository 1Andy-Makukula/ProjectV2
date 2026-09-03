// Shared vocabulary for contacts.
//
// A contact is a person the user sends things to: a name, a number, and
// optionally the day their birthday falls on. Private to whoever saved it.

export interface Contact {
  id: string;
  name: string;
  /** E.164, matching how recipient numbers are stored on orders. */
  phone: string;
  /** Free text — "Mum", "my landlord". Never a fixed list. */
  relationship: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  /** Optional on purpose: a birthday is a day, an age is a disclosure. */
  birthYear: number | null;
  source: 'manual' | 'order' | 'import';
  notes: string | null;
  created_at: string;
}

export interface ContactDraft {
  name: string;
  phone: string;
  relationship?: string;
  birthMonth?: number | null;
  birthDay?: number | null;
  birthYear?: number | null;
}

/** Somebody already sent to, offered back for saving. */
export interface ContactSuggestion {
  name: string;
  phone: string;
  lastSentAt: string;
  timesSent: number;
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** How many days that month has, counted in a leap year so the 29th survives. */
export function daysInMonth(month: number): number {
  return new Date(2000, month, 0).getDate();
}

/** "14 March", or null when no birthday was recorded. */
export function birthdayLabel(contact: Pick<Contact, 'birthMonth' | 'birthDay'>): string | null {
  if (!contact.birthMonth || !contact.birthDay) return null;
  return `${contact.birthDay} ${MONTHS[contact.birthMonth - 1]}`;
}

/**
 * Days until the next time that birthday comes round.
 *
 * Counted in whole local days rather than by subtracting timestamps, so a
 * birthday tomorrow morning reads as 1 rather than 0 because it happens to be
 * late at night now. Returns null when there is no birthday to count to.
 */
export function daysUntilBirthday(
  contact: Pick<Contact, 'birthMonth' | 'birthDay'>,
  today: Date = new Date(),
): number | null {
  if (!contact.birthMonth || !contact.birthDay) return null;

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  /*
   * The 29th of February in a common year is marked on the 1st of March.
   *
   * Rolling forward rather than clamping back to the 28th: a birthday should
   * never be announced before the date it actually falls on, and "today" on
   * the 28th would be wrong two years in three. Telling someone their friend
   * simply has no birthday this year is not an option either.
   */
  const dayThisYear = (year: number) => {
    const month = contact.birthMonth! - 1;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return contact.birthDay! > lastDay
      ? new Date(year, month + 1, 1)
      : new Date(year, month, contact.birthDay!);
  };

  let next = dayThisYear(startOfToday.getFullYear());
  if (next < startOfToday) next = dayThisYear(startOfToday.getFullYear() + 1);

  return Math.round((next.getTime() - startOfToday.getTime()) / 86_400_000);
}

/** "Today", "Tomorrow", "In 9 days" — the way a person would say it. */
export function countdownLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 31) return `In ${days} days`;

  const months = Math.round(days / 30);
  return `In ${months} month${months === 1 ? '' : 's'}`;
}

/**
 * The birthdays worth putting on the storefront, soonest first.
 *
 * Windowed rather than showing all of them: a birthday eight months out is not
 * something to act on today, and a rail that lists everyone is a rail nobody
 * reads.
 */
export function upcomingBirthdays(
  contacts: Contact[],
  withinDays = 60,
  today: Date = new Date(),
): Array<{ contact: Contact; days: number }> {
  return contacts
    .map((contact) => ({ contact, days: daysUntilBirthday(contact, today) }))
    .filter(
      (entry): entry is { contact: Contact; days: number } =>
        entry.days !== null && entry.days <= withinDays,
    )
    .sort((a, b) => a.days - b.days);
}
