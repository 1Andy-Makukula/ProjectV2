// What a shopper wants to be told about when the price moves.
//
// One hook serves two shapes deliberately: `useWatchState` is what a button on
// a card needs -- am I watching this, and toggle it -- and `usePriceWatches` is
// what the dashboard needs, which is the whole list with names attached.
// Separating them keeps a product card from fetching every watch a person has
// in order to decide whether one bookmark is filled in.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import type { PriceWatch } from '../types/budgets';

const WATCH_SELECT = 'id, item_id, shop_id, target_zmw, last_alerted_on, created_at';

export interface WatchRow extends PriceWatch {
  /** Filled from the joined item or shop, so the dashboard reads as a list of things. */
  subject_name: string;
  subject_kind: 'item' | 'shop';
  current_price_zmw: number | null;
}

/** The dashboard's view: everything being watched, named. */
export function usePriceWatches() {
  const { user } = useAuth();
  const [watches, setWatches] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setWatches([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('price_watches')
        .select(`${WATCH_SELECT}, item:item_id (name, price_zmw), shop:shop_id (name)`)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data ?? []).map((row: any): WatchRow => ({
        id: row.id,
        item_id: row.item_id,
        shop_id: row.shop_id,
        target_zmw: row.target_zmw,
        last_alerted_on: row.last_alerted_on,
        created_at: row.created_at,
        subject_kind: row.item_id ? 'item' : 'shop',
        // A watched item that has since been removed leaves the row behind
        // until the cascade catches it; say so rather than rendering blank.
        subject_name: row.item?.name ?? row.shop?.name ?? 'No longer listed',
        current_price_zmw: row.item?.price_zmw ?? null,
      }));

      setWatches(rows);
    } catch (err) {
      console.error('[usePriceWatches] load failed:', err);
      toast.error('Could not load what you are watching');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const stopWatching = useCallback(
    async (watchId: string) => {
      const { error } = await supabase.from('price_watches').delete().eq('id', watchId);
      if (error) {
        toast.error('Could not stop that watch');
        return;
      }
      setWatches((prev) => prev.filter((w) => w.id !== watchId));
    },
    [],
  );

  const setTarget = useCallback(async (watchId: string, targetZmw: number | null) => {
    const { error } = await supabase
      .from('price_watches')
      .update({ target_zmw: targetZmw })
      .eq('id', watchId);
    if (error) {
      toast.error('Could not set that price');
      return;
    }
    setWatches((prev) =>
      prev.map((w) => (w.id === watchId ? { ...w, target_zmw: targetZmw } : w)),
    );
  }, []);

  return { watches, loading, stopWatching, setTarget, refresh: load };
}

/** A single card's view: one subject, watched or not. */
export function useWatchState(subject: { itemId?: string; shopId?: string }) {
  const { user } = useAuth();
  const [watchId, setWatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = subject.itemId ?? subject.shopId ?? '';

  useEffect(() => {
    let cancelled = false;
    if (!user || !key) {
      setWatchId(null);
      return;
    }

    (async () => {
      const column = subject.itemId ? 'item_id' : 'shop_id';
      const { data } = await supabase
        .from('price_watches')
        .select('id')
        .eq('user_id', user.id)
        .eq(column, key)
        .maybeSingle();
      if (!cancelled) setWatchId((data as { id: string } | null)?.id ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, key, subject.itemId]);

  const toggle = useCallback(async () => {
    if (!user || !key || busy) return;
    setBusy(true);
    try {
      if (watchId) {
        const { error } = await supabase.from('price_watches').delete().eq('id', watchId);
        if (error) throw error;
        setWatchId(null);
        toast.success('Stopped watching');
        return;
      }

      const { data, error } = await supabase
        .from('price_watches')
        .insert({
          user_id: user.id,
          item_id: subject.itemId ?? null,
          shop_id: subject.shopId ?? null,
        })
        .select('id')
        .single();

      if (error) throw error;
      setWatchId((data as { id: string }).id);
      toast.success(
        subject.itemId
          ? 'Watching. We will tell you if the price drops.'
          : 'Watching this shop for price drops.',
      );
    } catch (err) {
      console.error('[useWatchState] toggle failed:', err);
      toast.error('Could not change that watch');
    } finally {
      setBusy(false);
    }
  }, [user, key, watchId, busy, subject.itemId, subject.shopId]);

  return { isWatching: watchId !== null, toggle, busy };
}
