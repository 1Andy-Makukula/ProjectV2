// The category taxonomy, as the customer-facing surfaces read it.
//
// `categories` is admin-managed (Admin Merchandising owns it) and carries
// three columns that exist purely for presentation and were, until now, never
// read by anything: `is_featured`, `image_url` and `ui_order_index`. The admin
// screen has always described that flag as choosing "which ones display in the
// storefront matrix" — this is the matrix finally reading it.
//
// Separate from useCategoryFlags, which is the admin's editing hook: it loads
// every category regardless of flag, offers create/toggle/remove, and reports
// failures with a toast. Neither of those is right on a customer surface, so
// this stays a read.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export interface StorefrontCategory {
  id: string;
  name: string;
  slug: string;
  /** The tile's photograph. Null is normal — the tile falls back to a block. */
  image_url: string | null;
}

const CATEGORY_SELECT = 'id, name, slug, image_url';

function mapRow(row: {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
}): StorefrontCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    image_url: row.image_url ?? null,
  };
}

/**
 * Nothing here is worth interrupting anybody over.
 *
 * A category read failing — a missing table in a fresh environment, an RLS
 * policy, a dropped connection — costs the page some tiles and nothing else.
 * The callers hide their section on an empty list, so a failure degrades to
 * the page as it was before these tiles existed. Logged, never toasted.
 */
function swallow(scope: string, error: unknown): void {
  console.error(`[useCategories] ${scope}:`, error);
}

/**
 * The featured categories, in the order the admin arranged them.
 *
 * `ui_order_index` is nullable and a null sorts last, so a category that has
 * never been positioned falls to the end of the mosaic rather than to the
 * front of it. Name breaks the ties.
 */
export function useFeaturedCategories() {
  const [categories, setCategories] = useState<StorefrontCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data, error } = await supabase
          .from('categories')
          .select(CATEGORY_SELECT)
          .eq('is_featured', true)
          .order('ui_order_index', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true });

        if (error) throw error;
        if (!cancelled) setCategories((data ?? []).map(mapRow));
      } catch (err) {
        swallow('featured', err);
        if (!cancelled) setCategories([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { categories, loading };
}

/**
 * One category, resolved from the slug in the URL.
 *
 * Deliberately not restricted to featured rows: `is_featured` decides what the
 * mosaic offers, not what a link is allowed to mean. Unfeaturing a category
 * should stop advertising it, not break the links already in circulation.
 *
 * Returns `loading: false` immediately when there is no slug, so a caller can
 * gate a feed on it without stalling the ordinary unfiltered page.
 */
export function useCategoryBySlug(slug: string | null) {
  const [category, setCategory] = useState<StorefrontCategory | null>(null);
  const [loading, setLoading] = useState(slug !== null);

  useEffect(() => {
    if (!slug) {
      setCategory(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const { data, error } = await supabase
          .from('categories')
          .select(CATEGORY_SELECT)
          .eq('slug', slug)
          .maybeSingle();

        if (error) throw error;
        if (!cancelled) setCategory(data ? mapRow(data) : null);
      } catch (err) {
        swallow(`slug "${slug}"`, err);
        if (!cancelled) setCategory(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { category, loading };
}
