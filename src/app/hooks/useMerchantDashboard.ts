import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';

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

export function useMerchantDashboard(profileId?: string) {
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

  const fetchAnalytics = useCallback(async (currentShopId: string) => {
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

      const { data: ledgerData } = await supabase
        .from('payout_ledger')
        .select('credit_amount')
        .eq('shop_id', currentShopId)
        .neq('status', 'SETTLED');

      const availableBalance = ledgerData?.reduce((sum: number, row: any) => sum + (row.credit_amount || 0), 0) || 0;

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
    if (!profileId) return;

    try {
      setLoading(true);
      const { data: merchantShop, error: shopError } = await supabase
        .from('merchant_shops')
        .select('shop_id, shop:shops(id, name, location, image_url, payout_details, payout_method)')
        .eq('user_id', profileId)
        .single();

      if (shopError) throw shopError;

      const shop = merchantShop.shop as any;
      const currentShopId = merchantShop.shop_id;

      setShopId(currentShopId);
      setShopName(shop?.name ?? 'Your Shop');

      await Promise.all([
        fetchOrders(currentShopId),
        fetchAnalytics(currentShopId),
        fetchLedger(currentShopId),
      ]);
    } catch (error) {
      console.error('Error fetching merchant data:', error);
    } finally {
      setLoading(false);
    }
  }, [profileId, fetchOrders, fetchAnalytics, fetchLedger]);

  const handleWithdrawRequest = useCallback(async () => {
    if (!shopId || withdrawing || analytics.availableBalance <= 0) return false;
    setWithdrawing(true);
    try {
      const { error } = await supabase.functions.invoke('server', {
        body: {
          action: 'request_withdrawal',
          shopId,
          amount: analytics.availableBalance,
        },
      });
      if (error) throw error;
      setAnalytics((prev) => ({ ...prev, availableBalance: 0 }));
      toast.success('Withdrawal request submitted! KithLy will process it within 1-2 business days.');
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
    if (profileId) {
      fetchMerchantData();
    }
  }, [profileId, fetchMerchantData]);

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
          fetchAnalytics(shopId);
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
          fetchAnalytics(shopId);
          fetchLedger(shopId);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [shopId, fetchOrders, fetchAnalytics, fetchLedger]);

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
