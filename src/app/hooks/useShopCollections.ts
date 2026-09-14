// A shop's own way of grouping what it sells.
//
// Collections are the first of the two layers that decide how a shop page is
// organised; where a merchant makes none, the storefront falls back to
// category. That resolution order lives in `shop_item_groups()` in the
// database, not here -- this hook is only the editing side.
//
// Membership carries shop_id because the composite foreign keys use it to make
// a cross-shop membership structurally impossible. It is derivable from the
// collection, and passing it explicitly is what lets the database refuse rather
// than trust us.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabaseClient';

export interface ShopCollection {
  id: string;
  shop_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  item_ids: string[];
}

export interface CollectableItem {
  id: string;
  name: string;
  image_url: string | null;
  price_zmw: number;
}

export function useShopCollections(shopId: string | null | undefined) {
  const [collections, setCollections] = useState<ShopCollection[]>([]);
  const [items, setItems] = useState<CollectableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) {
      setCollections([]);
      setItems([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [collectionsResult, itemsResult] = await Promise.all([
        supabase
          .from('shop_collections')
          .select('id, shop_id, name, description, sort_order, is_active, shop_collection_items(item_id)')
          .eq('shop_id', shopId)
          .order('sort_order')
          .order('name'),
        supabase
          .from('items')
          .select('id, name, image_url, price_zmw')
          .eq('shop_id', shopId)
          .order('name'),
      ]);

      if (collectionsResult.error) throw collectionsResult.error;
      if (itemsResult.error) throw itemsResult.error;

      setCollections(
        (collectionsResult.data ?? []).map((row: any) => ({
          id: row.id,
          shop_id: row.shop_id,
          name: row.name,
          description: row.description,
          sort_order: row.sort_order,
          is_active: row.is_active,
          item_ids: (row.shop_collection_items ?? []).map((m: any) => m.item_id),
        })),
      );
      setItems((itemsResult.data as CollectableItem[]) ?? []);
    } catch (err) {
      console.error('[useShopCollections] load failed:', err);
      toast.error('Could not load your collections');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCollection = useCallback(
    async (name: string, description?: string) => {
      if (!shopId || !name.trim()) return;
      setSaving(true);
      try {
        const { error } = await supabase.from('shop_collections').insert({
          shop_id: shopId,
          name: name.trim(),
          description: description?.trim() || null,
          sort_order: collections.length,
        });
        if (error) {
          // The (shop_id, name) unique constraint is the likely one, and
          // "you already have a collection called that" beats the raw text.
          toast.error(
            error.code === '23505'
              ? 'You already have a collection with that name'
              : 'Could not create that collection',
          );
          return;
        }
        await load();
      } finally {
        setSaving(false);
      }
    },
    [shopId, collections.length, load],
  );

  const renameCollection = useCallback(
    async (id: string, name: string) => {
      if (!name.trim()) return;
      const { error } = await supabase
        .from('shop_collections')
        .update({ name: name.trim() })
        .eq('id', id);
      if (error) {
        toast.error('Could not rename that collection');
        return;
      }
      await load();
    },
    [load],
  );

  const removeCollection = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('shop_collections').delete().eq('id', id);
      if (error) {
        toast.error('Could not remove that collection');
        return;
      }
      setCollections((prev) => prev.filter((c) => c.id !== id));
    },
    [],
  );

  /** Adds or removes one item. The membership row carries shop_id; see the header. */
  const toggleItem = useCallback(
    async (collectionId: string, itemId: string, shouldBeIn: boolean) => {
      if (!shopId) return;
      setSaving(true);
      try {
        const { error } = shouldBeIn
          ? await supabase
              .from('shop_collection_items')
              .insert({ collection_id: collectionId, item_id: itemId, shop_id: shopId })
          : await supabase
              .from('shop_collection_items')
              .delete()
              .eq('collection_id', collectionId)
              .eq('item_id', itemId);

        if (error) {
          toast.error('Could not change that collection');
          return;
        }

        setCollections((prev) =>
          prev.map((c) =>
            c.id !== collectionId
              ? c
              : {
                  ...c,
                  item_ids: shouldBeIn
                    ? [...c.item_ids, itemId]
                    : c.item_ids.filter((id) => id !== itemId),
                },
          ),
        );
      } finally {
        setSaving(false);
      }
    },
    [shopId],
  );

  return {
    collections,
    items,
    loading,
    saving,
    createCollection,
    renameCollection,
    removeCollection,
    toggleItem,
    refresh: load,
  };
}
