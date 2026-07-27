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
