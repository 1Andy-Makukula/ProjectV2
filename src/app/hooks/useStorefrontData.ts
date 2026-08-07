import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogItem } from '../types/items';
import type { ListSummary, ListVisibility } from '../types/lists';

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
        const [bannersRes, shopsRes, itemsRes, listsRes] = await Promise.all([
          supabase
            .from('marketing_campaigns')
            .select('id, image_url, title, target_route, sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .limit(6),

          supabase
            .from('shops')
            .select(
              'id, name, description, location, image_url, logo_url, cover_image_url, ' +
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
                // location feeds the menu layout's per-business header.
                'shop:shops(id, name, location)',
            )
            .eq('is_available', true)
            .eq('is_quote_only', false)
            .order('created_at', { ascending: false })
            .limit(48),

          // Newest first: ranking by rating on a handful of votes is noise, so
          // the KithLy Rating shows on the card without steering the order.
          supabase
            .from('lists')
            .select(
              'id, slug, title, description, visibility, is_anonymous, is_platform, ' +
                'owner_user_id, owner_shop_id, save_count, rating_count, rating_sum, created_at, ' +
                'owner:owner_user_id(name), shop:owner_shop_id(name), ' +
                'list_items(snapshot_image_url, sort_order, item:item_id(image_url))',
            )
            .eq('visibility', 'community')
            .order('created_at', { ascending: false })
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

        const lists: ListSummary[] = (listsRes.data ?? []).map((row: any) => {
          const entries = (row.list_items ?? [])
            .slice()
            .sort((a: any, b: any) => a.sort_order - b.sort_order);

          return {
            id: row.id,
            slug: row.slug,
            title: row.title,
            description: row.description,
            visibility: row.visibility as ListVisibility,
            is_anonymous: row.is_anonymous ?? false,
            is_platform: row.is_platform ?? false,
            owner_user_id: row.owner_user_id,
            owner_shop_id: row.owner_shop_id,
            owner_name: row.owner?.name ?? null,
            shop_name: row.shop?.name ?? null,
            save_count: row.save_count ?? 0,
            rating_count: row.rating_count ?? 0,
            rating_sum: row.rating_sum ?? 0,
            item_count: entries.length,
            preview_images: entries
              .map((entry: any) => entry.item?.image_url ?? entry.snapshot_image_url)
              .filter(Boolean)
              .slice(0, 4),
            created_at: row.created_at,
          };
        });

        if (!cancelled) setData({ campaigns, shops, items, lists });
      } catch (err) {
        console.error('[useStorefrontData] load error:', err);
        if (!cancelled) setData({ campaigns: FALLBACK_CAMPAIGNS, shops: [], items: [], lists: [] });
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
