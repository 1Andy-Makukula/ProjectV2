import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { callServer } from '../../utils/server';
import { OrderDetail } from '../types/orders';
import { deriveStatus } from '../../utils/orderStatus';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';

export function useAdminOrderDetail(orderId?: string) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          status,
          total_amount,
          gateway_tx_ref,
          origin_type,
          created_at,
          updated_at,
          buyer_id,
          buyer:buyer_id (name, email, phone),
          shop_orders (
            shop_order_id,
            claim_code,
            claim_status,
            recipient_name,
            recipient_phone,
            message,
            updated_at,
            shop:shop_id (id, name, location, address),
            order_items (
              item:item_id (id, name, description, image_url, price_zmw)
            )
          )
        `)
        .eq('transaction_id', orderId)
        .single();

      if (error) throw error;

      const txn = data as any;
      const firstShopOrder = txn.shop_orders?.[0];
      const firstItem = firstShopOrder?.order_items?.[0]?.item;
      const shop = firstShopOrder?.shop;
      const buyer = txn.buyer;

      const detail: OrderDetail = {
        transaction_id: txn.transaction_id,
        tx_status: txn.status,
        total_amount: txn.total_amount,
        gateway_tx_ref: txn.gateway_tx_ref,
        origin_type: txn.origin_type,
        created_at: txn.created_at,
        updated_at: txn.updated_at,

        shop_order_id: firstShopOrder?.shop_order_id ?? null,
        claim_code: firstShopOrder?.claim_code ?? null,
        claim_status: firstShopOrder?.claim_status ?? null,
        recipient_name: firstShopOrder?.recipient_name ?? null,
        recipient_phone: firstShopOrder?.recipient_phone ?? null,
        message: firstShopOrder?.message ?? null,
        shop_order_updated_at: firstShopOrder?.updated_at ?? null,

        item_id: firstItem?.id ?? null,
        item_name: firstItem?.name ?? null,
        item_description: firstItem?.description ?? null,
        item_image_url: firstItem?.image_url ?? null,
        item_price: firstItem?.price_zmw ?? null,

        shop_id: shop?.id ?? null,
        shop_name: shop?.name ?? null,
        shop_location: shop?.location ?? null,
        shop_address: shop?.address ?? null,

        buyer_id: txn.buyer_id,
        buyer_name: buyer?.name ?? null,
        buyer_email: buyer?.email ?? null,
        buyer_phone: buyer?.phone ?? null,

        derived_status: deriveStatus(txn.status, firstShopOrder?.claim_status ?? null),
      };

      setOrder(detail);
    } catch (error: any) {
      console.error('Error loading order:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  const updateOrderStatus = useCallback(async (newStatus: 'paid' | 'fulfilled' | 'expired') => {
    if (!order) return false;

    setUpdating(true);
    try {
      if (newStatus === 'paid') {
        await callServer(`/orders/${order.transaction_id}/confirm-payment`);
      } else if (newStatus === 'fulfilled') {
        if (!order.shop_order_id) throw new Error('No shop order found');

        const { error } = await supabase
          .from('shop_orders')
          .update({ claim_status: 'REDEEMED' })
          .eq('transaction_id', order.transaction_id);

        if (error) throw error;
      } else if (newStatus === 'expired') {
        const { error: txErr } = await supabase
          .from('transactions')
          .update({ status: 'CANCELLED' })
          .eq('transaction_id', order.transaction_id);

        if (txErr) throw txErr;

        const { error: soErr } = await supabase
          .from('shop_orders')
          .update({ claim_status: 'CANCELLED' })
          .eq('transaction_id', order.transaction_id);
        if (soErr) throw soErr;
      }

      toast.success(`Order marked as ${newStatus}`);
      await loadOrder();
      return true;
    } catch (error: any) {
      console.error('Error updating order status:', error);
      toast.error(parseAuthError(error));
      return false;
    } finally {
      setUpdating(false);
    }
  }, [order, loadOrder]);

  useEffect(() => {
    if (orderId) {
      loadOrder();
    }
  }, [orderId, loadOrder]);

  return {
    order,
    loading,
    updating,
    updateOrderStatus,
    reload: loadOrder,
  };
}
