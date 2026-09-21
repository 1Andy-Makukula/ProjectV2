// Curated multi-shop offerings.
//
// Named "experience" rather than "bundle" on purpose: in this codebase a bundle
// already means the set of items under one claim code at the fulfilment
// terminal (the Smart Bundle Protocol), and reusing the word would make
// merchant-facing language ambiguous.

export interface ExperienceItem {
  id: string;
  experience_id: string;
  item_id: string;
  quantity: number;
  note: string | null;
  sort_order: number;
  /** This week's held price, in ngwee. Null means it falls back to the item. */
  locked_price_zmw?: number | null;
  /** What it cost us in town when last priced, ngwee. Never shown to buyers. */
  sourced_cost_zmw?: number | null;
  priced_at?: string | null;
  item?: {
    id: string;
    name: string;
    description: string | null;
    price_zmw: number;
    image_url: string | null;
    is_available: boolean | null;
    is_quote_only?: boolean | null;
    shop?: { id: string; name: string; relationship_tier?: string | null } | null;
  } | null;
}

export interface Experience {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  is_featured: boolean;
  expires_at: string | null;
  sort_order: number;
  created_at: string;
  /** Which occasion tile this sits under. Null means reachable only by link. */
  occasion_kind?: string | null;
  /** The date this week's prices are held until. Null means no lock. */
  price_valid_until?: string | null;
  experience_items?: ExperienceItem[];
}

/**
 * What this costs, in ngwee.
 *
 * A held price wins over the live item price, because that is the whole
 * promise: the figure shown when the week opened is the figure charged, even
 * if the shop has moved since. A line with no lock falls back to the item,
 * which is correct for an experience built from ordinary shop stock.
 */
export function experienceTotal(experience: Experience): number {
  return (experience.experience_items ?? []).reduce(
    (sum, line) => sum + line.quantity * (line.locked_price_zmw ?? line.item?.price_zmw ?? 0),
    0,
  );
}

/** Whether this experience carries a live weekly price lock. */
export function hasLivePriceLock(experience: Experience): boolean {
  if (!experience.price_valid_until) return false;
  return new Date(experience.price_valid_until).getTime() >= Date.now();
}

/**
 * The shops behind an experience, de-duplicated, with how close we are to
 * each. This is what the disclosure line is built from.
 */
export function experienceShops(
  experience: Experience,
): { id: string; name: string; tier: string }[] {
  const seen = new Map<string, { id: string; name: string; tier: string }>();
  for (const line of experience.experience_items ?? []) {
    const shop = line.item?.shop;
    if (shop && !seen.has(shop.id)) {
      seen.set(shop.id, { id: shop.id, name: shop.name, tier: shop.relationship_tier ?? 'partner' });
    }
  }
  return [...seen.values()];
}

/** An experience is only purchasable while every part of it is. */
export function experienceIsAvailable(experience: Experience): boolean {
  const lines = experience.experience_items ?? [];
  if (lines.length === 0) return false;
  return lines.every((l) => l.item?.is_available !== false && !l.item?.is_quote_only);
}

export function experienceHasLapsed(experience: Experience): boolean {
  return experience.expires_at != null && new Date(experience.expires_at).getTime() <= Date.now();
}

/** The distinct shops taking part, in the order they first appear. */
export function participatingShops(
  experience: Experience,
): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const line of experience.experience_items ?? []) {
    const shop = line.item?.shop;
    if (shop?.id && !seen.has(shop.id)) seen.set(shop.id, shop.name);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** Groups the contents by shop, which is how the buyer will collect them. */
export function groupByShop(experience: Experience) {
  const groups = new Map<string, { shop: { id: string; name: string }; lines: ExperienceItem[] }>();
  for (const line of experience.experience_items ?? []) {
    const shop = line.item?.shop;
    if (!shop?.id) continue;
    if (!groups.has(shop.id)) groups.set(shop.id, { shop, lines: [] });
    groups.get(shop.id)!.lines.push(line);
  }
  return [...groups.values()];
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
