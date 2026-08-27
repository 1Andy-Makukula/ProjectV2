import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { useAuth } from '../../utils/auth/AuthContext';

export interface Category {
  id: string;
  name: string;
  is_featured: boolean;
}

/** Turns "Home & Garden" into "home-garden". Categories.slug is UNIQUE NOT NULL. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function useCategoryFlags() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Categories are admin-managed at the database level ("Admins manage
  // categories"). Surfaced here so callers can hide an add button rather than
  // show one that fails on RLS -- a disabled affordance explains itself; a
  // failing one just looks broken.
  const { profile } = useAuth();
  const canManage = profile?.role === 'admin';
  const [deleting, setDeleting] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, is_featured')
        .order('name');

      if (error) {
        if (error.message.toLowerCase().includes('does not exist') || error.code === '42P01') {
          setSchemaError(true);
        } else {
          toast.error('Failed to load categories');
        }
      } else {
        setCats((data as Category[]) ?? []);
      }
    } catch (err: any) {
      console.error('Failed to load categories:', err);
      toast.error('Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (cat: Category) => {
    setToggling(cat.id);
    try {
      const { error } = await supabase
        .from('categories')
        .update({ is_featured: !cat.is_featured })
        .eq('id', cat.id);

      if (error) {
        toast.error(error.message);
      } else {
        setCats(prev => prev.map(c => c.id === cat.id ? { ...c, is_featured: !c.is_featured } : c));
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Update failed');
    } finally {
      setToggling(null);
    }
  };

  /**
   * Returns the created category rather than a boolean.
   *
   * The picker needs the new row's id so it can select what the admin just
   * typed -- creating a category and then making them find it in the list is
   * the kind of small friction that stops people categorising at all. Existing
   * callers test truthiness, so this stays compatible.
   */
  const create = async (name: string): Promise<Category | null> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Category name is required');
      return null;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({ name: trimmed, slug: slugify(trimmed) })
        .select('id, name, is_featured')
        .single();

      if (error) {
        toast.error(error.code === '23505' ? 'A category with that name already exists' : error.message);
        return null;
      }
      setCats(prev => [...prev, data as Category].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(`"${trimmed}" added`);
      return data as Category;
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to create category');
      return null;
    } finally {
      setCreating(false);
    }
  };

  const remove = async (cat: Category) => {
    setDeleting(cat.id);
    try {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', cat.id);

      if (error) {
        toast.error(error.message);
        return;
      }
      setCats(prev => prev.filter(c => c.id !== cat.id));
      toast.success(`"${cat.name}" removed`);
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to remove category');
    } finally {
      setDeleting(null);
    }
  };

  return {
    cats,
    canManage,
    loading,
    toggling,
    creating,
    deleting,
    schemaError,
    toggle,
    create,
    remove,
  };
}
