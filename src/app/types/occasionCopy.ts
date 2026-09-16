import type { OccasionKind } from './contacts';

/**
 * What an occasion is called on a tile, in the sender's language.
 *
 * Deliberately not OCCASION_KINDS[].label, which is written for somebody filing
 * a date in their address book: "Medical" is exactly right beside a date
 * picker, and exactly wrong on a tile somebody is deciding to tap.
 *
 * The difference is the whole diaspora gap. "Hardware" is a shelf in a shop.
 * "Home Building Projects" is the plot in Chongwe you have been sending money
 * towards for two years. Same items, and only one of them is a reason to open
 * the app.
 */
export const OCCASION_TILE_LABEL: Record<OccasionKind, string> = {
  groceries: 'Monthly Essentials',
  upkeep: 'Monthly Upkeep',
  school_fees: 'School & Term Prep',
  medical: 'Health & Care',
  rent: 'Rent & Bills',
  birthday: 'Birthday',
  graduation: 'Graduation',
  new_baby: 'New Baby',
  wedding: 'Wedding',
  anniversary: 'Anniversary',
  memorial: 'Remembrance',
  holiday: 'Holidays',
  other: 'Something Else',
};

/**
 * What each occasion is about, a line under the title.
 *
 * Separate again from OCCASION_KINDS[].hint, which explains recurrence
 * ("Every year, same day.") rather than what you are buying.
 */
export const OCCASION_BLURB: Record<OccasionKind, string> = {
  birthday: 'Something that arrives on the day itself, not the week after it.',
  anniversary: 'A dinner booked, or a delivery that turns up while they are both home.',
  wedding: 'Sent early enough to be part of the planning rather than the pile.',
  graduation: 'Years of school fees behind it. Send something that reads that way.',
  new_baby: 'The things a new mother runs out of first, from a shop close to her.',
  memorial: 'Quiet, practical help for the people carrying the arrangements.',
  holiday: 'Everybody is shopping at once. This is the week to be early.',
  groceries: 'The month’s staples, collected from a shop they already trust.',
  school_fees: 'Uniforms, books and shoes, sorted before the term starts.',
  upkeep: 'The regular send, with proof it reached the person it was meant for.',
  rent: 'Money that has to be found rather than chosen. Paid where it is owed.',
  medical: 'Prescriptions and check-ups, paid for from here and collected there.',
  other: 'Tell us the situation and we will work out what it needs.',
};
