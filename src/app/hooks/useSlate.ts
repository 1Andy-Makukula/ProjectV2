// The Slate — ranked items, each with the reason it is there.
//
// STRICTLY ADDITIVE, WHICH IS THE WHOLE POINT
// -------------------------------------------
// This never replaces a page's own data. It returns an ORDER and a set of
// reasons, and `applySlate` reorders what the caller already fetched. So when
// the ranker is off, absent, or slow, every surface renders exactly what it
// rendered before -- no spinner, no empty state, no regression.
//
// That property is what makes the recommender safe to ship before anybody has
// decided to trust it. `kithly_reco.weights.enabled` ships false; until it is
// turned on this hook returns an empty order and every call site is unchanged.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';

export interface SlateEntry {
  item_id: string;
  score: number;
  reason_code: string;
  reason_text: string;
}

export function useSlate(surface: string, limit = 12) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<SlateEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setEntries([]);
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('slate', {
        p_surface: surface,
        p_limit: limit,
      });
      if (error) throw error;
      setEntries((data as SlateEntry[]) ?? []);
    } catch (err) {
      // Silent, and empty. A ranking that failed to load is not something to
      // tell a shopper about -- they get the ordinary order instead.
      console.error('[useSlate] failed:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [user, surface, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return { entries, loading, refresh: load };
}

/**
 * Reorder what a page already has, and attach reasons.
 *
 * Items the slate ranked come first in its order; everything else keeps its
 * original order behind them. Nothing is ever removed -- a ranker that hides
 * stock is a ranker that loses sales, and the caller's list is the source of
 * truth about what exists.
 */
export function applySlate<T extends { id: string }>(
  items: T[],
  entries: SlateEntry[],
): Array<T & { reason?: string }> {
  if (entries.length === 0) return items;

  const order = new Map(entries.map((e, i) => [e.item_id, i]));
  const reasons = new Map(entries.map((e) => [e.item_id, e.reason_text]));

  const ranked: Array<T & { reason?: string }> = [];
  const rest: Array<T & { reason?: string }> = [];

  for (const item of items) {
    if (order.has(item.id)) ranked.push({ ...item, reason: reasons.get(item.id) });
    else rest.push(item);
  }

  ranked.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return [...ranked, ...rest];
}
