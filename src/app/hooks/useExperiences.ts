import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import type { Experience } from '../types/experiences';

const EXPERIENCE_SELECT = `
  id, name, slug, tagline, description, image_url, is_active, is_featured,
  expires_at, sort_order, created_at,
  experience_items (
    id, experience_id, item_id, quantity, note, sort_order,
    item:item_id (
      id, name, description, price_zmw, image_url, is_available, is_quote_only,
      shop:shop_id (id, name)
    )
  )
`;

/** Active experiences for the storefront. */
export function useExperiences(options: { featuredOnly?: boolean; limit?: number } = {}) {
  const { featuredOnly = false, limit = 12 } = options;
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        let query = supabase
          .from('experiences')
          .select(EXPERIENCE_SELECT)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(limit);

        if (featuredOnly) query = query.eq('is_featured', true);

        const { data, error } = await query;
        if (error) throw error;
        if (!cancelled) setExperiences((data ?? []) as unknown as Experience[]);
      } catch (err) {
        // A storefront section failing to load should not take the page down.
        console.error('[useExperiences] Failed to load:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [featuredOnly, limit]);

  return { experiences, loading };
}

/** A single experience by slug, for the detail page. */
export function useExperience(slug?: string) {
  const [experience, setExperience] = useState<Experience | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('experiences')
          .select(EXPERIENCE_SELECT)
          .eq('slug', slug)
          .single();

        if (error) throw error;
        if (!cancelled) setExperience(data as unknown as Experience);
      } catch (err: any) {
        // A stale link is an expected outcome; the page renders its own state.
        if (err?.code !== 'PGRST116') {
          console.error('[useExperience] Failed to load:', err);
        }
        if (!cancelled) setExperience(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { experience, loading };
}

/** Every experience including drafts — admin only, gated by RLS. */
export function useAdminExperiences() {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('experiences')
        .select(EXPERIENCE_SELECT)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExperiences((data ?? []) as unknown as Experience[]);
    } catch (err: any) {
      console.error('[useAdminExperiences] Failed to load:', err);
      toast.error(parseAuthError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = useCallback(
    async (id: string, isActive: boolean) => {
      try {
        const { error } = await supabase
          .from('experiences')
          .update({ is_active: !isActive, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        toast.success(!isActive ? 'Experience published' : 'Experience unpublished');
        await load();
      } catch (err: any) {
        toast.error(parseAuthError(err));
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        const { error } = await supabase.from('experiences').delete().eq('id', id);
        if (error) throw error;
        toast.success('Experience deleted');
        await load();
      } catch (err: any) {
        toast.error(parseAuthError(err));
      }
    },
    [load],
  );

  return { experiences, loading, saving, setSaving, reload: load, toggleActive, remove };
}
