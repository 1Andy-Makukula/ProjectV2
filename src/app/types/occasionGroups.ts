import { OCCASION_KINDS, type OccasionKind } from './contacts';
import { OCCASION_BLURB, OCCASION_TILE_LABEL } from './occasionCopy';

/**
 * What gets a tile on the front door.
 *
 * WHY THIS IS NOT JUST OccasionKind
 * ---------------------------------
 * A kind is a thing you file a date under. A tile is a thing you tap. They are
 * mostly the same list, and then there is gifting.
 *
 * Nobody arrives thinking "anniversary". They arrive thinking "I want to send
 * something nice". Birthday, graduation, wedding, a new baby and the holidays
 * are one intent wearing six labels, and putting six tiles on the front door
 * for them would bury the three that are actually the business -- groceries,
 * school and health -- under a wall of confetti.
 *
 * So a group is one or more kinds behind one picture. Most groups hold exactly
 * one kind and are generated rather than declared, which matters: a kind that
 * nobody thought to group still gets a tile the moment a bundle is filed under
 * it. Curating a memorial bundle must never be the same as hiding it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * `celebrations` is not added to OccasionKind. That union is the taxonomy for
 * contact dates and experience filing, it is checked by a CHECK constraint in
 * `kithly_reco.kind_category` and by `occasion_lead_times`, and a presentation
 * grouping has no business in it. Groups live one layer up, in the URL and on
 * the tile, and resolve back down to real kinds before anything is queried.
 */
export interface OccasionGroup {
  /** The `/occasion/:kind` segment. A group slug, not necessarily a kind. */
  slug: string;
  label: string;
  blurb: string;
  /** The kinds actually queried. Never empty. */
  kinds: readonly OccasionKind[];
}

/**
 * Groups that hold more than one kind. Everything else is generated below.
 *
 * `memorial` is pointedly not in here. Remembrance is not gifting, and folding
 * a condolence into a tile headed "Celebrations" would be the single worst
 * thing this grid could do to somebody.
 */
const DECLARED: readonly OccasionGroup[] = [
  {
    slug: 'celebrations',
    label: 'Celebrations',
    blurb:
      'A birthday, a graduation, a wedding, a new baby. Sent early enough to arrive on the day rather than after it.',
    kinds: ['birthday', 'anniversary', 'graduation', 'wedding', 'new_baby', 'holiday'],
  },
];

/** Position in OCCASION_KINDS, which is already ordered by how often it comes up. */
const rank = (kind: OccasionKind): number =>
  OCCASION_KINDS.findIndex((k) => k.value === kind);

/**
 * Every group, in tile order.
 *
 * A group sorts by its highest-ranked member, so the ordering stays a property
 * of OCCASION_KINDS rather than a second ranking somebody has to keep in step
 * with the first.
 */
export const OCCASION_GROUPS: readonly OccasionGroup[] = (() => {
  const claimed = new Set<OccasionKind>(DECLARED.flatMap((g) => [...g.kinds]));

  const singletons: OccasionGroup[] = OCCASION_KINDS.filter(
    (k) => !claimed.has(k.value),
  ).map((k) => ({
    slug: k.value,
    label: OCCASION_TILE_LABEL[k.value],
    blurb: OCCASION_BLURB[k.value],
    kinds: [k.value],
  }));

  return [...DECLARED, ...singletons].sort(
    (a, b) =>
      Math.min(...a.kinds.map(rank)) - Math.min(...b.kinds.map(rank)),
  );
})();

const BY_SLUG: ReadonlyMap<string, OccasionGroup> = new Map(
  OCCASION_GROUPS.map((g) => [g.slug, g]),
);

const BY_KIND: ReadonlyMap<OccasionKind, OccasionGroup> = new Map(
  OCCASION_GROUPS.flatMap((g) => g.kinds.map((k) => [k, g] as const)),
);

/** Resolves a `/occasion/:kind` segment. Null for an address that means nothing. */
export function occasionGroupBySlug(slug: string | undefined): OccasionGroup | null {
  return slug ? BY_SLUG.get(slug) ?? null : null;
}

/** The tile a curated bundle belongs on. */
export function occasionGroupForKind(kind: OccasionKind): OccasionGroup | undefined {
  return BY_KIND.get(kind);
}
