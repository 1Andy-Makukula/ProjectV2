import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogItem } from '../types/items';
import type { ListSummary } from '../types/lists';
import { LIST_SELECT, toSummary } from './useLists';
import type { PostAttachment, PostImage, PostStatus, PostSummary } from '../types/posts';

export interface Campaign {
  id: string;
  image_url: string;
  title: string;
  target_route: string;
  sort_order: number;
}

export interface StorefrontShop {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  image_url: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  /** Drives the open/closed state on the card. Null when never published. */
  opening_hours: unknown | null;
  itemCount: number;
  rating_count: number | null;
  rating_sum: number | null;
}

export interface StorefrontData {
  campaigns: Campaign[];
  shops: StorefrontShop[];
  items: CatalogItem[];
  /** The community feed behind the Lists mode. */
  lists: ListSummary[];
  /**
   * Shop posts, newest first.
   *
   * Fetched once like everything else here. Every mode shows posts, and that
   * costs nothing extra precisely because it is this one read being re-sliced
   * rather than a per-mode query.
   */
  posts: PostSummary[];
}

export const FALLBACK_CAMPAIGNS: Campaign[] = [
  {
    id: 'f1',
    image_url:
      'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&w=1400&q=80',
    title: 'Send a gift that actually means something.',
    target_route: '/shops',
    sort_order: 0,
  },
  {
    id: 'f2',
    image_url:
      'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&w=1400&q=80',
    title: 'Discover local shops crafting unforgettable moments.',
    target_route: '/shops',
    sort_order: 1,
  },
  {
    id: 'f3',
    image_url:
      'https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&w=1400&q=80',
    title: 'Every order tells a story worth sharing.',
    target_route: '/shops',
    sort_order: 2,
  },
];

/**
 * The columns a post card needs, in one place.
 *
 * Shared with PostDetail so a post fetched on its own page is the same shape as
 * one fetched for the feed. Two select strings for one card is how a field ends
 * up present in one view and undefined in the other.
 *
 * Images and attached items are embedded rather than fetched per post: a post
 * carries up to ten photographs, so a per-row query would be an N+1 on the
 * heaviest payload the storefront loads.
 *
 * post_likes and post_saves are embedded for the same round trip, and RLS does
 * the work — both tables only ever return the reader's own rows, so a non-empty
 * array means "you have already done this" and an anonymous reader simply gets
 * nothing. No extra query, and no way to read anybody else's.
 */
export const POST_SELECT =
  'id, caption, location_label, status, published_at, like_count, save_count, ' +
  'shop:shop_id(id, name, logo_url, location, verification_status, ' +
  'offers_products, offers_services), ' +
  'post_images(id, image_url, sort_order, alt_text, width, height), ' +
  'post_items(id, item_id, snapshot_name, snapshot_image_url, sort_order, is_primary, ' +
  'item:item_id(item_type)), ' +
  'post_likes(post_id), post_saves(post_id)';

/**
 * One post row, as the UI reads it.
 *
 * Returns null when the shop did not come back: the card is built around who
 * posted it, and RLS is the usual reason — an inactive shop's posts stop being
 * readable along with the shop itself.
 */
export function mapPostRow(row: any): PostSummary | null {
  if (!row?.shop) return null;

  const images: PostImage[] = (row.post_images ?? [])
    .slice()
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((image: any) => ({
      id: image.id,
      image_url: image.image_url,
      sort_order: image.sort_order ?? 0,
      alt_text: image.alt_text ?? null,
      width: image.width ?? null,
      height: image.height ?? null,
    }));

  const attachments: PostAttachment[] = (row.post_items ?? [])
    .slice()
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((attachment: any) => ({
      id: attachment.id,
      item_id: attachment.item_id ?? null,
      snapshot_name: attachment.snapshot_name,
      snapshot_image_url: attachment.snapshot_image_url ?? null,
      sort_order: attachment.sort_order ?? 0,
      is_primary: attachment.is_primary ?? false,
      item_type: attachment.item?.item_type ?? null,
    }));

  return {
    id: row.id,
    author: {
      id: row.shop.id,
      name: row.shop.name,
      logo_url: row.shop.logo_url ?? null,
      location: row.shop.location ?? null,
      is_verified: row.shop.verification_status === 'approved',
      offers_products: row.shop.offers_products ?? true,
      offers_services: row.shop.offers_services ?? false,
    },
    caption: row.caption ?? null,
    location_label: row.location_label ?? null,
    status: (row.status ?? 'published') as PostStatus,
    published_at: row.published_at ?? null,
    images,
    attachments,
    like_count: row.like_count ?? 0,
    save_count: row.save_count ?? 0,
    liked_by_me: (row.post_likes ?? []).length > 0,
    saved_by_me: (row.post_saves ?? []).length > 0,
  };
}

/**
 * The storefront's data, fetched once regardless of which face is showing.
 *
 * Every mode reads from this same result and differs only in what it renders
 * and in what order — switching mode is instant because it does not refetch
 * anything.
 *
 * Lists are the one payload that is not a re-slice of the others, and they are
 * loaded here anyway to keep that property. A capped community feed is a cheap
 * addition to a Promise.all that already runs three reads.
 */
export function useStorefrontData() {
  const [data, setData] = useState<StorefrontData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [bannersRes, shopsRes, itemsRes, listsRes, postsRes] = await Promise.all([
          supabase
            .from('marketing_campaigns')
            .select('id, image_url, title, target_route, sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .limit(6),

          supabase
            .from('shops')
            .select(
              'id, name, description, location, image_url, logo_url, cover_image_url, opening_hours, ' +
                'rating_count, rating_sum',
            )
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(12),

          supabase
            .from('items')
            .select(
              'id, name, description, price_zmw, image_url, item_type, requires_scheduling, ' +
                'lead_time_days, allow_custom_quote, price_is_minimum, is_discounted, ' +
                'original_price_zmw, is_weekly_pick, promo_badge_text, stock_quantity, ' +
                // The gallery a tile breathes through. Capped at five by
                // item_images' own constraint, so this cannot run away.
                'item_images(image_url, sort_order), ' +
                // location and mark feed the menu layout's per-business header.
                'shop:shops(id, name, location, logo_url)',
            )
            .eq('is_available', true)
            .eq('is_quote_only', false)
            .order('created_at', { ascending: false })
            .limit(48),

          // Newest first: ranking by rating on a handful of votes is noise, so
          // the KithLy Rating shows on the card without steering the order.
          supabase
            .from('lists')
            .select(LIST_SELECT)
            .eq('visibility', 'community')
            .order('created_at', { ascending: false })
            .limit(12),

          supabase
            .from('posts')
            .select(POST_SELECT)
            .eq('status', 'published')
            .order('published_at', { ascending: false })
            .limit(12),
        ]);

        if (cancelled) return;

        const campaigns: Campaign[] =
          bannersRes.data && bannersRes.data.length > 0
            ? (bannersRes.data as Campaign[])
            : FALLBACK_CAMPAIGNS;

        // Counted separately: a nested count on the shops query returns a 400
        // from PostgREST here.
        const shops: StorefrontShop[] = await Promise.all(
          (shopsRes.data ?? []).map(async (s: any) => {
            const { count } = await supabase
              .from('items')
              .select('*', { count: 'exact', head: true })
              .eq('shop_id', s.id)
              .eq('is_available', true)
              .eq('is_quote_only', false);

            return {
              id: s.id,
              name: s.name,
              description: s.description,
              location: s.location,
              image_url: s.image_url ?? null,
              logo_url: s.logo_url ?? null,
              cover_image_url: s.cover_image_url ?? null,
              opening_hours: s.opening_hours ?? null,
              itemCount: count ?? 0,
              rating_count: s.rating_count ?? null,
              rating_sum: s.rating_sum ?? null,
            };
          }),
        );

        const items = (itemsRes.data ?? []).map((i: any) => ({
          ...i,
          item_type: i.item_type ?? 'product',
          requires_scheduling: i.requires_scheduling ?? false,
          allow_custom_quote: i.allow_custom_quote ?? false,
          price_is_minimum: i.price_is_minimum ?? false,
          is_discounted: i.is_discounted ?? false,
          // Left as null when untracked — see isOutOfStock.
          stock_quantity: i.stock_quantity ?? null,
        })) as CatalogItem[];

        const lists: ListSummary[] = (listsRes.data ?? []).map(toSummary);

        const posts: PostSummary[] = (postsRes.data ?? [])
          .map(mapPostRow)
          .filter((post): post is PostSummary => post !== null);

        if (!cancelled) setData({ campaigns, shops, items, lists, posts });
      } catch (err) {
        console.error('[useStorefrontData] load error:', err);
        if (!cancelled) {
          setData({ campaigns: FALLBACK_CAMPAIGNS, shops: [], items: [], lists: [], posts: [] });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading };
}
