import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';

export interface Category {
  id: string;
  name: string;
  is_featured: boolean;
}

export function useCategoryFlags() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState(false);

  useEffect(() => {
    async function load() {
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
    }
    load();
  }, []);

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

  return {
    cats,
    loading,
    toggling,
    schemaError,
    toggle,
  };
}
