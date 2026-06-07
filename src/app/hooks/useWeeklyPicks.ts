import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';

export interface Item {
  id: string;
  name: string;
  image_url: string | null;
  is_weekly_pick: boolean;
  shop: { name: string } | null;
}

export function useWeeklyPicks() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('items')
          .select('id, name, image_url, is_weekly_pick, shop:shops(name)')
          .eq('is_available', true)
          .order('name');

        if (error) {
          if (error.message.includes('is_weekly_pick')) {
            setSchemaError(true);
          } else {
            toast.error('Failed to load items');
          }
        } else {
          setItems((data as unknown as Item[]) ?? []);
        }
      } catch (err: any) {
        console.error('Error loading weekly picks:', err);
        toast.error('Failed to load items');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const toggle = async (item: Item) => {
    setToggling(item.id);
    try {
      const { error } = await supabase
        .from('items')
        .update({ is_weekly_pick: !item.is_weekly_pick })
        .eq('id', item.id);

      if (error) {
        if (error.message.includes('is_weekly_pick')) {
          setSchemaError(true);
        } else {
          toast.error(error.message);
        }
      } else {
        setItems(prev => prev.map(x => x.id === item.id ? { ...x, is_weekly_pick: !x.is_weekly_pick } : x));
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Update failed');
    } finally {
      setToggling(null);
    }
  };

  const filtered = useMemo(() => {
    return items.filter(i => i.name.toLowerCase().includes(query.toLowerCase()));
  }, [items, query]);

  const picksCount = useMemo(() => {
    return items.filter(i => i.is_weekly_pick).length;
  }, [items]);

  return {
    items,
    loading,
    query,
    setQuery,
    toggling,
    schemaError,
    toggle,
    filtered,
    picksCount,
  };
}
