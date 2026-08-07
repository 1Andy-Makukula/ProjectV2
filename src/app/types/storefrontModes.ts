import { Compass, Gift, Sparkles, ConciergeBell, ShoppingBag, ListChecks } from 'lucide-react';

/**
 * The storefront wears a different face depending on what the shopper came for.
 *
 * The five are not five apps. Each one reorders and re-weights the same
 * underlying data — a shopper buying a birthday present wants to browse and be
 * inspired, while someone restocking wants a dense list and a fast path to the
 * cart. The palette shift is handled entirely in CSS via `data-mode` on the
 * root element, so nothing here carries colour values.
 */
export type StorefrontMode =
  | 'discover'
  | 'gifting'
  | 'experiences'
  | 'services'
  | 'shopping'
  | 'lists';

/**
 * How the item grid is laid out in a given mode.
 *
 * `list` is a flat dense list; `menu` is the same rows grouped under the
 * business that offers them, the way a salon or workshop writes out its
 * services. They are separate values because Shopping wants one long scannable
 * list and Services wants a price list per provider.
 */
export type ModeLayout = 'grid' | 'editorial' | 'showcase' | 'list' | 'menu';

export interface ModeDefinition {
  value: StorefrontMode;
  /** Short label for the switcher chip. */
  label: string;
  /** Replaces the page title while this mode is active. */
  title: string;
  /** Sits under the title. */
  tagline: string;
  icon: typeof Gift;
  layout: ModeLayout;
  /**
   * Which sections appear, in order.
   *
   * `lists` is the one section that is not a re-slice of the item/shop data
   * every other mode shares — see useStorefrontData, which loads the community
   * feed alongside them so switching into Lists still refetches nothing.
   */
  sections: Array<'campaigns' | 'experiences' | 'items' | 'shops' | 'lists'>;
  /** Filters the item feed. `null` means everything. */
  itemFilter: 'product' | 'service' | null;
  /** Copy for the item section heading. */
  itemsHeading: string;
  itemsKicker: string;
}

export const STOREFRONT_MODES: ReadonlyArray<ModeDefinition> = [
  {
    value: 'discover',
    label: 'Discover',
    title: 'Send something that means something',
    tagline: 'Gifts, experiences and services from shops across Zambia.',
    icon: Compass,
    layout: 'grid',
    sections: ['campaigns', 'experiences', 'items', 'shops'],
    itemFilter: null,
    itemsHeading: 'Featured Picks',
    itemsKicker: 'Curated Selection',
  },
  {
    value: 'gifting',
    label: 'Gifting',
    title: 'Find the right gift',
    tagline: 'Chosen by you, collected by them, held safely in between.',
    icon: Gift,
    // Fewer, larger cards — gifting is browsing, not scanning.
    layout: 'editorial',
    sections: ['campaigns', 'items', 'experiences', 'shops'],
    itemFilter: 'product',
    itemsHeading: 'Ready to send',
    itemsKicker: 'For someone you like',
  },
  {
    value: 'experiences',
    label: 'Experiences',
    title: 'Give them a day, not a thing',
    tagline: 'Several shops, one gift, one deadline.',
    icon: Sparkles,
    layout: 'showcase',
    sections: ['experiences', 'campaigns', 'shops'],
    itemFilter: null,
    itemsHeading: 'Also worth a look',
    itemsKicker: 'Single items',
  },
  {
    value: 'services',
    label: 'Services',
    title: 'Book someone good',
    tagline: 'Work carried out for the person you are sending it to.',
    icon: ConciergeBell,
    // A service is a name and a price, not a photograph. Grouping the rows
    // under each business reads like the price list on a shop wall, and shows
    // far more of what a provider actually offers than a grid of cards did.
    layout: 'menu',
    sections: ['items', 'shops', 'experiences'],
    itemFilter: 'service',
    itemsHeading: 'Available to book',
    itemsKicker: 'Arranged with the shop',
  },
  {
    value: 'lists',
    label: 'Lists',
    title: 'Shop from someone’s list',
    tagline: 'One link, many shops — groceries, a new baby, a whole braai.',
    icon: ListChecks,
    // Unused here: this mode's feed is lists, not items. Kept at the default
    // rather than reshaping ModeDefinition for a single case.
    layout: 'grid',
    sections: ['lists', 'shops'],
    itemFilter: null,
    itemsHeading: 'Lists',
    itemsKicker: 'Built by people and shops',
  },
  {
    value: 'shopping',
    label: 'Shopping',
    title: 'Everything, quickly',
    tagline: 'The full catalogue, straight to the point.',
    icon: ShoppingBag,
    // Dense list — this mode is for people who know what they want.
    layout: 'list',
    sections: ['items', 'shops'],
    itemFilter: null,
    itemsHeading: 'All items',
    itemsKicker: 'Full catalogue',
  },
];

export function modeDefinition(mode: StorefrontMode): ModeDefinition {
  return STOREFRONT_MODES.find((m) => m.value === mode) ?? STOREFRONT_MODES[0];
}
