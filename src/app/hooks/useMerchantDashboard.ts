import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
export interface OrderItem {
  item: {
    name: string;
    image_url: string | null;
  } | null;
}

export interface Order {
  id: string;
  code: string;
  recipient_name: string;
  recipient_phone?: string | null;
  message?: string | null;
  amount: number;
  paid_at: string | null;
  fulfilled_at: string | null;
  claim_status: string;
  order_items?: OrderItem[];
  item: {
    name: string;
    image_url: string | null;
  } | null;
}

export interface Analytics {
  totalFulfilled: number;
  totalValue: number;
  weekFulfilled: number;
  weekValue: number;
  availableBalance: number;
}

export interface UseMerchantDashboardOptions {
  /**
   * Render a specific shop instead of resolving one from the signed-in user's
   * `merchant_shops` rows. Used by the admin read-only preview, where the
   * viewer has no merchant assignment of their own.
   */
  shopId?: string;
}

export function useMerchantDashboard(
  profileId?: string,
  options?: UseMerchantDashboardOptions,
) {
  const previewShopId = options?.shopId;
  const [shopName, setShopName] = useState('');
  const [shopId, setShopId] = useState<string | null>(null);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [fulfilledOrders, setFulfilledOrders] = useState<Order[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    totalFulfilled: 0,
    totalValue: 0,
    weekFulfilled: 0,
    weekValue: 0,
    availableBalance: 0,
  });
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [ledgerData, setLedgerData] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  /**
   * Whose wallet backs the "available balance" figure. This is the shop's
   * owner, which is only the same as the viewer outside preview mode — keying
   * it off the viewer would show an admin their own balance as the merchant's.
   */
  const [walletOwnerId, setWalletOwnerId] = useState<string | null>(null);

  const fetchOrders = useCallback(async (currentShopId: string) => {
    try {
      const { data, error } = await supabase
        .from('shop_orders')
        .select('*, order_items(item:items(name, image_url))')
        .eq('shop_id', currentShopId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const normalizedOrders = ((data || []) as any[]).map((order) => ({
        ...order,
        id: order.shop_order_id || order.id || 'NO-ID',
        amount: order.subtotal || order.amount || 0,
        code: order.claim_code || order.code || 'NO-CODE',
        paid_at: order.created_at || order.paid_at || null,
        order_items: order.order_items ?? [],
        item: order.order_items?.[0]?.item ?? null,
      }));

      const active = normalizedOrders.filter(
        (o) => o.claim_status === 'PENDING' || o.claim_status === 'PARTIAL_FULFILLMENT'
      );
      const fulfilled = normalizedOrders.filter((o) => o.claim_status === 'FULFILLED');

      setActiveOrders(active as unknown as Order[]);
      setFulfilledOrders(fulfilled as unknown as Order[]);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  }, []);

  const fetchAnalytics = useCallback(async (
    currentShopId: string,
    currentWalletOwnerId?: string | null,
  ) => {
    try {
      const { data: ordersData } = await supabase
        .from('shop_orders')
        .select('subtotal, fulfilled_at')
        .eq('shop_id', currentShopId)
        .eq('claim_status', 'FULFILLED');

      const totalValue = ordersData?.reduce((sum: number, o: any) => sum + (o.subtotal || 0), 0) || 0;

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const weekOrders = ordersData?.filter(
        (o: any) => o.fulfilled_at && new Date(o.fulfilled_at) >= oneWeekAgo
      );
      const weekFulfilled = weekOrders?.length || 0;
      const weekValue = weekOrders?.reduce((sum: number, o: any) => sum + (o.subtotal || 0), 0) || 0;

      let availableBalance = 0;
      if (currentWalletOwnerId) {
        const { data: walletData, error: walletError } = await supabase
          .from('kithly_wallets')
          .select('balance')
          .eq('user_id', currentWalletOwnerId)
          .maybeSingle();

        if (!walletError && walletData) {
          availableBalance = walletData.balance;
        }
      }

      setAnalytics((prev) => ({
        ...prev,
        totalFulfilled: ordersData?.length || 0,
        totalValue,
        weekFulfilled,
        weekValue,
        availableBalance,
      }));
    } catch (error) {
      console.error('Error syncing dashboard:', error);
    }
  }, []);

  const fetchLedger = useCallback(async (currentShopId: string) => {
    setLedgerLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-merchant-ledger', {
        body: { shop_id: currentShopId },
      });
      if (error) throw error;
      if (data?.success) {
        setLedgerData(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching merchant ledger:', error);
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  const fetchMerchantData = useCallback(async () => {
    if (!previewShopId && !profileId) return;

    try {
      setLoading(true);

      let currentShopId: string;
      let shop: any;
      let currentWalletOwnerId: string | null;

      if (previewShopId) {
        // Preview: the viewer has no merchant_shops row, so read the shop
        // directly and bill the balance to its owner rather than the viewer.
        const { data: shopRow, error: shopError } = await supabase
          .from('shops')
          .select('id, name, location, image_url, payout_details, payout_method, owner_id')
          .eq('id', previewShopId)
          .maybeSingle();

        if (shopError) throw shopError;

        if (!shopRow) {
          setShopId(null);
          setShopName('Shop not found');
          setWalletOwnerId(null);
          return;
        }

        shop = shopRow;
        currentShopId = shopRow.id;
        currentWalletOwnerId = (shopRow as any).owner_id ?? null;
      } else {
        const { data: merchantShop, error: shopError } = await supabase
          .from('merchant_shops')
          .select('shop_id, shop:shops(id, name, location, image_url, payout_details, payout_method)')
          .eq('user_id', profileId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (shopError) throw shopError;

        if (!merchantShop) {
          setShopId(null);
          setShopName('Your Shop');
          setWalletOwnerId(null);
          return;
        }

        shop = merchantShop.shop as any;
        currentShopId = merchantShop.shop_id;
        currentWalletOwnerId = profileId ?? null;
      }

      setShopId(currentShopId);
      setShopName(shop?.name ?? 'Your Shop');
      setWalletOwnerId(currentWalletOwnerId);

      await Promise.all([
        fetchOrders(currentShopId),
        fetchAnalytics(currentShopId, currentWalletOwnerId),
        fetchLedger(currentShopId),
      ]);
    } catch (error) {
      console.error('Error fetching merchant data:', error);
    } finally {
      setLoading(false);
    }
  }, [profileId, previewShopId, fetchOrders, fetchAnalytics, fetchLedger]);

  const handleWithdrawRequest = useCallback(async () => {
    if (!shopId || withdrawing || analytics.availableBalance <= 0) return false;
    setWithdrawing(true);
    try {
      const { error } = await supabase.functions.invoke('request-withdrawal', {
        body: {
          shopId,
          amount: analytics.availableBalance,
        },
      });
      if (error) throw error;
      setAnalytics((prev) => ({ ...prev, availableBalance: 0 }));
      toast.success('Withdrawal requested. It will be sent to your payout account shortly.');
      return true;
    } catch (err: any) {
      console.error('[Withdraw] Failed:', err);
      toast.error(err.message || 'Withdrawal request failed. Please try again.');
      return false;
    } finally {
      setWithdrawing(false);
    }
  }, [shopId, withdrawing, analytics.availableBalance]);

  useEffect(() => {
    if (profileId || previewShopId) {
      fetchMerchantData();
    }
  }, [profileId, previewShopId, fetchMerchantData]);

  // Realtime subscription
  useEffect(() => {
    if (!shopId) return;

    const subscription = supabase
      .channel(`shop:${shopId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'shop_orders',
          filter: `shop_id=eq.${shopId}`,
        },
        () => {
          fetchOrders(shopId);
          fetchAnalytics(shopId, walletOwnerId);
          fetchLedger(shopId);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shop_orders',
          filter: `shop_id=eq.${shopId}`,
        },
        () => {
          fetchOrders(shopId);
          fetchAnalytics(shopId, walletOwnerId);
          fetchLedger(shopId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [shopId, walletOwnerId, fetchOrders, fetchAnalytics, fetchLedger]);

  return {
    shopName,
    shopId,
    activeOrders,
    fulfilledOrders,
    analytics,
    loading,
    withdrawing,
    ledgerData,
    ledgerLoading,
    handleWithdrawRequest,
    reload: fetchMerchantData,
  };
}
