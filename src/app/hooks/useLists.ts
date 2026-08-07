import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { useAuth } from '../../utils/auth/AuthContext';
import type { ListSummary, ListVisibility } from '../types/lists';

/**
 * The columns every list surface needs. Owner names are joined so a card can be
 * attributed without a second round trip; list_items is counted and sampled for
 * the collage tile in the same query.
 */
const LIST_SELECT = `
  id, slug, title, description, visibility, is_anonymous, is_platform,
  owner_user_id, owner_shop_id, save_count, rating_count, rating_sum, created_at,
  owner:owner_user_id(name),
  shop:owner_shop_id(name),
  list_items(snapshot_image_url, sort_order, item:item_id(image_url))
`;

function toSummary(row: any): ListSummary {
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
}

/**
 * The community feed.
 *
 * Ordered newest first rather than by rating: ranking on a handful of votes is
 * noise, so the KithLy Rating is shown on the card without steering the order
 * until there is enough volume for it to mean something.
 */
export function useCommunityLists(limit = 24) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('lists')
        .select(LIST_SELECT)
        .eq('visibility', 'community')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      setLists((data ?? []).map(toSummary));
    } catch (error: any) {
      console.error('[useCommunityLists] load failed:', error);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  return { lists, loading, reload: load };
}

export interface CreateListInput {
  title: string;
  description?: string;
  visibility: ListVisibility;
  is_anonymous?: boolean;
  /** Set to publish under the KithLy name. Admin-only; RLS rejects it otherwise. */
  is_platform?: boolean;
  /** Owning shop, for a merchant's list. Omit for a personal one. */
  owner_shop_id?: string;
}

/**
 * The signed-in person's own lists, plus the ones they have saved.
 *
 * Saving is a bookmark: a saved list stays the owner's and keeps showing their
 * updates. Copying is separate and mints an independent list.
 */
export function useMyLists() {
  const { user } = useAuth();
  const [owned, setOwned] = useState<ListSummary[]>([]);
  const [saved, setSaved] = useState<ListSummary[]>([]);
  const [shopOwned, setShopOwned] = useState<ListSummary[]>([]);
  const [myShopId, setMyShopId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) {
      setOwned([]);
      setSaved([]);
      setShopOwned([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // A merchant's lists belong to their shop, not to them personally, so
      // the shop has to be resolved before they can be loaded.
      const { data: assignment } = await supabase
        .from('merchant_shops')
        .select('shop_id')
        .eq('user_id', user.id)
        .maybeSingle();

      const shopId = (assignment as any)?.shop_id ?? null;
      setMyShopId(shopId);

      const [ownedRes, savedRes, shopRes] = await Promise.all([
        supabase
          .from('lists')
          .select(LIST_SELECT)
          .eq('owner_user_id', user.id)
          .order('updated_at', { ascending: false }),
        supabase
          .from('list_saves')
          .select(`created_at, list:list_id(${LIST_SELECT})`)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        shopId
          ? supabase
              .from('lists')
              .select(LIST_SELECT)
              .eq('owner_shop_id', shopId)
              .order('updated_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (ownedRes.error) throw ownedRes.error;
      if (savedRes.error) throw savedRes.error;
      if (shopRes.error) throw shopRes.error;

      setOwned((ownedRes.data ?? []).map(toSummary));
      setShopOwned((shopRes.data ?? []).map(toSummary));
      setSaved(
        (savedRes.data ?? [])
          .map((row: any) => row.list)
          // A saved list whose owner deleted it comes back null.
          .filter(Boolean)
          .map(toSummary),
      );
    } catch (error: any) {
      console.error('[useMyLists] load failed:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const createList = useCallback(
    async (input: CreateListInput) => {
      if (!user?.id) {
        toast.error('Sign in to make a list');
        return null;
      }

      try {
        const { data: slug, error: slugError } = await supabase.rpc('generate_list_slug', {
          p_title: input.title,
        });
        if (slugError) throw slugError;

        const { data, error } = await supabase
          .from('lists')
          .insert([
            {
              slug,
              title: input.title.trim(),
              description: input.description?.trim() || null,
              visibility: input.visibility,
              is_anonymous: input.is_anonymous ?? false,
              is_platform: input.is_platform ?? false,
              // Exactly one owner — lists_single_owner_check enforces it.
              owner_shop_id: input.owner_shop_id ?? null,
              owner_user_id: input.owner_shop_id ? null : user.id,
            },
          ])
          .select('id, slug')
          .single();

        if (error) throw error;

        toast.success('List created');
        await load();
        return data as { id: string; slug: string };
      } catch (error: any) {
        console.error('[useMyLists] create failed:', error);
        toast.error(parseAuthError(error));
        return null;
      }
    },
    [user?.id, load],
  );

  const deleteList = useCallback(
    async (id: string) => {
      try {
        const { error } = await supabase.from('lists').delete().eq('id', id);
        if (error) throw error;
        toast.success('List deleted');
        await load();
        return true;
      } catch (error: any) {
        console.error('[useMyLists] delete failed:', error);
        toast.error(parseAuthError(error));
        return false;
      }
    },
    [load],
  );

  return { owned, saved, shopOwned, myShopId, loading, reload: load, createList, deleteList };
}

/** Shop-owned lists, for the merchant dashboard and the shop's storefront. */
export function useShopLists(shopId: string | undefined) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!shopId) {
      setLists([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('lists')
        .select(LIST_SELECT)
        .eq('owner_shop_id', shopId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLists((data ?? []).map(toSummary));
    } catch (error: any) {
      console.error('[useShopLists] load failed:', error);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  return { lists, loading, reload: load };
}

/** Save, unsave, copy and rate — the actions available on someone else's list. */
export function useListActions() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const toggleSave = useCallback(
    async (listId: string, currentlySaved: boolean) => {
      if (!user?.id) {
        toast.error('Sign in to save lists');
        return currentlySaved;
      }

      try {
        setBusy(true);
        if (currentlySaved) {
          const { error } = await supabase
            .from('list_saves')
            .delete()
            .eq('list_id', listId)
            .eq('user_id', user.id);
          if (error) throw error;
          return false;
        }

        const { error } = await supabase
          .from('list_saves')
          .insert([{ list_id: listId, user_id: user.id }]);
        if (error) throw error;
        toast.success('Saved to your lists');
        return true;
      } catch (error: any) {
        console.error('[useListActions] save failed:', error);
        toast.error(parseAuthError(error));
        return currentlySaved;
      } finally {
        setBusy(false);
      }
    },
    [user?.id],
  );

  const rate = useCallback(
    async (listId: string, rating: number) => {
      if (!user?.id) {
        toast.error('Sign in to rate lists');
        return false;
      }

      try {
        setBusy(true);
        const { error } = await supabase
          .from('list_ratings')
          .upsert(
            { list_id: listId, user_id: user.id, rating, updated_at: new Date().toISOString() },
            { onConflict: 'list_id,user_id' },
          );
        if (error) throw error;
        toast.success('Thanks for rating');
        return true;
      } catch (error: any) {
        console.error('[useListActions] rate failed:', error);
        toast.error(parseAuthError(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [user?.id],
  );

  /**
   * Adds an item to a list.
   *
   * The snapshot is captured now so the entry can still be rendered — greyed,
   * with a reason — if the merchant later deletes the item. Live data always
   * takes precedence while the item exists; this is only the fallback.
   */
  const addItem = useCallback(
    async (
      listId: string,
      item: { id: string; name: string; image_url?: string | null },
    ) => {
      try {
        setBusy(true);

        const { data: last } = await supabase
          .from('list_items')
          .select('sort_order')
          .eq('list_id', listId)
          .order('sort_order', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { error } = await supabase.from('list_items').insert([
          {
            list_id: listId,
            item_id: item.id,
            snapshot_name: item.name,
            snapshot_image_url: item.image_url ?? null,
            sort_order: ((last as any)?.sort_order ?? -1) + 1,
          },
        ]);

        if (error) {
          // list_items_unique_item_idx — already on the list, which is not a
          // failure worth alarming anyone about.
          if (error.code === '23505') {
            toast.info('Already on that list');
            return true;
          }
          throw error;
        }

        toast.success('Added to your list');
        return true;
      } catch (error: any) {
        console.error('[useListActions] addItem failed:', error);
        toast.error(parseAuthError(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const removeItem = useCallback(async (entryId: string) => {
    try {
      setBusy(true);
      const { error } = await supabase.from('list_items').delete().eq('id', entryId);
      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('[useListActions] removeItem failed:', error);
      toast.error(parseAuthError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const copy = useCallback(async (listId: string) => {
    try {
      setBusy(true);
      const { data, error } = await supabase.rpc('copy_list', { p_list_id: listId });
      if (error) throw error;
      toast.success('Copied — it is yours to edit now');
      return data as { list_id: string };
    } catch (error: any) {
      console.error('[useListActions] copy failed:', error);
      toast.error(parseAuthError(error));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, toggleSave, rate, copy, addItem, removeItem };
}
