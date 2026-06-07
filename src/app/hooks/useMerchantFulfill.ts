import { useState, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { toast } from 'sonner';

export type Stage = 'IDLE' | 'LOADING' | 'CHECKLIST' | 'SUBMITTING' | 'SUCCESS' | 'REJECTED';
export type InputMode = 'qr' | 'manual';

export interface OrderItem {
  order_item_id: string;
  item_id: string;
  allocated_price: number;
  item_name: string;
  item_image_url: string | null;
}

export interface ShopOrder {
  shop_order_id: string;
  shop_id: string;
  claim_code: string;
  subtotal: number;
}

export function useMerchantFulfill() {
  const { profile } = useAuth();

  const [stage, setStage] = useState<Stage>('IDLE');
  const [inputMode, setInputMode] = useState<InputMode>('qr');
  const [code, setCode] = useState('');
  const [shopOrder, setShopOrder] = useState<ShopOrder | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [rejectReason, setRejectReason] = useState('');

  const submittingRef = useRef(false);

  const { checkedIds, uncheckedIds, payoutTotal } = useMemo(() => {
    const cIds: string[] = [];
    const uIds: string[] = [];
    let total = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (checked[item.order_item_id]) {
        cIds.push(item.order_item_id);
        total += item.allocated_price;
      } else {
        uIds.push(item.order_item_id);
      }
    }

    return { checkedIds: cIds, uncheckedIds: uIds, payoutTotal: total };
  }, [items, checked]);

  const handleCodeComplete = useCallback(async (val: string) => {
    if (val.length !== 8) return;

    if (!navigator.onLine) {
      setRejectReason('No internet connection. Please check your network.');
      setStage('REJECTED');
      return;
    }

    setStage('LOADING');

    try {
      const { data: orderData, error: orderErr } = await supabase
        .from('shop_orders')
        .select(`
          shop_order_id, 
          shop_id, 
          claim_code, 
          subtotal,
          shop:shop_id!inner (
            merchant_shops!inner ( user_id )
          ),
          order_items (
            order_item_id,
            item_id,
            allocated_price,
            items ( name, image_url )
          )
        `)
        .eq('claim_code', val.toUpperCase())
        .eq('shop.merchant_shops.user_id', profile?.id)
        .single();

      if (orderErr || !orderData) {
        setRejectReason('This code is invalid or does not belong to your shop.');
        setStage('REJECTED');
        return;
      }

      const rawItems = orderData.order_items;
      if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error('Failed to load order items.');
      }

      const mapped: OrderItem[] = (rawItems as any[]).map(r => ({
        order_item_id:   r.order_item_id,
        item_id:         r.item_id,
        allocated_price: r.allocated_price,
        item_name:       r.items?.name       ?? 'Unknown Item',
        item_image_url:  r.items?.image_url  ?? null,
      }));

      const initial: Record<string, boolean> = {};
      mapped.forEach(i => { initial[i.order_item_id] = true; });

      const { shop, order_items, ...cleanOrder } = orderData;
      setShopOrder(cleanOrder as unknown as ShopOrder);
      setItems(mapped);
      setChecked(initial);
      setStage('CHECKLIST');
    } catch (err: any) {
      const isNetworkError = err.message?.toLowerCase().includes('fetch') || !navigator.onLine;
      setRejectReason(isNetworkError ? 'Network error. Please check your connection and try again.' : (err.message ?? 'Verification failed. Please try again.'));
      setStage('REJECTED');
    }
  }, [profile?.id]);

  const handleConfirm = useCallback(async () => {
    if (submittingRef.current || !shopOrder) return;

    if (!navigator.onLine) {
      setRejectReason('No internet connection. Please check your network.');
      setStage('REJECTED');
      return;
    }

    submittingRef.current = true;
    setStage('SUBMITTING');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expired. Please log in again.');

      const payload = {
        claim_code:       shopOrder.claim_code,
        shop_id:          shopOrder.shop_id,
        present_item_ids: checkedIds,
        missing_item_ids: uncheckedIds,
      };

      const { data, error } = await supabase.functions.invoke('fulfill-voucher', {
        body: payload,
      });

      if (error || !data?.success) {
        const reason = data?.rejection_reason ?? error?.message ?? 'Handover rejected.';
        setRejectReason(reason);
        if ('vibrate' in navigator) navigator.vibrate([300]);
        toast.error('Handover rejected', { description: reason });
        setStage('REJECTED');
        return;
      }

      if ('vibrate' in navigator) navigator.vibrate([80, 40, 80]);
      toast.success('Handover confirmed!');
      setStage('SUCCESS');
    } catch (err: any) {
      const isNetworkError = err.message?.toLowerCase().includes('fetch') || !navigator.onLine;
      setRejectReason(isNetworkError ? 'Network error. Please check your connection and try again.' : (err.message ?? 'Network error. Please try again.'));
      setStage('REJECTED');
    } finally {
      submittingRef.current = false;
    }
  }, [shopOrder, checkedIds, uncheckedIds]);

  const handleReset = useCallback(() => {
    setCode('');
    setShopOrder(null);
    setItems([]);
    setChecked({});
    setRejectReason('');
    setStage('IDLE');
  }, []);

  return {
    stage,
    inputMode,
    setInputMode,
    code,
    setCode,
    shopOrder,
    items,
    checked,
    setChecked,
    rejectReason,
    checkedIds,
    uncheckedIds,
    payoutTotal,
    handleCodeComplete,
    handleConfirm,
    handleReset,
  };
}
