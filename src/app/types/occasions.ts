// The occasion tiles — the front door's Send Home rail.
//
// TWO THINGS ARE CALLED "OCCASION" AND THEY ARE NOT THE SAME OBJECT
//   `contact_occasions`  a date attached to a PERSON. Auntie's birthday, 4
//                        March. Private, dated, drives reminders.
//   an occasion TILE     a shopping entry point. "Monthly Essentials."
//                        Attached to nobody, not dated, buyable now.
//
// They share a vocabulary — `OccasionKind` — and the link between them is a
// reminder firing and landing on the matching tile. Keeping the vocabulary
// single is deliberate: `occasion_lead_times.kind` is the one taxonomy, and
// `contact_occasions.kind` and `experiences.occasion_kind` are both written
// against it, so the tiles cannot drift into a fourth slightly different list.
//
// WHY THE LABELS HERE DIFFER FROM THE ONES IN contacts.ts
// `OCCASION_KINDS` labels the picker a person uses to record a date about
// somebody. These label a shelf. The two genuinely differ, and three of them
// differ for a reason worth keeping:
//
//   rent         → "Home"            Rent is money and KithLy sends things.
//                                    Reframed as the appliances, furniture and
//                                    bedding that make a rented place liveable,
//                                    which IS a basket — see the kappa in
//                                    20260920000000_home_occasion_affinity.
//   school_fees  → "School Prep"     Fees are money. The basket kappa already
//                                    describes is uniforms, shoes, bags and
//                                    stationery. The tile must not say "fees".
//   memorial     → "Funeral Support" What people actually send: food for the
//                                    mourners. Handled with restraint — see
//                                    the note on `quiet` below.
//
// WHY `primaryCategory` IS HERE AND WHY IT IS TEMPORARY
// The honest destination for an occasion tile is a page showing everything
// kappa says suits it — several categories at once, weighted. That cannot be
// built from the client yet: `kithly_reco` is deliberately NOT on the public
// API (see reco/track.ts), so the affinities need an RPC wrapper first.
//
// Until then each tile points at its single strongest category, which is a
// real destination that works today through the existing `?category=` filter.
// The slugs below MIRROR the top entry of each occasion's kappa seed. That is
// a duplication and it is on purpose, bounded and marked: when the RPC lands,
// this field is deleted and nothing else here changes.

import type { OccasionKind } from './contacts';

export interface OccasionTile {
  kind: OccasionKind;
  /** What the shelf is called. Not the picker's label — see the note above. */
  label: string;
  /** One line under the name, on tiles wide enough to carry it. */
  blurb: string;
  /**
   * Provisional destination: the strongest category in this occasion's kappa.
   * Null means the tile routes somewhere else entirely — see `href`.
   */
  primaryCategory: string | null;
  /** An explicit route, for the tile that is not a shelf at all. */
  href?: string;
  /**
   * Suppresses every loud treatment: no promo block, no countdown, no vector,
   * no discount, no lift. The lead-time rationale for `memorial` in SQL reads
   * "an early reminder of a death is not a kindness" — this extends that from
   * the reminder to the tile.
   */
  quiet?: boolean;
}

/**
 * All thirteen, in the order they are offered.
 *
 * Ordered by how often a diaspora sender actually faces it, not by the kappa
 * strength and not alphabetically. `other` sits last deliberately: it is the
 * catch for everything the taxonomy does not name, and it reads best as the
 * full-width band the mosaic's span pattern gives to a thirteenth tile.
 */
export const OCCASION_TILES: ReadonlyArray<OccasionTile> = [
  {
    kind: 'groceries',
    label: 'Monthly Essentials',
    blurb: 'The month’s shopping, bought here and collected there.',
    primaryCategory: 'groceries',
  },
  {
    kind: 'birthday',
    label: 'Birthday',
    blurb: 'Something to eat, something to wear, something to keep.',
    primaryCategory: 'bakery-cakes',
  },
  {
    kind: 'school_fees',
    label: 'School Prep',
    blurb: 'Uniforms, shoes, bags and the stationery list.',
    primaryCategory: 'school-supplies',
  },
  {
    kind: 'medical',
    label: 'Pharmacy Run',
    blurb: 'A prescription collected, and you are told when it was.',
    primaryCategory: 'pharmacy',
  },
  {
    kind: 'rent',
    label: 'Home',
    blurb: 'Appliances, furniture, bedding — everything that makes a place liveable.',
    primaryCategory: 'home-appliances',
  },
  {
    kind: 'memorial',
    label: 'Funeral Support',
    blurb: 'Food for the people who came.',
    primaryCategory: 'catering',
    quiet: true,
  },
  {
    kind: 'upkeep',
    label: 'Upkeep',
    blurb: 'Keeping the house going — cleaning, tools, repairs.',
    primaryCategory: 'cleaning-supplies',
  },
  {
    kind: 'new_baby',
    label: 'New Baby',
    blurb: 'Clothing, nappies and the things nobody remembers to buy.',
    primaryCategory: 'baby-clothing',
  },
  {
    kind: 'holiday',
    label: 'Holidays',
    blurb: 'The meat, the drinks and the cake, ordered early.',
    primaryCategory: 'meat-poultry',
  },
  {
    kind: 'wedding',
    label: 'Wedding',
    blurb: 'The household, and the day itself.',
    primaryCategory: 'kitchenware',
  },
  {
    kind: 'graduation',
    label: 'Graduation',
    blurb: 'The next thing, not the last one.',
    primaryCategory: 'mobile-phones',
  },
  {
    kind: 'anniversary',
    label: 'Anniversary',
    blurb: 'Usually a booking rather than a parcel.',
    primaryCategory: 'jewellery',
  },
  {
    kind: 'other',
    label: 'Something else',
    blurb: 'Not here? Tell us what you need and we will go and find it.',
    primaryCategory: null,
    // Today this is the help desk. At Stage 4 of docs/plans/two-rails.md it
    // becomes `start_kithly_conversation` and opens a thread with us directly
    // — the RPC is already written in 20260916000000, just unapplied and
    // unwired, so this tile is the request engine's front door in waiting.
    href: '/support',
  },
];

/**
 * Art, keyed by kind, cover first. **All thirteen are covered.**
 *
 * A kind with two or more frames breathes: the Conductor fades between them
 * on the shared page clock. A kind with one simply does not move, which is a
 * normal state and needs no apology -- four of them have a second frame and
 * the rest are waiting on art, not on code.
 *
 * Four reuse the category photographs, because the occasion and the shelf
 * genuinely share a subject: a Pharmacy Run and the pharmacy shelf are the
 * same picture. Two came from the design scaffolding. Seven were sourced from
 * Unsplash on 2026-09-20.
 *
 * LICENCE. The Unsplash Licence allows commercial use with no attribution and
 * no share-alike, which is why it was preferred over the CC BY-SA images on
 * Wikimedia Commons -- share-alike on page imagery is an obligation this
 * product should not take on casually. The scaffolding images are the ones
 * still NOT cleared for production; see docs/plans/two-rails.md section 8.
 *
 * THE RULE, which cost two rejections today: never put a photograph under a
 * name it does not show. A wrong picture is worse than no picture, because an
 * empty block is honest and a wrong one is a small lie about what we carry.
 * Rejected on inspection: a "gift hamper" full of branded Canadian groceries,
 * a tropical beach resort standing in for a wedding, two European children for
 * School Prep, and West African ceremonial dress for a Zambian wedding.
 */
export const OCCASION_ART: Partial<Record<OccasionKind, string[]>> = {
  // Shared with the category mosaic -- same subject, same photograph.
  groceries: ['/categories/groceries.jpg', '/categories/groceries-2.jpg'],
  medical: ['/categories/pharmacy.jpg'],
  rent: ['/categories/home-appliances.jpg'],
  holiday: ['/categories/meat-poultry.jpg'],

  // From the design scaffolding.
  upkeep: ['/occasions/upkeep.jpg'],
  anniversary: ['/occasions/anniversary.jpg'],

  // Sourced 2026-09-20.
  birthday: ['/occasions/birthday.jpg'],
  school_fees: ['/occasions/school-prep.jpg', '/occasions/school-prep-2.jpg'],
  new_baby: ['/occasions/new-baby.jpg', '/occasions/new-baby-2.jpg'],
  wedding: ['/occasions/wedding.jpg'],
  graduation: ['/occasions/graduation.jpg'],

  // White lilies, then a white chrysanthemum. Was the catering photograph --
  // a restaurant full of people eating is what the kappa says a funeral BUYS,
  // and it is exactly the wrong thing to put under the word. The basket is
  // food; the picture is not.
  memorial: ['/occasions/funeral.jpg', '/occasions/funeral-2.jpg'],

  // An open-air market stall. The tile says "we will go and find it", and this
  // is where that happens -- deliberately not a headset or a call centre,
  // which is the thing this product is promising people it is not.
  other: ['/occasions/something-else.jpg'],
};
