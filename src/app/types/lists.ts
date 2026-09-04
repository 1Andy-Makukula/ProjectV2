// Shared vocabulary for lists.
//
// A list is a named collection of items that can span several businesses. It is
// owned either by a person or by a shop, and is private, shared by link, or
// published to the community feed.

export type ListVisibility = 'private' | 'link' | 'community';

/**
 * How a list is read.
 *
 * The same rows, presented two ways: `standard` is the shop view -- pictures,
 * prices, a running total -- and `storyboard` is the journey, laid out on paper
 * one stop at a time with the curator's own words beside each.
 */
export type ListTemplate = 'standard' | 'storyboard';

export const LIST_TEMPLATES: ReadonlyArray<{
  value: ListTemplate;
  label: string;
  description: string;
}> = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Pictures, prices and a running total.',
  },
  {
    value: 'storyboard',
    label: 'Storyboard',
    description: 'A paper journey — one stop at a time, in your own words.',
  },
];

export const LIST_VISIBILITIES: ReadonlyArray<{
  value: ListVisibility;
  label: string;
  description: string;
}> = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only you can see it.',
  },
  {
    value: 'link',
    label: 'Anyone with the link',
    description: 'Unlisted — shareable, but it never shows up in browsing.',
  },
  {
    value: 'community',
    label: 'Community',
    description: 'Published for everyone to find, save and buy from.',
  },
];

/**
 * What an entry points at.
 *
 * Stored on the row rather than inferred from which id is set: both foreign
 * keys are ON DELETE SET NULL, so once the target is gone the kind would be
 * unknowable and the entry could no longer be rendered as what it was.
 */
export type ListEntryKind = 'item' | 'shop';

export interface ListEntry {
  id: string;
  entry_kind: ListEntryKind;
  item_id: string | null;
  shop_id: string | null;
  /** Captured when the entry was added; only used when the target is gone. */
  snapshot_name: string;
  snapshot_image_url: string | null;
  sort_order: number;
  /** The curator's words about this stop, shown in the storyboard. */
  note: string | null;
  /** Live item, absent once the merchant deletes it. */
  item: {
    id: string;
    name: string;
    price_zmw: number;
    image_url: string | null;
    is_available: boolean | null;
    stock_quantity: number | null;
    /** Carried so a list can show what is on offer this month, not just today's price. */
    is_discounted: boolean | null;
    original_price_zmw: number | null;
    shop: { id: string; name: string } | null;
  } | null;
  /**
   * Live shop, for a shop entry. A shop is a destination rather than something
   * with a price, so it is never part of the list's total or its "buy all".
   */
  shop: {
    id: string;
    name: string;
    location: string | null;
    logo_url: string | null;
    cover_image_url: string | null;
  } | null;
}

/**
 * Something the viewer wants to put on a list.
 *
 * The shape every "Save" affordance hands to AddToListDialog, whether it sits
 * on an item card, an item page or a shop card.
 */
export interface ListTarget {
  kind: ListEntryKind;
  id: string;
  name: string;
  image_url?: string | null;
}

export interface ListSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  visibility: ListVisibility;
  is_anonymous: boolean;
  is_platform: boolean;
  owner_user_id: string | null;
  owner_shop_id: string | null;
  owner_name: string | null;
  shop_name: string | null;
  save_count: number;
  rating_count: number;
  rating_sum: number;
  template: ListTemplate;
  item_count: number;
  /** First few item pictures, for the collage tile. */
  preview_images: string[];
  created_at: string;
}

export interface ListDetail extends ListSummary {
  entries: ListEntry[];
}

/**
 * Who a list is presented as.
 *
 * Platform lists are badged KithLy rather than naming the admin who wrote them
 * — a curated list carries the platform's weight, not an individual's. Shop
 * lists always name the shop so commercial content is never mistaken for a
 * personal one, and that is deliberately not something is_anonymous can hide.
 */
export function listAuthorLabel(list: Pick<ListSummary,
  'is_platform' | 'is_anonymous' | 'owner_shop_id' | 'shop_name' | 'owner_name'
>): string {
  if (list.is_platform) return 'KithLy';
  if (list.owner_shop_id) return list.shop_name ?? 'A shop';
  if (list.is_anonymous) return 'Anonymous';
  return list.owner_name ?? 'Someone';
}

/** Mean KithLy Rating, or null when nobody has rated it yet. */
export function listRating(list: Pick<ListSummary, 'rating_count' | 'rating_sum'>): number | null {
  if (!list.rating_count) return null;
  return Math.round((list.rating_sum / list.rating_count) * 10) / 10;
}

export type EntryUnavailableReason = 'removed' | 'delisted' | 'out_of_stock' | 'closed' | null;

/**
 * Why an entry cannot be bought right now, or null when it can.
 *
 * A list outlives the items in it, so entries degrade rather than disappear:
 * someone sent a list of twelve things and the recipient must see twelve, with
 * the missing ones explained.
 */
export function entryUnavailableReason(entry: ListEntry): EntryUnavailableReason {
  if (entry.entry_kind === 'shop') return entry.shop ? null : 'closed';
  if (!entry.item) return 'removed';
  if (entry.item.is_available === false) return 'delisted';
  if (entry.item.stock_quantity != null && entry.item.stock_quantity <= 0) return 'out_of_stock';
  return null;
}

export const ENTRY_UNAVAILABLE_TEXT: Record<Exclude<EntryUnavailableReason, null>, string> = {
  removed: 'No longer sold',
  delisted: 'Unavailable from the shop',
  out_of_stock: 'No available stock yet',
  closed: 'This shop has left KithLy',
};

/**
 * Whether an entry can go in the cart.
 *
 * A shop entry is browsable, never buyable — it has no price and no single
 * thing to add — so every total and the "buy all" button filter on this rather
 * than on availability alone.
 */
export function isBuyableEntry(entry: ListEntry): boolean {
  // Anything not explicitly a shop is an item, matching the column default:
  // entries written before shops could be listed carry no kind of their own.
  return entry.entry_kind !== 'shop' && entryUnavailableReason(entry) === null;
}

/** What to show for an entry: live values where they exist, snapshot otherwise. */
export function entryDisplay(entry: ListEntry): { name: string; imageUrl: string | null } {
  if (entry.entry_kind === 'shop') {
    return {
      name: entry.shop?.name ?? entry.snapshot_name,
      imageUrl: entry.shop?.cover_image_url ?? entry.shop?.logo_url ?? entry.snapshot_image_url,
    };
  }

  return {
    name: entry.item?.name ?? entry.snapshot_name,
    imageUrl: entry.item?.image_url ?? entry.snapshot_image_url,
  };
}

/**
 * What the list saves against the undiscounted prices, in ngwee.
 *
 * A monthly-shop list is largely persuasive because of what is on offer, so the
 * saving is worth totalling rather than leaving the reader to add up
 * strike-throughs. Counts only buyable entries, matching listBuyableTotal.
 */
export function listSavings(entries: ListEntry[]): number {
  return entries.reduce((total, entry) => {
    if (!isBuyableEntry(entry) || !entry.item) return total;
    const { is_discounted, original_price_zmw, price_zmw } = entry.item;
    if (!is_discounted || !original_price_zmw || original_price_zmw <= price_zmw) return total;
    return total + (original_price_zmw - price_zmw);
  }, 0);
}

/** Total of the entries that can actually be bought right now. */
export function listBuyableTotal(entries: ListEntry[]): number {
  return entries.reduce(
    (total, entry) => (isBuyableEntry(entry) && entry.item ? total + entry.item.price_zmw : total),
    0,
  );
}

/** How many distinct businesses a list draws from — the thing that makes it a list. */
export function listShopCount(entries: ListEntry[]): number {
  return new Set(
    entries
      // A shop saved to the list counts as one of its businesses in its own
      // right, alongside the shops the items come from.
      .map((entry) => (entry.entry_kind === 'shop' ? entry.shop?.id : entry.item?.shop?.id))
      .filter((id): id is string => Boolean(id)),
  ).size;
}
