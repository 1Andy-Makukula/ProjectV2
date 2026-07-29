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

  has_expiry?: boolean | null;
  valid_for_days?: number | null;

  is_discounted?: boolean | null;
  original_price_zmw?: number | null;

  is_wholesale?: boolean | null;
  wholesale_price_zmw?: number | null;
  minimum_order_quantity?: number | null;
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
