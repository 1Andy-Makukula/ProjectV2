import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { invokeFunction } from '../../utils/edgeFunction';
import type { ItemType } from '../types/items';

export interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  suggested_price_zmw: number | null;
  category_id: string | null;
  item_type: ItemType;
  is_active: boolean;
  created_at: string;
  images: string[];
}

export interface CatalogDraft {
  name: string;
  description: string;
  suggested_price_zmw: number | null;
  category_id: string | null;
  item_type: ItemType;
}

interface CatalogImageRow {
  image_url: string;
  sort_order: number;
}

/**
 * The admin-curated template library.
 *
 * Read by any signed-in user (merchants browse it to import); written only by
 * admins, enforced by RLS rather than by hiding buttons.
 */
export function useCatalog() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('catalog_items')
        .select(
          'id, name, description, suggested_price_zmw, category_id, item_type, is_active, created_at, ' +
            'catalog_item_images(image_url, sort_order)',
        )
        .order('created_at', { ascending: false });

      if (error) throw error;

      setItems(
        (data ?? []).map((row: any) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          suggested_price_zmw: row.suggested_price_zmw,
          category_id: row.category_id,
          item_type: (row.item_type as ItemType) ?? 'product',
          is_active: row.is_active ?? true,
          created_at: row.created_at,
          // PostgREST cannot order an embedded relation, so sort here.
          images: ((row.catalog_item_images ?? []) as CatalogImageRow[])
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((image) => image.image_url),
        })),
      );
    } catch (error: any) {
      console.error('[useCatalog] load failed:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createItem = useCallback(
    async (draft: CatalogDraft, imageUrls: string[]) => {
      try {
        const { data: user } = await supabase.auth.getUser();

        const { data, error } = await supabase
          .from('catalog_items')
          .insert([{ ...draft, created_by: user.user?.id ?? null }])
          .select('id')
          .single();

        if (error) throw error;

        if (imageUrls.length > 0) {
          const { error: imageError } = await supabase.from('catalog_item_images').insert(
            imageUrls.slice(0, 5).map((image_url, sort_order) => ({
              catalog_item_id: data.id,
              image_url,
              sort_order,
            })),
          );
          if (imageError) throw imageError;
        }

        toast.success('Added to the catalogue');
        await load();
        return true;
      } catch (error: any) {
        console.error('[useCatalog] create failed:', error);
        toast.error(parseAuthError(error));
        return false;
      }
    },
    [load],
  );

  /**
   * Retiring rather than deleting.
   *
   * Shops that already imported an entry keep their own independent copy, so a
   * hard delete would not break them — but the storage objects behind a
   * catalogue entry are shared with nothing, and keeping the row preserves the
   * record of what was once offered.
   */
  const setActive = useCallback(
    async (id: string, isActive: boolean) => {
      try {
        const { error } = await supabase
          .from('catalog_items')
          .update({ is_active: isActive })
          .eq('id', id);
        if (error) throw error;

        setItems((current) =>
          current.map((item) => (item.id === id ? { ...item, is_active: isActive } : item)),
        );
      } catch (error: any) {
        console.error('[useCatalog] retire failed:', error);
        toast.error(parseAuthError(error));
      }
    },
    [],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      try {
        const { error } = await supabase.from('catalog_items').delete().eq('id', id);
        if (error) throw error;
        toast.success('Removed from the catalogue');
        await load();
        return true;
      } catch (error: any) {
        console.error('[useCatalog] delete failed:', error);
        toast.error(parseAuthError(error));
        return false;
      }
    },
    [load],
  );

  /**
   * Copies a catalogue entry into a shop.
   *
   * Goes through the Edge Function rather than straight to the RPC because the
   * image files have to be duplicated first — see import-catalog-item.
   */
  const importToShop = useCallback(
    async (catalogItemId: string, shopId: string, priceZmw: number) => {
      try {
        setImporting(true);
        await invokeFunction('import-catalog-item', {
          catalog_item_id: catalogItemId,
          shop_id: shopId,
          price_zmw: priceZmw,
        });
        toast.success('Added to your shop. Edit it there to make it yours.');
        return true;
      } catch (error: any) {
        console.error('[useCatalog] import failed:', error);
        toast.error(error?.message ?? 'Could not import this item');
        return false;
      } finally {
        setImporting(false);
      }
    },
    [],
  );

  return { items, loading, importing, reload: load, createItem, setActive, deleteItem, importToShop };
}
