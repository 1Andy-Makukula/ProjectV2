import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { OccasionKind } from '../types/contacts';
import { OCCASION_GROUPS, occasionGroupForKind } from '../types/occasionGroups';

export interface OccasionTile {
  /** The `/occasion/:kind` segment. A group slug -- see occasionGroups.ts. */
  slug: string;
  label: string;
  /**
   * Every picture filed under this tile, in display order.
   *
   * The tile cycles them, so an occasion with four bundles shows four
   * photographs rather than one -- which is what stops a curated grid
   * reading as one item per category.
   */
  images: string[];
  bundleCount: number;
}

/**
 * The occasions worth putting a tile on the front door for.
 *
 * Derived from what is actually curated rather than from a list somebody
 * maintains by hand, which is the whole point: a tile can never lead to an
 * empty occasion page, because a group only appears here once at least one
 * active bundle is filed under one of its kinds. The cold-start failure this
 * pivot exists to fix is a storefront that looks full and isn't, and a
 * hand-kept tile list would reintroduce exactly that.
 *
 * Bundles are grouped by OccasionGroup, not by kind, so the six gift occasions
 * arrive as one Celebrations tile while groceries, school and health keep one
 * each. The query still selects a kind, because a kind is what the row stores;
 * the folding happens here, where it is presentation.
 *
 * Imagery is borrowed from the bundles too. Whatever the admin chose for the
 * bundle is already the truest picture of what the occasion buys here, and it
 * means no second set of assets to keep in step.
 *
 * The query is served by `experiences_occasion_idx`, the partial index on
 * (occasion_kind, sort_order) WHERE is_active.
 */
export function useOccasionTiles() {
  const [tiles, setTiles] = useState<OccasionTile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data, error } = await supabase
          .from('experiences')
          .select('occasion_kind, image_url, sort_order')
          .eq('is_active', true)
          .not('occasion_kind', 'is', null)
          .order('sort_order', { ascending: true });

        if (error) throw error;
        if (cancelled) return;

        // The query is already in display order, so pictures accumulate in the
        // order the admin put the bundles in.
        const bySlug = new Map<string, OccasionTile>();
        for (const row of data ?? []) {
          const kind = row.occasion_kind as OccasionKind | null;
          if (!kind) continue;

          // A kind the group registry does not know is a kind the database
          // grew and the frontend has not caught up with. Skip it rather than
          // inventing a tile with no label.
          const group = occasionGroupForKind(kind);
          if (!group) continue;

          const existing = bySlug.get(group.slug);
          if (existing) {
            existing.bundleCount += 1;
            if (row.image_url) existing.images.push(row.image_url);
            continue;
          }
          bySlug.set(group.slug, {
            slug: group.slug,
            label: group.label,
            images: row.image_url ? [row.image_url] : [],
            bundleCount: 1,
          });
        }

        // OCCASION_GROUPS is ordered by how often an occasion comes up, so the
        // mosaic's biggest plates land on the things people send most without
        // anyone having to rank them a second time.
        setTiles(
          OCCASION_GROUPS.map((g) => bySlug.get(g.slug)).filter(
            (t): t is OccasionTile => t !== undefined,
          ),
        );
      } catch (err) {
        // A storefront section failing to load should not take the page down.
        console.error('[useOccasionTiles] Failed to load:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { tiles, loading };
}
