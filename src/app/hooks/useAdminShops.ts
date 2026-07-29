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
        .select('*, owner:owner_id(name, email, phone)')
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

      await supabase.rpc('log_admin_action', {
        p_action: !currentStatus ? 'shop.activated' : 'shop.deactivated',
        p_target_type: 'shop',
        p_target_id: shopId,
      });

      toast.success(`Shop ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      await loadShops();
    } catch (error: any) {
      console.error('Error toggling shop status:', error);
      toast.error(parseAuthError(error));
    }
  }, [loadShops]);

  /**
   * Approval and rejection both go through `review_merchant_verification`,
   * which applies the status change, the rejection reason, the reviewer stamp
   * and the merchant's notification in one transaction. Doing it client-side
   * left shops approved with nobody notified whenever the second call failed.
   */
  const reviewShop = useCallback(
    async (shopId: string, decision: 'approved' | 'rejected', reason?: string) => {
      try {
        const { error } = await supabase.rpc('review_merchant_verification', {
          p_shop_id: shopId,
          p_decision: decision,
          p_rejection_reason: reason ?? null,
        });

        if (error) throw error;

        toast.success(decision === 'approved' ? 'Shop approved' : 'Shop rejected');
        await loadShops();
        return true;
      } catch (error: any) {
        console.error(`Error recording ${decision} decision:`, error);
        toast.error(parseAuthError(error));
        return false;
      }
    },
    [loadShops],
  );

  const approveShop = useCallback(
    (shopId: string) => reviewShop(shopId, 'approved'),
    [reviewShop],
  );

  const rejectShop = useCallback(
    (shopId: string, reason: string) => reviewShop(shopId, 'rejected', reason),
    [reviewShop],
  );

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  return {
    shops,
    loading,
    toggleShopActive,
    approveShop,
    rejectShop,
    reload: loadShops,
  };
}
