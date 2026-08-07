// Shared vocabulary for the catalogue.
//
// The admin form, the storefront card and the item detail view all need to
// agree on what a service is and how its pricing reads, so the labels and
// predicates live here rather than being restated in each surface.

export type ItemType = 'product' | 'service';

export type FulfillmentLocation = 'in_store' | 'at_customer' | 'remote';

export const ITEM_TYPES: ReadonlyArray<{
  value: ItemType;
  label: string;
  description: string;
}> = [
  {
    value: 'product',
    label: 'Product',
    description: 'A physical item the recipient collects from the shop.',
  },
  {
    value: 'service',
    label: 'Service',
    description: 'Work performed for the recipient, in store or on location.',
  },
];

export const FULFILLMENT_LOCATIONS: ReadonlyArray<{
  value: FulfillmentLocation;
  label: string;
  description: string;
}> = [
  {
    value: 'in_store',
    label: 'In store',
    description: 'The recipient comes to the shop.',
  },
  {
    value: 'at_customer',
    label: "At the recipient's location",
    description: 'The merchant travels to them.',
  },
  {
    value: 'remote',
    label: 'Remote',
    description: 'Delivered online, with nobody travelling.',
  },
];

export const FULFILLMENT_LOCATION_LABELS: Record<FulfillmentLocation, string> = {
  in_store: 'In store',
  at_customer: "At recipient's location",
  remote: 'Remote',
};

/** The catalogue fields every customer-facing surface reads. */
export interface CatalogItem {
  id: string;
  name: string;
  description?: string | null;
  /** Authoritative checkout price, in ngwee. */
  price_zmw: number;
  image_url?: string | null;
  is_weekly_pick?: boolean | null;
  promo_badge_text?: string | null;
  shop?: { id: string; name: string; location?: string | null } | null;

  item_type?: ItemType | null;
  requires_scheduling?: boolean | null;
  lead_time_days?: number | null;
  fulfillment_location?: FulfillmentLocation | null;
  allow_custom_quote?: boolean | null;
  /** price_zmw is a starting figure, not the settled price. */
  price_is_minimum?: boolean | null;

  has_expiry?: boolean | null;
  valid_for_days?: number | null;

  is_discounted?: boolean | null;
  original_price_zmw?: number | null;

  is_wholesale?: boolean | null;
  wholesale_price_zmw?: number | null;
  minimum_order_quantity?: number | null;

  /** Units on hand. NULL means the merchant does not track stock for this item. */
  stock_quantity?: number | null;

  /** Gallery rows, when the surface asked for them. Order via galleryUrls(). */
  item_images?: Array<{ image_url: string; sort_order: number }> | null;
}

/**
 * The item's photographs, cover first.
 *
 * items.image_url stays the authoritative cover — the sync_item_cover trigger
 * keeps it equal to the first gallery row — so it leads, and gallery rows are
 * appended without repeating it. An item with no gallery yields just its cover,
 * which is why every caller can treat this as the single source for images.
 */
export function galleryUrls(
  item: Pick<CatalogItem, 'image_url' | 'item_images'>,
): string[] {
  const ordered = [...(item.item_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => row.image_url);

  const urls = item.image_url ? [item.image_url, ...ordered] : ordered;
  return Array.from(new Set(urls.filter(Boolean)));
}

/** Items default to products — rows predating the service model have no type. */
export function isService(item: Pick<CatalogItem, 'item_type'>): boolean {
  return item.item_type === 'service';
}

/**
 * A service that has to be booked cannot go straight into the cart: the buyer
 * and merchant need to agree a date first. Custom-quote items are the same —
 * there is no settled price to charge yet.
 */
export function requiresConversation(
  item: Pick<CatalogItem, 'item_type' | 'requires_scheduling' | 'allow_custom_quote'>,
): boolean {
  return Boolean(item.requires_scheduling) || Boolean(item.allow_custom_quote);
}

/** Shown wherever an out-of-stock item is rendered. */
export const OUT_OF_STOCK_REASON = 'No available stock yet';

/**
 * Whether the item cannot currently be bought for want of stock.
 *
 * A NULL quantity means the merchant is not tracking stock at all, which is the
 * default and must never read as "out" — that would make the entire pre-Phase-4
 * catalogue look sold out. Only a tracked count of zero counts.
 *
 * This is deliberately separate from is_available: a delisted item is filtered
 * out of the storefront queries entirely, whereas a sold-out one stays visible
 * and greyed so the buyer can see it exists and come back.
 */
export function isOutOfStock(item: Pick<CatalogItem, 'stock_quantity'>): boolean {
  return item.stock_quantity != null && item.stock_quantity <= 0;
}

export interface ServicePriceLabel {
  /** Sits before the amount, e.g. "From". Null renders the price plainly. */
  prefix: string | null;
  /** One line for surfaces with room to explain. Null when there is nothing to say. */
  note: string | null;
}

/**
 * How a service's price should read.
 *
 * A bare figure next to a "talk to the shop" action is ambiguous — the buyer
 * cannot tell whether it is the price or a starting point. When the merchant
 * has marked it as a minimum, every surface must say so in the same words, so
 * the wording lives here rather than in the card, the row and the detail page
 * separately.
 *
 * The database ties price_is_minimum to allow_custom_quote
 * (items_price_is_minimum_check); the extra check here keeps the label honest
 * if a row somehow predates that constraint.
 */
export function servicePriceLabel(
  item: Pick<CatalogItem, 'price_is_minimum' | 'allow_custom_quote'>,
): ServicePriceLabel {
  if (!item.price_is_minimum || !item.allow_custom_quote) {
    return { prefix: null, note: null };
  }
  return {
    prefix: 'From',
    note: 'Minimum service fee. Talk to the shop for a tailored price.',
  };
}

/** Whole-ZMW discount percentage, or null when the item is not discounted. */
export function discountPercentage(
  item: Pick<CatalogItem, 'is_discounted' | 'original_price_zmw' | 'price_zmw'>,
): number | null {
  if (!item.is_discounted) return null;
  const original = item.original_price_zmw;
  if (!original || original <= item.price_zmw) return null;
  return Math.round(((original - item.price_zmw) / original) * 100);
}

/**
 * Which date the voucher's expiry is measured from.
 *
 * Scheduled services are anchored to the agreed execution date — a booking
 * ninety days out must not lapse because the clock started at payment. Every
 * other item counts from the purchase.
 */
export function expiryBasis(
  item: Pick<CatalogItem, 'has_expiry' | 'requires_scheduling'>,
): 'none' | 'purchase_date' | 'execution_date' {
  if (item.has_expiry === false) return 'none';
  return item.requires_scheduling ? 'execution_date' : 'purchase_date';
}
