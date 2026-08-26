import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import type { CatalogItem } from '../types/items';

export function useItemDetail(itemId?: string) {
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!itemId) {
      setLoading(false);
      return;
    }

    // Captured after the guard. itemId is a hook argument, so TypeScript cannot
    // carry the narrowing into the closure below -- and an undefined id reaching
    // .eq() queries for the wrong thing rather than failing.
    const id = itemId;

    let cancelled = false;

    async function fetchItem() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('items')
          // item_images is ordered client-side: PostgREST cannot order an
          // embedded relation, and a gallery is at most five rows.
          .select(
            '*, shop:shops(id, name, location), item_images(image_url, sort_order), ' +
              'item_price_tiers(min_quantity, unit_price_zmw), ' +
              // Ordered client-side: PostgREST cannot sort a nested relation.
              'item_option_groups(id, label, kind, allow_multiple, is_required, ' +
              'min_value, max_value, unit_price_delta_zmw, sort_order, ' +
              'options:item_options(id, label, price_delta_zmw, is_available, sort_order))',
          )
          .eq('id', id)
          .eq('is_available', true)
          .single();

        if (error) throw error;
        if (!cancelled) setItem(data as unknown as CatalogItem);
      } catch (error: any) {
        console.error('[useItemDetail] Error fetching item:', error);
        // A missing row is an expected outcome for a stale link, not a failure
        // worth shouting about — the page renders its own not-found state.
        if (error?.code !== 'PGRST116') {
          toast.error(parseAuthError(error));
        }
        if (!cancelled) setItem(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchItem();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return { item, loading };
}
