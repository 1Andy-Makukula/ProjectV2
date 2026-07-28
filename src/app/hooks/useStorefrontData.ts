import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogItem } from '../types/items';

export interface Campaign {
  id: string;
  image_url: string;
  title: string;
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
}

export interface StorefrontData {
  campaigns: Campaign[];
  shops: StorefrontShop[];
  items: CatalogItem[];
}

export const FALLBACK_CAMPAIGNS: Campaign[] = [
  {
    id: 'f1',
    image_url:
      'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&w=1400&q=80',
    title: 'Send a gift that actually means something.',
    sort_order: 0,
  },
  {
    id: 'f2',
    image_url:
      'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&w=1400&q=80',
    title: 'Discover local shops crafting unforgettable moments.',
    sort_order: 1,
  },
  {
    id: 'f3',
    image_url:
      'https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&w=1400&q=80',
    title: 'Every order tells a story worth sharing.',
    sort_order: 2,
  },
];

/**
 * The storefront's data, fetched once regardless of which face is showing.
 *
 * All five modes read from this same result and differ only in what they
 * render and in what order — switching mode is instant because it does not
 * refetch anything.
 */
export function useStorefrontData() {
  const [data, setData] = useState<StorefrontData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [bannersRes, shopsRes, itemsRes] = await Promise.all([
          supabase
            .from('marketing_campaigns')
            .select('id, image_url, title, sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .limit(6),

          supabase
            .from('shops')
            .select('id, name, description, location, image_url, logo_url, cover_image_url')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(12),

          supabase
            .from('items')
            .select(
              'id, name, description, price_zmw, image_url, item_type, requires_scheduling, ' +
                'lead_time_days, allow_custom_quote, is_discounted, original_price_zmw, ' +
                'is_weekly_pick, promo_badge_text, shop:shops(id, name)',
            )
            .eq('is_available', true)
            .eq('is_quote_only', false)
            .order('created_at', { ascending: false })
            .limit(48),
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
            };
          }),
        );

        const items = (itemsRes.data ?? []).map((i: any) => ({
          ...i,
          item_type: i.item_type ?? 'product',
          requires_scheduling: i.requires_scheduling ?? false,
          allow_custom_quote: i.allow_custom_quote ?? false,
          is_discounted: i.is_discounted ?? false,
        })) as CatalogItem[];

        if (!cancelled) setData({ campaigns, shops, items });
      } catch (err) {
        console.error('[useStorefrontData] load error:', err);
        if (!cancelled) setData({ campaigns: FALLBACK_CAMPAIGNS, shops: [], items: [] });
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
