import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Shop } from '../types/shops';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';

export function useAdminShops() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  const loadShops = useCallback(async () => {
    try {
      setLoading(true);

      const { data: shopsData, error: shopsError } = await supabase
        .from('shops')
        .select('*')
        .order('created_at', { ascending: false });

      if (shopsError) throw shopsError;

      // Get item counts for each shop
      const shopsWithCounts = await Promise.all(
        (shopsData || []).map(async (shop) => {
          const { count } = await supabase
            .from('items')
            .select('*', { count: 'exact', head: true })
            .eq('shop_id', shop.id)
            .eq('is_available', true);

          return {
            ...shop,
            item_count: count || 0,
          };
        })
      );

      setShops(shopsWithCounts);
    } catch (error: any) {
      console.error('Error loading shops:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleShopActive = useCallback(async (shopId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('shops')
        .update({ is_active: !currentStatus })
        .eq('id', shopId);

      if (error) throw error;

      toast.success(`Shop ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      await loadShops();
    } catch (error: any) {
      console.error('Error toggling shop status:', error);
      toast.error(parseAuthError(error));
    }
  }, [loadShops]);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  return {
    shops,
    loading,
    toggleShopActive,
    reload: loadShops,
  };
}
