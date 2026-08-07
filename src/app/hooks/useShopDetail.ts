import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { parseAuthError } from '../../utils/errorParser';
import { toast } from 'sonner';
import type { CatalogItem } from '../types/items';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchShopDetails() {
      if (!shopId) return;

      try {
        setLoading(true);
        const [shopResponse, itemsResponse] = await Promise.all([
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
            .order('created_at', { ascending: false })
        ]);

        if (shopResponse.error) throw shopResponse.error;
        if (itemsResponse.error) throw itemsResponse.error;

        setShop(shopResponse.data);
        setItems(itemsResponse.data || []);
      } catch (error: any) {
        console.error('[useShopDetail] Error fetching shop details:', error);
        toast.error(parseAuthError(error));
      } finally {
        setLoading(false);
      }
    }

    fetchShopDetails();
  }, [shopId]);

  return {
    shop,
    items,
    loading,
  };
}
