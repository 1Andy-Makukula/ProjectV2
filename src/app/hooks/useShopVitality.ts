// How complete a shop is, and the one thing to do next.
//
// The score is not a grade to be proud of; it is a lever. A shopkeeper who adds
// their fifth photograph gets a tile that moves on the storefront, and this
// hook is what tells them so. Every component comes back beside the total so
// the panel can say what is actually short rather than just how short.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export interface ShopVitality {
  shop_id: string;
  name: string;
  score: number;
  /** Each 0..1. */
  gallery_depth: number;
  cover_coverage: number;
  catalogue_size: number;
  organisation: number;
  hours_set: number;
  fulfilment: number;
  rating: number;
  /** Raw figures, for saying something concrete. */
  item_count: number;
  avg_images_per_item: number;
  collection_count: number;
  total_orders: number;
  rating_count: number;
  has_opening_hours: boolean;
}

export function useShopVitality(shopId: string | null | undefined) {
  const [vitality, setVitality] = useState<ShopVitality | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!shopId) {
      setVitality(null);
      setNudge(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [vitalityResult, nudgeResult] = await Promise.all([
        supabase.from('shop_vitality').select('*').eq('shop_id', shopId).maybeSingle(),
        supabase.rpc('shop_vitality_nudge', { p_shop_id: shopId }),
      ]);

      if (vitalityResult.error) throw vitalityResult.error;
      setVitality((vitalityResult.data as ShopVitality | null) ?? null);
      // A null nudge is a real answer -- there is nothing worth saying -- so it
      // is not treated as a failure to load one.
      setNudge((nudgeResult.data as string | null) ?? null);
    } catch (err) {
      // Deliberately quiet. Vitality is a nudge, not a function of the shop;
      // a merchant should never be blocked or alarmed because it failed.
      console.error('[useShopVitality] load failed:', err);
      setVitality(null);
      setNudge(null);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { vitality, nudge, loading, refresh: load };
}

/**
 * What the score currently buys, said plainly.
 *
 * The thresholds are the promise the storefront has to keep, so they live here
 * rather than in the panel's markup where they would drift from whatever
 * Stage 4a actually implements.
 */
export function vitalityReward(score: number): string {
  if (score >= 80) return 'Your tiles move, and your shop ranks first in its area.';
  if (score >= 60) return 'Your tiles move on the storefront.';
  if (score >= 40) return 'Your shop is shown with its photographs.';
  return 'Your shop is listed.';
}

/** The band a score sits in, for colour without hard-coding it in three places. */
export function vitalityBand(score: number): 'low' | 'fair' | 'good' | 'strong' {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'low';
}
