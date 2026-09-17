import { useState, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { normalizeClaimCode, partitionItemIds } from '../../lib/money/validation';
import { toast } from 'sonner';

export type Stage = 'IDLE' | 'LOADING' | 'CHECKLIST' | 'SUBMITTING' | 'SUCCESS' | 'REJECTED';
export type InputMode = 'qr' | 'manual';

/** What the buyer chose for one line, snapshotted at checkout. */
export interface SelectedOption {
  group?: string;
  value?: string;
  delta?: number;
}

export interface OrderItem {
  order_item_id: string;
  item_id: string;
  allocated_price: number;
  item_name: string;
  item_image_url: string | null;
  /**
   * The variant the buyer picked. Kept verbatim rather than re-joined, so it
   * stays readable after the option definitions change. Without it a cashier
   * cannot tell which of three sizes to hand over -- the column was already
   * being selected here and then dropped on the way into state.
   */
  selected_options: SelectedOption[] | null;
}

export interface ShopOrder {
  shop_order_id: string;
  shop_id: string;
  claim_code: string;
  subtotal: number;
  /** Who is collecting. Shown so the counter can check the name matches. */
  recipient_name: string | null;
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
    // A length check let a scanner push any 8 characters straight into the
    // query. This normalises case and whitespace and rejects anything that is
    // not a redeemable shape, using the same rule the Edge Function applies.
    const claimCode = normalizeClaimCode(val);
    if (!claimCode) return;

    if (!navigator.onLine) {
      setRejectReason('No internet connection. Please check your network.');
      setStage('REJECTED');
      return;
    }

    // The ownership filter below is the only thing scoping this lookup to the
    // merchant's own shop. `profile?.id` being undefined would send an
    // undefined value into that filter rather than failing, so it is checked
    // here instead of relying on how PostgREST happens to treat it.
    const merchantUserId = profile?.id;
    if (!merchantUserId) {
      setRejectReason('Your merchant profile is still loading. Try again in a moment.');
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
          recipient_name,
          shop:shop_id!inner (
            merchant_shops!inner ( user_id )
          ),
          order_items (
            order_item_id,
            item_id,
            allocated_price,
            selected_options,
            items ( name, image_url )
          )
        `)
        .eq('claim_code', claimCode)
        // PENDING is the only state fulfill-voucher will act on: it means paid
        // and awaiting collection. Without this the checklist happily loads an
        // order that is already redeemed -- or, worse, one still on
        // PENDING_PAYMENT and therefore unpaid -- and the cashier only finds
        // out after ticking every item and pressing confirm.
        .eq('claim_status', 'PENDING')
        .eq('shop.merchant_shops.user_id', merchantUserId)
        .single();

      if (orderErr || !orderData) {
        setRejectReason('This code is invalid, already redeemed, or does not belong to your shop.');
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
        selected_options: Array.isArray(r.selected_options) ? r.selected_options : null,
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

    // The two lists are built by one partitioning loop below and cannot overlap
    // by construction, so this never fires today. It is here because the server
    // rejects an overlap outright, and a future edit that lets a cashier move an
    // item between the lists would otherwise turn a UI slip into a failed
    // handover at the counter rather than a message before submitting.
    const partition = partitionItemIds(checkedIds, uncheckedIds);
    if (!partition.ok) {
      setRejectReason(partition.reason);
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

      // A gateway or proxy failure can return a body that is not the JSON shape
      // this function documents. Treating that as a plain rejection would show
      // the cashier "Handover rejected" for what is actually an infrastructure
      // fault, so it is named separately.
      if (!error && data != null && typeof data !== 'object') {
        setRejectReason('The server returned an unreadable response. Please try again.');
        if ('vibrate' in navigator) navigator.vibrate([300]);
        toast.error('Handover failed', { description: 'Unreadable server response.' });
        setStage('REJECTED');
        return;
      }

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
