// Shared vocabulary for posts.
//
// A post is a shop advertising inside KithLy: photographs, a caption, and a
// binding to the items it is about. The post is the advert; the items are what
// is actually sold.
//
// These are the shapes the UI reads, not the database rows — the same split
// `lists.ts` and `items.ts` make. The hook that fetches posts maps the rows on
// to these, so a card never has to know that images live in a child table.

/**
 * Where a post is in its life.
 *
 * One field rather than a status plus an is_active flag: two ways to say the
 * same thing is two ways to disagree. Mirrors the CHECK constraint on
 * `posts.status`.
 */
export type PostStatus = 'draft' | 'published' | 'archived';

export const POST_STATUSES: ReadonlyArray<{
  value: PostStatus;
  label: string;
  description: string;
}> = [
  {
    value: 'draft',
    label: 'Draft',
    description: 'Only your shop can see it.',
  },
  {
    value: 'published',
    label: 'Published',
    description: 'Visible to everyone browsing KithLy.',
  },
  {
    value: 'archived',
    label: 'Archived',
    description: 'Taken down, but kept.',
  },
];

/**
 * The image cap, mirrored from the database.
 *
 * `post_images` bounds this with a unique slot per post over a 0–9 range, so
 * the real enforcement is there and this is only what the composer should let
 * somebody try. If the two ever disagree, the database is right.
 */
export const MAX_POST_IMAGES = 10;

export interface PostImage {
  id: string;
  image_url: string;
  sort_order: number;
  alt_text: string | null;
  width: number | null;
  height: number | null;
}

/**
 * An item a post sells.
 *
 * `item_id` is nullable because `post_items.item_id` is ON DELETE SET NULL: the
 * entry outlives the item so the Buy sheet can say "no longer available"
 * instead of the line silently vanishing. The snapshot is what keeps it
 * renderable once that has happened.
 *
 * There is no price here, deliberately, and there should never be one. A post
 * is long-lived and a price is not; the sheet resolves money at the moment
 * somebody taps Buy, through the same basket path the cart uses.
 */
export interface PostAttachment {
  id: string;
  item_id: string | null;
  snapshot_name: string;
  snapshot_image_url: string | null;
  sort_order: number;
  is_primary: boolean;
  /**
   * What the attached item is, when it still exists. This is what gives a post
   * its character, and therefore which modes show it — see `postMatchesFilter`.
   */
  item_type: 'product' | 'service' | null;
}

/** Who posted it — enough to draw the card header without a second query. */
export interface PostAuthor {
  id: string;
  name: string;
  logo_url: string | null;
  location: string | null;
  /** Drives the tick on the card. Mirrors `shops.verification_status`. */
  is_verified: boolean;
  /**
   * What the shop sells, which is what the Buy/Order verb is chosen from.
   * From `shops.offers_products` / `offers_services`.
   */
  offers_products: boolean;
  offers_services: boolean;
}

/** One card in the feed. */
export interface PostSummary {
  id: string;
  author: PostAuthor;
  caption: string | null;
  /** Free text on the post, not a branch record — shops have one location. */
  location_label: string | null;
  status: PostStatus;
  published_at: string | null;
  images: PostImage[];
  attachments: PostAttachment[];
  like_count: number;
  save_count: number;
  /** Whether the person reading it has already liked or saved it. */
  liked_by_me: boolean;
  saved_by_me: boolean;
}

/**
 * Whether a post can be bought at all.
 *
 * A post with nothing attached is an advert and nothing more — it still likes,
 * saves and shares, but there is no basket to build, so the card shows no Buy.
 */
export function isPurchasable(post: PostSummary): boolean {
  return post.attachments.some((attachment) => attachment.item_id !== null);
}

/**
 * Who can see a wish.
 *
 * Contact-possession alone is never the rule — `contacts` are one-directional
 * and phone-keyed, so anybody can add anybody's number. The wish carries its
 * own audience on top of that.
 *
 * `all` means all of that person's contacts. It does not mean the public
 * internet, and the copy below says so out loud because that is exactly the
 * word people misread.
 */
export type WishVisibility = 'all' | 'except' | 'only';

export const WISH_VISIBILITIES: ReadonlyArray<{
  value: WishVisibility;
  label: string;
  description: string;
}> = [
  {
    value: 'all',
    label: 'Anyone who has me saved',
    description: 'People with your number in their KithLy contacts. Not the public.',
  },
  {
    value: 'except',
    label: 'Everyone except…',
    description: 'The same, minus the people you pick.',
  },
  {
    value: 'only',
    label: 'Only…',
    description: 'Nobody but the people you pick.',
  },
];

/** A wish somebody in your contacts has made. */
export interface ContactWish {
  wish_id: string;
  post_id: string;
  wisher_id: string;
  /** The name YOU filed them under — "Mum", not their account name. */
  wisher_name: string;
  note: string | null;
  created_at: string;
}

/** Your own wish on a post. */
export interface MyWish {
  id: string;
  post_id: string;
  note: string | null;
  visibility: WishVisibility;
  audience: string[];
}

/**
 * What the Buy action is called on this shop's posts.
 *
 * DECIDED 2026-09-12: the shop owns this verb on a post card, not the shopper's
 * mode. A post is the shop's own surface, and `ModeLexicon` — which renames the
 * cart per mode — deliberately stays out of it. The mode lexicon still owns the
 * item feed. Two sources of truth for one button label is a support ticket, and
 * `storefrontModes.ts` says so itself; this is that decision written down.
 *
 * Derived from what the shop actually offers. The reference designs show
 * "Order" for a restaurant, but nothing in the schema distinguishes a
 * restaurant from any other shop selling goods, so that would be a guess
 * wearing the clothes of a rule. It stays "Buy" until a category exists to
 * base it on.
 */
export function postActionLabel(author: PostAuthor): string {
  if (author.offers_services && !author.offers_products) return 'Book';
  return 'Buy';
}

/**
 * Whether a post belongs in a mode showing only products, or only services.
 *
 * Posts appear in every mode; what changes per mode is which ones. The rule
 * mirrors `itemFilter` on the item feed, so a post follows the same logic its
 * items do rather than inventing a second one.
 *
 * A post with nothing attached, or nothing attached that still exists, is pure
 * advertising and belongs everywhere — filtering it out would punish exactly
 * the posts with the least to go on.
 */
export function postMatchesFilter(
  post: PostSummary,
  filter: 'product' | 'service' | null,
): boolean {
  if (filter === null) return true;

  const known = post.attachments.filter((attachment) => attachment.item_type !== null);
  if (known.length === 0) return true;

  return known.some((attachment) => attachment.item_type === filter);
}

/**
 * The picture the card leads with.
 *
 * sort_order 0 is the hero; the rest fill the collage beside it.
 */
export function heroImage(post: PostSummary): PostImage | null {
  return post.images.length > 0 ? post.images[0] : null;
}
