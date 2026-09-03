import {
  CalendarHeart,
  Compass,
  Gift,
  PackageOpen,
  ShoppingCart,
  Sparkles,
  ConciergeBell,
  ShoppingBag,
  ListChecks,
} from 'lucide-react';

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

/**
 * The words a mode uses for the same actions.
 *
 * Vocabulary is the cheapest way to make a face feel like its own place, and
 * the most dangerous: a button whose label changes underneath someone is a
 * support ticket. So the lexicon reaches the browse surfaces only - tiles, the
 * rail, and the cart control on the storefront. Checkout, receipts and every
 * escrow message stay literal, and accessible names stay literal everywhere,
 * so a cart is always announced as a cart however it is dressed.
 */
export interface ModeLexicon {
  /** What the basket is called while browsing. */
  cart: string;
  /** The add-to-cart action on a tile. */
  add: string;
  /** Bulk add, on a list. */
  addAll: string;
  /** Saving something to a list. */
  save: string;
}

const DEFAULT_LEXICON: ModeLexicon = {
  cart: 'Cart',
  add: 'Add',
  addAll: 'Add all',
  save: 'Save',
};

/** Which rail modules a mode shows, in the order it shows them. */
export type RailModuleKey =
  | 'status'
  | 'occasions'
  | 'trending'
  | 'picks'
  | 'myLists'
  | 'communityLists';

const DEFAULT_RAIL: RailModuleKey[] = [
  'status',
  'trending',
  'picks',
  'myLists',
  'communityLists',
];

/**
 * How many tiles sit across the feed at each width.
 *
 * Per mode because density *is* tone: browsing for a present wants fewer,
 * larger cards than restocking a kitchen does. Written as the grid classes
 * rather than as numbers so the ladder stays legible beside the mode it
 * belongs to.
 */
const DEFAULT_DENSITY =
  'grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4 2xl:grid-cols-5';

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
  /** Grid classes for the item feed. Falls back to the standard ladder. */
  density?: string;
  /** Words this mode uses. Anything omitted keeps the plain one. */
  lexicon?: Partial<ModeLexicon>;
  /** The glyph on the cart control while this mode is active. */
  cartIcon?: typeof Gift;
  /** A tile treatment, drawn by theme.css. */
  ornament?: 'gift' | 'ticket' | 'list';
  /** Rail composition. Falls back to the standard running order. */
  rail?: RailModuleKey[];
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
    // Fewer, larger cards — gifting is browsing, not scanning. Still a step
    // denser than it was: two-up on a desktop meant four products filled a
    // screen, which is a lookbook rather than a shop.
    layout: 'editorial',
    sections: ['campaigns', 'items', 'experiences', 'shops'],
    itemFilter: 'product',
    itemsHeading: 'Ready to send',
    itemsKicker: 'For someone you like',
    density: 'grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-3 2xl:grid-cols-4',
    lexicon: {
      cart: 'Gift bag',
      add: 'Stash',
      addAll: 'Wrap the lot',
      save: 'Stash',
    },
    cartIcon: PackageOpen,
    ornament: 'gift',
    // What is already on its way matters most when you are giving; the
    // catalogue can wait until further down the rail.
    rail: ['status', 'occasions', 'myLists', 'trending', 'communityLists'],
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
    lexicon: { cart: 'Itinerary', add: 'Reserve', addAll: 'Reserve all' },
    cartIcon: Sparkles,
    ornament: 'ticket',
    rail: ['status', 'communityLists', 'trending'],
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
    lexicon: { add: 'Book', addAll: 'Book all' },
    cartIcon: ConciergeBell,
    rail: ['status', 'trending', 'myLists'],
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
    cartIcon: ListChecks,
    ornament: 'list',
    rail: ['status', 'communityLists', 'myLists', 'trending'],
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
    lexicon: { cart: 'Basket' },
    cartIcon: ShoppingCart,
    rail: ['status', 'picks', 'trending', 'myLists'],
  },
];

export function modeDefinition(mode: StorefrontMode): ModeDefinition {
  return STOREFRONT_MODES.find((m) => m.value === mode) ?? STOREFRONT_MODES[0];
}

/**
 * The resolved dressing for a mode.
 *
 * Every accessor fills in from the plain default, so a mode that says nothing
 * about its words, its density or its rail is not half-built - it simply wears
 * the standard face. That is what lets one mode be dressed in detail without
 * the other four having to be touched.
 */
export function modeLexicon(mode: StorefrontMode): ModeLexicon {
  return { ...DEFAULT_LEXICON, ...(modeDefinition(mode).lexicon ?? {}) };
}

export function modeDensity(mode: StorefrontMode): string {
  return modeDefinition(mode).density ?? DEFAULT_DENSITY;
}

export function modeRail(mode: StorefrontMode): RailModuleKey[] {
  return modeDefinition(mode).rail ?? DEFAULT_RAIL;
}

export function modeCartIcon(mode: StorefrontMode): typeof Gift {
  return modeDefinition(mode).cartIcon ?? ShoppingCart;
}

/** The glyph for the occasions module, which is gifting's alone. */
export const OCCASION_ICON = CalendarHeart;
