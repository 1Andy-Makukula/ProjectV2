// Shared vocabulary for contacts and the dates that make them worth keeping.
//
// A contact is a person you send things to. An occasion is a reason and a date:
// a birthday, a graduation, the monthly grocery run. One contact has many.

export interface Contact {
  id: string;
  name: string;
  /** E.164, matching how recipient numbers are stored on orders. */
  phone: string;
  /** Free text — "Mum", "my landlord". Never a fixed list. */
  relationship: string | null;
  source: 'manual' | 'order' | 'import';
  notes: string | null;
  created_at: string;
  occasions: Occasion[];
}

/**
 * How often a date comes round.
 *
 * This decides which parts of the date mean anything, which is why it is
 * stored rather than inferred: a monthly grocery run has a day and no month,
 * and a graduation has all three.
 */
export type Recurrence = 'annual' | 'monthly' | 'once';

/**
 * What kind of occasion it is.
 *
 * A closed list so it can be counted — "how many people track school fees" is
 * a question worth being able to answer — with `other` plus a free label as
 * the escape hatch, so the taxonomy never becomes a cage.
 */
export type OccasionKind =
  | 'birthday'
  | 'anniversary'
  | 'wedding'
  | 'graduation'
  | 'new_baby'
  | 'memorial'
  | 'holiday'
  | 'groceries'
  | 'school_fees'
  | 'upkeep'
  | 'rent'
  | 'medical'
  | 'other';

export interface Occasion {
  id: string;
  contact_id: string;
  kind: OccasionKind;
  /** Required for `other`; elsewhere it distinguishes two of the same kind. */
  label: string | null;
  recurrence: Recurrence;
  month: number | null;
  day: number;
  year: number | null;
  notes: string | null;
}

export interface OccasionDraft {
  kind: OccasionKind;
  label?: string;
  recurrence: Recurrence;
  month?: number | null;
  day: number;
  year?: number | null;
  notes?: string;
}

export interface ContactDraft {
  name: string;
  phone: string;
  relationship?: string;
  notes?: string;
}

/** Somebody already sent to, offered back for saving. */
export interface ContactSuggestion {
  name: string;
  phone: string;
  lastSentAt: string;
  timesSent: number;
}

/**
 * The pickable kinds, in the order they are offered.
 *
 * Ordered by how often they come up rather than alphabetically, and each
 * carries the recurrence it almost always has — so choosing "groceries"
 * already knows it is monthly and stops asking for a month.
 */
export const OCCASION_KINDS: ReadonlyArray<{
  value: OccasionKind;
  label: string;
  defaultRecurrence: Recurrence;
  /** Shown under the picker so the choice explains itself. */
  hint: string;
}> = [
  { value: 'birthday', label: 'Birthday', defaultRecurrence: 'annual', hint: 'Every year, same day.' },
  { value: 'anniversary', label: 'Anniversary', defaultRecurrence: 'annual', hint: 'Every year, same day.' },
  { value: 'groceries', label: 'Monthly groceries', defaultRecurrence: 'monthly', hint: 'Every month, same date.' },
  { value: 'upkeep', label: 'Upkeep', defaultRecurrence: 'monthly', hint: 'Money sent every month.' },
  { value: 'school_fees', label: 'School fees', defaultRecurrence: 'once', hint: 'A term date, on its own.' },
  { value: 'rent', label: 'Rent', defaultRecurrence: 'monthly', hint: 'Every month, same date.' },
  { value: 'graduation', label: 'Graduation', defaultRecurrence: 'once', hint: 'One date, one year.' },
  { value: 'wedding', label: 'Wedding', defaultRecurrence: 'once', hint: 'One date, one year.' },
  { value: 'new_baby', label: 'New baby', defaultRecurrence: 'once', hint: 'One date, one year.' },
  { value: 'medical', label: 'Medical', defaultRecurrence: 'once', hint: 'An appointment or a procedure.' },
  { value: 'memorial', label: 'Remembrance', defaultRecurrence: 'annual', hint: 'Every year, same day.' },
  { value: 'holiday', label: 'Holiday', defaultRecurrence: 'annual', hint: 'Every year, same day.' },
  { value: 'other', label: 'Something else', defaultRecurrence: 'annual', hint: 'Name it yourself.' },
];

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

export function kindLabel(kind: OccasionKind): string {
  return OCCASION_KINDS.find((entry) => entry.value === kind)?.label ?? 'Occasion';
}

/** What to call this occasion: its own words if it has any, its kind if not. */
export function occasionTitle(occasion: Pick<Occasion, 'kind' | 'label'>): string {
  return occasion.label?.trim() || kindLabel(occasion.kind);
}

/** "14 March", "the 3rd of each month", "14 March 2027". */
export function occasionWhen(
  occasion: Pick<Occasion, 'recurrence' | 'month' | 'day' | 'year'>,
): string {
  if (occasion.recurrence === 'monthly') {
    return `${ordinal(occasion.day)} of each month`;
  }

  const date = `${occasion.day} ${MONTHS[(occasion.month ?? 1) - 1]}`;
  return occasion.recurrence === 'once' && occasion.year ? `${date} ${occasion.year}` : date;
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Days until an occasion next comes round, or null when it never will again.
 *
 * Counted in whole local days rather than by subtracting timestamps, so a date
 * tomorrow morning reads as 1 rather than 0 because it happens to be late at
 * night now. A one-off that has passed returns null: it is history, and history
 * does not belong in a list of what is coming.
 */
export function daysUntil(
  occasion: Pick<Occasion, 'recurrence' | 'month' | 'day' | 'year'>,
  today: Date = new Date(),
): number | null {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const whole = (date: Date) =>
    Math.round((date.getTime() - startOfToday.getTime()) / 86_400_000);

  if (occasion.recurrence === 'once') {
    if (!occasion.month || !occasion.year) return null;
    const date = clampToMonth(occasion.year, occasion.month - 1, occasion.day);
    const days = whole(date);
    return days < 0 ? null : days;
  }

  if (occasion.recurrence === 'monthly') {
    // This month's, or next month's if it has already gone by.
    const thisMonth = clampToMonth(
      startOfToday.getFullYear(),
      startOfToday.getMonth(),
      occasion.day,
    );
    if (thisMonth >= startOfToday) return whole(thisMonth);

    return whole(
      clampToMonth(startOfToday.getFullYear(), startOfToday.getMonth() + 1, occasion.day),
    );
  }

  if (!occasion.month) return null;

  const inYear = (year: number) => clampToMonth(year, occasion.month! - 1, occasion.day);
  let next = inYear(startOfToday.getFullYear());
  if (next < startOfToday) next = inYear(startOfToday.getFullYear() + 1);
  return whole(next);
}

/**
 * A day that may not exist in the month it is asked for.
 *
 * The 31st in a 30-day month, or the 29th of February in a common year, rolls
 * forward to the 1st of the next month rather than back. A date should never be
 * announced before it falls: told early, somebody buys the present a day late.
 */
function clampToMonth(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return day > lastDay ? new Date(year, monthIndex + 1, 1) : new Date(year, monthIndex, day);
}

/** "Today", "Tomorrow", "In 9 days" — the way a person would say it. */
export function countdownLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 31) return `In ${days} days`;

  const months = Math.round(days / 30);
  return `In ${months} month${months === 1 ? '' : 's'}`;
}

export interface UpcomingOccasion {
  contact: Contact;
  occasion: Occasion;
  days: number;
}

/**
 * Everything coming up across every contact, soonest first.
 *
 * Windowed rather than exhaustive: a birthday eight months out is not
 * something to act on today, and a rail that lists everyone is a rail nobody
 * reads.
 */
export function upcomingOccasions(
  contacts: Contact[],
  withinDays = 60,
  today: Date = new Date(),
): UpcomingOccasion[] {
  const found: UpcomingOccasion[] = [];

  for (const contact of contacts) {
    for (const occasion of contact.occasions) {
      const days = daysUntil(occasion, today);
      if (days !== null && days <= withinDays) found.push({ contact, occasion, days });
    }
  }

  return found.sort((a, b) => a.days - b.days);
}
