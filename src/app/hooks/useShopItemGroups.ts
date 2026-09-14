// How one shop's items are organised.
//
// The order -- merchant collections if any hold items, else category, else flat
// -- is decided by `shop_item_groups()` in the database, not here. That is the
// whole point of it: ShopDetail, the storefront and the Composer all ask the
// same function, so they cannot drift into three different answers about the
// same shop.
//
// This hook only shapes the result. It takes the items the page has already
// fetched rather than fetching them again, because the grouping call returns
// ids and the page already holds the rows.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

interface GroupRow {
  group_key: string;
  group_label: string | null;
  group_source: 'collection' | 'category' | 'flat';
  group_sort: number;
  item_id: string;
  item_sort: number;
}

export interface ItemGroup<T> {
  key: string;
  /** Null on the flat grouping, where there is nothing to call it. */
  label: string | null;
  source: 'collection' | 'category' | 'flat';
  items: T[];
}

export function useShopItemGroups<T extends { id: string }>(
  shopId: string | undefined,
  items: T[],
) {
  const [rows, setRows] = useState<GroupRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!shopId) {
      setRows(null);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('shop_item_groups', { p_shop_id: shopId });
      if (cancelled) return;

      if (error) {
        // Falling back to one ungrouped list is the right failure: a shop that
        // renders flat is the behaviour of every shop before this existed.
        console.error('[useShopItemGroups] failed, falling back to flat:', error);
        setRows(null);
      } else {
        setRows((data as GroupRow[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [shopId]);

  const groups = useMemo<ItemGroup<T>[]>(() => {
    if (!rows || rows.length === 0) {
      return items.length > 0
        ? [{ key: 'all', label: null, source: 'flat', items }]
        : [];
    }

    const byId = new Map(items.map((item) => [item.id, item]));
    const buckets = new Map<string, ItemGroup<T> & { sort: number }>();

    for (const row of rows) {
      // An item the page did not fetch -- unavailable, or filtered by RLS --
      // is skipped rather than rendered as a hole.
      const item = byId.get(row.item_id);
      if (!item) continue;

      let bucket = buckets.get(row.group_key);
      if (!bucket) {
        bucket = {
          key: row.group_key,
          label: row.group_label,
          source: row.group_source,
          items: [],
          sort: row.group_sort,
        };
        buckets.set(row.group_key, bucket);
      }
      bucket.items.push(item);
    }

    // Empty groups cannot occur -- the function only emits rows for items --
    // but a group whose every item was filtered above can, so drop those.
    return [...buckets.values()]
      .filter((b) => b.items.length > 0)
      .sort((a, b) => a.sort - b.sort || (a.label ?? '').localeCompare(b.label ?? ''))
      .map(({ sort: _sort, ...group }) => group);
  }, [rows, items]);

  /** True when there is more than one named group worth showing headings for. */
  const isGrouped = groups.length > 1 || (groups[0]?.label != null);

  return { groups, isGrouped, loading };
}
