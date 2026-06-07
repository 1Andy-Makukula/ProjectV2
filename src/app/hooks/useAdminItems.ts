import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Shop, Item } from '../types/shops';
import { toast } from 'sonner';

export function useAdminItems(activeShopId?: string) {
  const [shop, setShop] = useState<Pick<Shop, 'id' | 'name'> | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const loadShopAndItems = useCallback(async () => {
    if (!activeShopId) return;
    try {
      setLoading(true);

      // Load shop details
      const { data: shopData, error: shopError } = await supabase
        .from('shops')
        .select('id, name')
        .eq('id', activeShopId)
        .single();

      if (shopError) throw shopError;
      setShop(shopData);

      // Load items
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select('*')
        .eq('shop_id', activeShopId)
        .order('created_at', { ascending: false });

      if (itemsError) throw itemsError;
      setItems(itemsData || []);
    } catch (error: any) {
      console.error('Error loading shop and items:', error);
      toast.error('Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [activeShopId]);

  const toggleItemAvailability = useCallback(async (itemId: string, currentStatus: boolean, merchantShopId?: string) => {
    try {
      let query = supabase
        .from('items')
        .update({ is_available: !currentStatus })
        .eq('id', itemId);
        
      if (merchantShopId) {
        query = query.eq('shop_id', merchantShopId);
      }

      const { error } = await query;

      if (error) throw error;

      toast.success(`Item ${!currentStatus ? 'enabled' : 'disabled'} successfully`);
      await loadShopAndItems();
    } catch (error: any) {
      console.error('Error toggling item availability:', error);
      toast.error('Failed to update item availability');
    }
  }, [loadShopAndItems]);

  useEffect(() => {
    if (activeShopId) {
      loadShopAndItems();
    }
  }, [activeShopId, loadShopAndItems]);

  return {
    shop,
    items,
    loading,
    toggleItemAvailability,
    reload: loadShopAndItems,
  };
}
