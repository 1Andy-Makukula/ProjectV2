import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { parseAuthError } from '../../utils/errorParser';
import { toast } from 'sonner';

export function useCustomerDashboard() {
  const { user, profile } = useAuth();

  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const [floatingItems, setFloatingItems] = useState<any[]>([]);
  const [loadingFloating, setLoadingFloating] = useState(false);

  const [receivedGifts, setReceivedGifts] = useState<any[]>([]);
  const [loadingReceived, setLoadingReceived] = useState(false);

  const [metricsLoading, setMetricsLoading] = useState(true);
  const [totalGenerosity, setTotalGenerosity] = useState(0);
  const [giftsDelivered, setGiftsDelivered] = useState(0);
  const [shopsSupported, setShopsSupported] = useState(0);

  const [resumingPaymentId, setResumingPaymentId] = useState<string | null>(null);
  const [convertingItemId, setConvertingItemId] = useState<string | null>(null);
  const [latestNotification, setLatestNotification] = useState<any | null>(null);

  const fetchFloatingItems = useCallback(async () => {
    if (!profile?.phone) return;
    setLoadingFloating(true);
    try {
      const { data, error } = await supabase
        .from('order_items')
        .select('order_item_id, created_at, child_claim_code, allocated_price, items(name, image_url), shop_orders!inner(recipient_phone)')
        .eq('fulfillment_status', 'FLOATING')
        .eq('shop_orders.recipient_phone', profile.phone);

      if (error) throw error;
      setFloatingItems((data as any) || []);
    } catch (err: any) {
      console.error('[useCustomerDashboard] fetchFloatingItems error:', err);
      toast.error(parseAuthError(err).message);
      setFloatingItems([]);
    } finally {
      setLoadingFloating(false);
    }
  }, [profile?.phone]);

  const fetchReceivedGifts = useCallback(async () => {
    if (!profile?.phone) return;
    setLoadingReceived(true);
    try {
      const { data, error } = await supabase
        .from('shop_orders')
        .select(`
          shop_order_id,
          claim_code,
          claim_status,
          created_at,
          message,
          recipient_name,
          recipient_phone,
          subtotal,
          shops (
            name,
            address,
            logo_url
          ),
          transactions (
            users (
              name
            )
          ),
          order_items (
            items (
              name,
              image_url
            )
          )
        `)
        .eq('recipient_phone', profile.phone)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReceivedGifts(data || []);
    } catch (err: any) {
      console.error('[useCustomerDashboard] fetchReceivedGifts error:', err);
      toast.error(parseAuthError(err).message);
      setReceivedGifts([]);
    } finally {
      setLoadingReceived(false);
    }
  }, [profile?.phone]);

  const fetchOrdersAndMetrics = useCallback(async () => {
    const activeUserId = profile?.id || user?.id;
    if (!activeUserId) return;
    setLoadingOrders(true);
    setMetricsLoading(true);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          buyer_id,
          total_amount,
          status,
          gateway_tx_ref,
          created_at,
          shop_orders (
            shop_order_id,
            claim_code,
            claim_status,
            recipient_name,
            shop_id,
            shop:shop_id (name),
            order_items (
              item:item_id (name, image_url)
            )
          )
        `)
        .eq('buyer_id', activeUserId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      let totalGen = 0;
      let deliveredCount = 0;
      const uniqueShops = new Set<string>();

      const flatOrders = (data ?? []).map((txn: any) => {
        totalGen += txn.total_amount ?? 0;
        
        if (txn.shop_orders) {
          txn.shop_orders.forEach((so: any) => {
            deliveredCount += 1;
            if (so.shop_id) uniqueShops.add(so.shop_id);
          });
        }

        const firstShopOrder = txn.shop_orders?.[0];
        const firstItem = firstShopOrder?.order_items?.[0]?.item;
        const shop = firstShopOrder?.shop;

        return {
          transaction_id: txn.transaction_id,
          buyer_id: txn.buyer_id,
          total_amount: txn.total_amount,
          status: txn.status,
          gateway_tx_ref: txn.gateway_tx_ref,
          created_at: txn.created_at,
          claim_code: firstShopOrder?.claim_code ?? null,
          claim_status: firstShopOrder?.claim_status ?? null,
          recipient_name: firstShopOrder?.recipient_name ?? null,
          shop_name: shop?.name ?? null,
          item_name: firstItem?.name ?? null,
          item_image_url: firstItem?.image_url ?? null,
        };
      });

      setOrders(flatOrders);
      setTotalGenerosity(totalGen);
      setGiftsDelivered(deliveredCount);
      setShopsSupported(uniqueShops.size);
    } catch (err: any) {
      console.error('[useCustomerDashboard] fetchOrdersAndMetrics error:', err);
      toast.error(parseAuthError(err).message);
      setTotalGenerosity(0);
      setGiftsDelivered(0);
      setShopsSupported(0);
    } finally {
      setLoadingOrders(false);
      setMetricsLoading(false);
    }
  }, [profile?.id, user?.id]);

  const loadAllData = useCallback(async () => {
    const promises = [fetchOrdersAndMetrics()];
    if (profile?.phone) {
      promises.push(fetchReceivedGifts(), fetchFloatingItems());
    }
    await Promise.all(promises);
  }, [fetchOrdersAndMetrics, fetchReceivedGifts, fetchFloatingItems, profile?.phone]);

  const handleResumePayment = async (order: any) => {
    setResumingPaymentId(order.transaction_id);

    try {
      const { data, error } = await supabase.functions.invoke('checkout-retry', {
        body: {
          transaction_id: order.transaction_id,
        },
      });

      if (error) throw error;
      if (data?.success === false || data?.error) {
        throw new Error(data.error || 'Failed to retry payment');
      }

      if (!data?.payment_link) {
        throw new Error('No payment link returned');
      }

      toast.success('Opening payment gateway...');
      window.open(data.payment_link, '_blank');
      
      await fetchOrdersAndMetrics();
    } catch (err: any) {
      console.error('[useCustomerDashboard] resume payment error:', err);
      toast.error(parseAuthError(err).message);
    } finally {
      setResumingPaymentId(null);
    }
  };

  const handleConvert = async (item: any) => {
    const activeUserId = user?.id || profile?.id;
    if (!activeUserId) {
      toast.error('You must be logged in to convert items to credits.');
      return;
    }
    setConvertingItemId(item.order_item_id);
    try {
      const { error } = await supabase.rpc('convert_floating_item_to_credits', {
        p_item_id: item.order_item_id,
        p_user_id: activeUserId,
      });

      if (error) throw error;

      toast.success('Credits added to your wallet!');
      await fetchFloatingItems();
      window.dispatchEvent(new Event('wallet-update'));
    } catch (err: any) {
      console.error('[useCustomerDashboard] handleConvert error:', err);
      toast.error(parseAuthError(err).message);
    } finally {
      setConvertingItemId(null);
    }
  };

  useEffect(() => {
    const activeUserId = profile?.id || user?.id;
    if (!activeUserId) return;
    
    loadAllData();

    const channel = supabase
      .channel('dashboard-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${activeUserId}`,
        },
        (payload) => {
          const newNotif = payload.new;
          setLatestNotification(newNotif);
          setTimeout(() => setLatestNotification(null), 5000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, user?.id, profile?.phone, loadAllData]);

  // Alias transactions to orders, and activeOrders to receivedGifts to match requested schema exactly
  return {
    transactions: orders,
    activeOrders: receivedGifts,
    orders,
    loadingOrders,
    floatingItems,
    loadingFloating,
    receivedGifts,
    loadingReceived,
    metricsLoading,
    totalGenerosity,
    giftsDelivered,
    shopsSupported,
    resumingPaymentId,
    convertingItemId,
    latestNotification,
    setLatestNotification,
    handleResumePayment,
    handleConvert,
    reload: loadAllData,
    loading: loadingOrders || loadingReceived || loadingFloating,
  };
}
