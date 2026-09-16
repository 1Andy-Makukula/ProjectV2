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
  item?: {
    id: string;
    name: string;
    description: string | null;
    price_zmw: number;
    image_url: string | null;
    is_available: boolean | null;
    is_quote_only?: boolean | null;
    shop?: { id: string; name: string } | null;
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
  experience_items?: ExperienceItem[];
}

/** Sum of the current item prices, in ngwee. Mirrors `experience_total`. */
export function experienceTotal(experience: Experience): number {
  return (experience.experience_items ?? []).reduce(
    (sum, line) => sum + line.quantity * (line.item?.price_zmw ?? 0),
    0,
  );
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
