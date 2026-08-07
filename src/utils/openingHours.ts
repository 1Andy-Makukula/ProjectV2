/**
 * openingHours.ts
 *
 * Shop trading hours, and the buyer-facing "Open now / Closed" state.
 *
 * The stored shape mirrors `shops.opening_hours` exactly (validated in the
 * database by `is_valid_opening_hours`):
 *
 *     {"mon": {"open": "08:00", "close": "17:00"}, "sat": {...}}
 *
 * An absent day means closed that day. NULL/`{}` means the shop has not
 * published hours at all, which is different from being closed and must not
 * render as "Closed".
 *
 * Times are wall time in Africa/Lusaka. The open/closed check is deliberately
 * computed in that zone rather than from the device clock — a buyer sending a
 * gift home from another country would otherwise be told a Lusaka shop is shut
 * because it is late where they are standing.
 */

export const SHOP_TIMEZONE = 'Africa/Lusaka';

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayHours {
  open: string;
  close: string;
}

export type OpeningHours = Partial<Record<WeekdayKey, DayHours>>;

/** Display order, Monday first — how a Zambian shop sign reads. */
export const WEEKDAYS: ReadonlyArray<{ key: WeekdayKey; label: string }> = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const DAY_KEYS = WEEKDAYS.map((d) => d.key);
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Matches the `shops_opening_hours_check` time format exactly. */
export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/**
 * Coerces whatever came back from the database into a trusted shape.
 *
 * The column is validated server-side, but this is a public storefront reading
 * a JSON blob — one malformed row must degrade to "no hours published" rather
 * than throw and blank the whole shop page.
 */
export function parseOpeningHours(raw: unknown): OpeningHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const result: OpeningHours = {};
  for (const [day, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (!DAY_KEYS.includes(day as WeekdayKey)) continue;
    if (!spec || typeof spec !== 'object') continue;

    const { open, close } = spec as Record<string, unknown>;
    if (!isValidTime(open) || !isValidTime(close)) continue;

    result[day as WeekdayKey] = { open, close };
  }

  return Object.keys(result).length > 0 ? result : null;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Current weekday and minute-of-day in the shop's timezone, not the device's. */
function nowInShopTimezone(now: Date): { day: WeekdayKey; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SHOP_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return {
    day: lookup('weekday').slice(0, 3).toLowerCase() as WeekdayKey,
    minuteOfDay: Number(lookup('hour')) * 60 + Number(lookup('minute')),
  };
}

function previousDay(day: WeekdayKey): WeekdayKey {
  const index = DAY_KEYS.indexOf(day);
  return DAY_KEYS[(index + DAY_KEYS.length - 1) % DAY_KEYS.length];
}

function nextOpenDay(hours: OpeningHours, from: WeekdayKey): { day: WeekdayKey; at: string } | null {
  const start = DAY_KEYS.indexOf(from);
  // Start at +1: today's remaining hours are handled by the caller.
  for (let step = 1; step <= DAY_KEYS.length; step += 1) {
    const day = DAY_KEYS[(start + step) % DAY_KEYS.length];
    const spec = hours[day];
    if (spec) return { day, at: spec.open };
  }
  return null;
}

export interface OpenState {
  isOpen: boolean;
  /** Short badge text, e.g. "Open now" or "Closed". */
  label: string;
  /** Supporting line, e.g. "Closes 17:00" or "Opens Monday 08:00". */
  detail: string | null;
}

/**
 * Whether the shop is trading right now.
 *
 * Returns null when no hours are published — callers must render nothing in
 * that case rather than assuming the shop is closed.
 */
export function shopOpenState(
  raw: unknown,
  now: Date = new Date()
): OpenState | null {
  const hours = parseOpeningHours(raw);
  if (!hours) return null;

  const { day, minuteOfDay } = nowInShopTimezone(now);

  // Today's span. A close time at or before the open time runs past midnight
  // (an 18:00–02:00 kitchen), so it only bounds the start of the day.
  const today = hours[day];
  if (today) {
    const openAt = toMinutes(today.open);
    const closeAt = toMinutes(today.close);
    const overnight = closeAt <= openAt;

    if (!overnight && minuteOfDay >= openAt && minuteOfDay < closeAt) {
      return { isOpen: true, label: 'Open now', detail: `Closes ${today.close}` };
    }
    if (overnight && minuteOfDay >= openAt) {
      return { isOpen: true, label: 'Open now', detail: `Closes ${today.close}` };
    }
    if (minuteOfDay < openAt) {
      return { isOpen: false, label: 'Closed', detail: `Opens ${today.open}` };
    }
  }

  // Still inside a span that began yesterday and crossed midnight.
  const yesterday = hours[previousDay(day)];
  if (yesterday) {
    const openAt = toMinutes(yesterday.open);
    const closeAt = toMinutes(yesterday.close);
    if (closeAt <= openAt && minuteOfDay < closeAt) {
      return { isOpen: true, label: 'Open now', detail: `Closes ${yesterday.close}` };
    }
  }

  const upcoming = nextOpenDay(hours, day);
  if (!upcoming) return { isOpen: false, label: 'Closed', detail: null };

  const label = WEEKDAYS.find((d) => d.key === upcoming.day)?.label ?? '';
  return { isOpen: false, label: 'Closed', detail: `Opens ${label} ${upcoming.at}` };
}

/**
 * Server-side truth for this lives in the `shops_maps_link_check` constraint.
 * Keep the two in step — a drift means the merchant is told their link is fine
 * and then the save fails with a raw constraint violation.
 *
 * https only, and only hostnames Google serves maps from, because this becomes
 * a clickable outbound link on a public page.
 */
const MAPS_LINK_PATTERN =
  /^https:\/\/((www\.)?google\.[a-z.]{2,}\/maps|maps\.google\.[a-z.]{2,}|maps\.app\.goo\.gl|goo\.gl\/maps)([/?#]|$)/i;

export function isValidMapsLink(url: string): boolean {
  return MAPS_LINK_PATTERN.test(url.trim());
}
