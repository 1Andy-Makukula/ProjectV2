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

      toast.success(`Shop ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      await loadShops();
    } catch (error: any) {
      console.error('Error toggling shop status:', error);
      const parsed = parseAuthError(error);
      toast.error(typeof parsed === 'string' ? parsed : parsed?.message || 'Error toggling shop status');
    }
  }, [loadShops]);

  const approveShop = useCallback(async (shopId: string) => {
    try {
      const { error } = await supabase
        .from('shops')
        .update({ verification_status: 'approved', is_active: true })
        .eq('id', shopId);

      if (error) throw error;

      // Get shop details to find owner_id
      const { data: shop } = await supabase
        .from('shops')
        .select('owner_id, name')
        .eq('id', shopId)
        .single();

      if (shop) {
        // Send approval notification
        await supabase.from('notifications').insert({
          user_id: shop.owner_id,
          message: `🎉 Your shop "${shop.name}" KYC verification has been approved! It is now active on the platform.`,
          type: 'success',
          is_read: false,
          reference_id: shopId
        });
      }

      toast.success('Shop approved successfully');
      await loadShops();
    } catch (error: any) {
      console.error('Error approving shop:', error);
      const parsed = parseAuthError(error);
      toast.error(typeof parsed === 'string' ? parsed : parsed?.message || 'Failed to approve shop');
    }
  }, [loadShops]);

  const rejectShop = useCallback(async (shopId: string, reason: string) => {
    try {
      const { error } = await supabase
        .from('shops')
        .update({ verification_status: 'rejected', rejection_reason: reason, is_active: false })
        .eq('id', shopId);

      if (error) throw error;

      // Get shop details to find owner_id
      const { data: shop } = await supabase
        .from('shops')
        .select('owner_id, name')
        .eq('id', shopId)
        .single();

      if (shop) {
        // Send rejection notification
        await supabase.from('notifications').insert({
          user_id: shop.owner_id,
          message: `⚠️ Your shop "${shop.name}" KYC verification was rejected. Reason: ${reason}`,
          type: 'rejection',
          is_read: false,
          reference_id: shopId
        });
      }

      toast.success('Shop rejected successfully');
      await loadShops();
    } catch (error: any) {
      console.error('Error rejecting shop:', error);
      const parsed = parseAuthError(error);
      toast.error(typeof parsed === 'string' ? parsed : parsed?.message || 'Failed to reject shop');
    }
  }, [loadShops]);

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
