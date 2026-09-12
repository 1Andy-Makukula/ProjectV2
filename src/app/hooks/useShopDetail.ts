import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { parseAuthError } from '../../utils/errorParser';
import { toast } from 'sonner';
import type { CatalogItem } from '../types/items';
import type { PostSummary } from '../types/posts';
import { POST_SELECT, mapPostRow } from './useStorefrontData';

export interface Shop {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  image_url: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  /**
   * Trust signals. These columns already came back from the `select('*')`
   * below — they were simply never declared here, so the storefront could not
   * show them. No extra query is involved.
   */
  location: string | null;
  verification_status: 'pending' | 'approved' | 'rejected' | null;
  successful_deliveries: number | null;
  offers_products: boolean | null;
  offers_services: boolean | null;
  /**
   * Storefront contact and directions, added in
   * 20260807000000_shop_contact_and_hours.sql. All optional — a shop that has
   * published none of them renders exactly as it did before.
   */
  maps_link: string | null;
  public_email: string | null;
  public_phone: string | null;
  /** Raw jsonb; run it through parseOpeningHours before reading. */
  opening_hours: unknown;
  /** KithLy Rating aggregate, maintained by trigger on shop_ratings. */
  rating_count: number | null;
  rating_sum: number | null;
}

// The catalogue fields (service, discount, wholesale) come from CatalogItem so
// this list stays in step with the rest of the storefront.
export interface Item extends CatalogItem {
  currency: string;
  is_available: boolean;
}

export function useShopDetail(shopId: string | undefined) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  // A shop page that shows only a grid of products is a catalogue, not a shop.
  // These are what it is actually doing: what it has posted, and what it has
  // put together. Both ride the same Promise.all, so the page still costs one
  // round trip.
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Navigating shop to shop fires this again before the first answer lands.
    // Without the guard the slower response wins whichever order it arrives in,
    // and the page shows the shop you just left.
    let cancelled = false;

    async function fetchShopDetails() {
      if (!shopId) return;

      try {
        setLoading(true);
        const [shopResponse, itemsResponse, postsResponse] = await Promise.all([
          supabase
            .from('shops')
            .select('*')
            .eq('id', shopId)
            .eq('is_active', true)
            .single(),
          supabase
            .from('items')
            .select('*')
            .eq('shop_id', shopId)
            .eq('is_quote_only', false)
            .order('created_at', { ascending: false }),
          supabase
            .from('posts')
            .select(POST_SELECT)
            .eq('shop_id', shopId)
            .eq('status', 'published')
            .order('published_at', { ascending: false })
            .limit(20),
        ]);

        if (cancelled) return;
        if (shopResponse.error) throw shopResponse.error;
        if (itemsResponse.error) throw itemsResponse.error;

        setShop(shopResponse.data);
        setItems(itemsResponse.data || []);
        // Posts and lists are the page being richer, never the reason it fails:
        // an error on either leaves the shop and its catalogue intact.
        setPosts(
          ((postsResponse.data ?? []) as any[])
            .map(mapPostRow)
            .filter((post): post is PostSummary => post !== null),
        );
      } catch (error: any) {
        if (cancelled) return;
        console.error('[useShopDetail] Error fetching shop details:', error);
        toast.error(parseAuthError(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchShopDetails();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  return {
    shop,
    items,
    posts,
    loading,
  };
}
