import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { callServer } from '../../utils/server';
import { Order } from '../types/orders';
import { deriveStatus } from '../../utils/orderStatus';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';

export function useAdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          status,
          total_amount,
          gateway_tx_ref,
          created_at,
          buyer:buyer_id (name),
          shop_orders (
            shop_order_id,
            claim_code,
            claim_status,
            recipient_name,
            updated_at,
            shop:shop_id (name),
            order_items (
              item:item_id (name, image_url)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedOrders: Order[] = (data ?? []).map((txn: any) => {
        const firstShopOrder = txn.shop_orders?.[0];
        const firstItem = firstShopOrder?.order_items?.[0]?.item;
        const shop = firstShopOrder?.shop;
        const claimStatus = firstShopOrder?.claim_status ?? null;
        const derivedStatus = deriveStatus(txn.status, claimStatus);

        return {
          transaction_id: txn.transaction_id,
          tx_status: txn.status,
          total_amount: txn.total_amount,
          gateway_tx_ref: txn.gateway_tx_ref,
          created_at: txn.created_at,

          shop_order_id: firstShopOrder?.shop_order_id ?? null,
          claim_code: firstShopOrder?.claim_code ?? null,
          claim_status: claimStatus,

          item_name: firstItem?.name ?? null,
          item_image_url: firstItem?.image_url ?? null,
          shop_name: shop?.name ?? null,
          sender_name: (txn.buyer as any)?.name ?? null,
          recipient_name: firstShopOrder?.recipient_name ?? null,
          amount: txn.total_amount,
          status: derivedStatus,
          fulfilled_at:
            derivedStatus === 'fulfilled'
              ? (firstShopOrder?.updated_at ?? null)
              : null,
        };
      });

      setOrders(formattedOrders);
    } catch (error: any) {
      console.error('Error loading orders:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const updateOrderStatus = useCallback(async (order: Order, newStatus: 'paid' | 'expired') => {
    try {
      setActionOrderId(order.transaction_id);

      if (newStatus === 'paid') {
        await callServer(`/orders/${order.transaction_id}/confirm-payment`);
      } else {
        const { error: txError } = await supabase
          .from('transactions')
          .update({ status: 'CANCELLED' })
          .eq('transaction_id', order.transaction_id);

        if (txError) throw txError;

        if (order.shop_order_id) {
          const { error: soError } = await supabase
            .from('shop_orders')
            .update({ claim_status: 'CANCELLED' })
            .eq('transaction_id', order.transaction_id);
          if (soError) throw soError;
        }
      }

      toast.success(`Order marked as ${newStatus}`);
      await loadOrders();
      return true;
    } catch (error: any) {
      console.error('Error updating order:', error);
      toast.error(parseAuthError(error));
      return false;
    } finally {
      setActionOrderId(null);
    }
  }, [loadOrders]);

  const exportToCSV = useCallback((filteredList: Order[]) => {
    const headers = ['Code', 'Item', 'Shop', 'Sender', 'Recipient', 'Amount', 'Status', 'Created', 'Fulfilled'];
    const rows = filteredList.map((order) => [
      order.claim_code ?? '',
      order.item_name ?? '',
      order.shop_name ?? '',
      order.sender_name ?? '',
      order.recipient_name ?? '',
      (order.total_amount).toFixed(2),
      order.status,
      new Date(order.created_at).toLocaleDateString(),
      order.fulfilled_at ? new Date(order.fulfilled_at).toLocaleDateString() : 'N/A',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kithly-orders-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Orders exported to CSV');
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  return {
    orders,
    loading,
    actionOrderId,
    updateOrderStatus,
    exportToCSV,
    reload: loadOrders,
  };
}
