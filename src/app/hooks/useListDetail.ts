import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import type { ListDetail, ListEntry, ListVisibility } from '../types/lists';

/**
 * One list, by slug, with its entries resolved against live items.
 *
 * Entries are read through to `items` rather than trusting the stored snapshot,
 * so prices and availability are always current — the snapshot only fills in
 * once the merchant has deleted the item entirely.
 */
export function useListDetail(slug: string | undefined) {
  const { user } = useAuth();
  const [list, setList] = useState<ListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [myRating, setMyRating] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!slug) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('lists')
        .select(
          `id, slug, title, description, visibility, is_anonymous, is_platform,
           owner_user_id, owner_shop_id, save_count, rating_count, rating_sum, created_at,
           owner:owner_user_id(name),
           shop:owner_shop_id(name),
           list_items(
             id, item_id, snapshot_name, snapshot_image_url, sort_order,
             item:item_id(
               id, name, price_zmw, image_url, is_available, stock_quantity,
               is_discounted, original_price_zmw,
               shop:shop_id(id, name)
             )
           )`,
        )
        .eq('slug', slug)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setList(null);
        return;
      }

      const row = data as any;
      const entries: ListEntry[] = (row.list_items ?? [])
        .slice()
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((entry: any) => ({
          id: entry.id,
          item_id: entry.item_id,
          snapshot_name: entry.snapshot_name,
          snapshot_image_url: entry.snapshot_image_url,
          sort_order: entry.sort_order,
          item: entry.item
            ? {
                id: entry.item.id,
                name: entry.item.name,
                price_zmw: entry.item.price_zmw,
                image_url: entry.item.image_url,
                is_available: entry.item.is_available,
                stock_quantity: entry.item.stock_quantity,
                is_discounted: entry.item.is_discounted ?? false,
                original_price_zmw: entry.item.original_price_zmw ?? null,
                shop: entry.item.shop ?? null,
              }
            : null,
        }));

      setList({
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
          .map((entry) => entry.item?.image_url ?? entry.snapshot_image_url)
          .filter((url): url is string => Boolean(url))
          .slice(0, 4),
        created_at: row.created_at,
        entries,
      });
    } catch (error: any) {
      console.error('[useListDetail] load failed:', error);
      setList(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  // Whether the viewer has already saved or rated it — drives the toggle state
  // rather than being guessed from the aggregate counts.
  useEffect(() => {
    if (!user?.id || !list?.id) {
      setSaved(false);
      setMyRating(null);
      return;
    }

    let cancelled = false;

    Promise.all([
      supabase
        .from('list_saves')
        .select('list_id')
        .eq('list_id', list.id)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('list_ratings')
        .select('rating')
        .eq('list_id', list.id)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]).then(([saveRes, rateRes]) => {
      if (cancelled) return;
      setSaved(Boolean(saveRes.data));
      setMyRating((rateRes.data as any)?.rating ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id, list?.id]);

  const isOwner = Boolean(
    list && user?.id && list.owner_user_id === user.id,
  );

  return { list, loading, saved, setSaved, myRating, setMyRating, isOwner, reload: load };
}
