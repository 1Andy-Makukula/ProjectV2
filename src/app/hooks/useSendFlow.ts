import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { validateAndFormatPhone } from '../../utils/phone';
import { parseAuthError } from '../../utils/errorParser';

export interface Item {
  id: string;
  name: string;
  description: string | null;
  price_zmw: number;
  currency: string;
  image_url: string | null;
  shop_id: string;
  is_available: boolean;
  requires_scheduling: boolean;
  lead_time_days: number | null;
}

export interface Shop {
  id: string;
  name: string;
}

export interface SendFlowFormData {
  recipientName: string;
  recipientPhone: string;
  message: string;
  senderPhone?: string;
}

export type CheckoutStage =
  | 'FORM'
  | 'SECURING'
  | 'PROCESSING'
  | 'ERROR';

export interface ShopOrderResult {
  shop_order_id: string;
  claim_code: string;
  shop_id: string;
  subtotal: number;
}

export interface CheckoutInitResponse {
  success: boolean;
  transaction_id: string;
  shop_orders: ShopOrderResult[];
  payment_link: string;
}

/** Earliest bookable datetime-local string, honouring the item's lead time. */
export function minSchedulableDateTime(leadTimeDays: number | null): string {
  const min = new Date();
  min.setDate(min.getDate() + (leadTimeDays ?? 0));
  min.setSeconds(0, 0);
  // toISOString() is UTC; datetime-local inputs want local wall-clock time
  // with no timezone suffix, so build it from local getters instead.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${min.getFullYear()}-${pad(min.getMonth() + 1)}-${pad(min.getDate())}T${pad(min.getHours())}:${pad(min.getMinutes())}`;
}

export function useSendFlow(itemId: string | undefined) {
  const { profile } = useAuth();
  const isSubmittingRef = useRef(false);

  const [item, setItem] = useState<Item | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState<SendFlowFormData>({
    recipientName: '',
    recipientPhone: '+260',
    message: '',
  });

  const [errors, setErrors] = useState<
    Partial<SendFlowFormData & { senderPhone?: string; targetExecutionDate?: string }>
  >({});
  const [stage, setStage] = useState<CheckoutStage>('FORM');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [shopOrders, setShopOrders] = useState<ShopOrderResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [senderPhone, setSenderPhone] = useState(profile?.phone ?? '+260');
  // datetime-local string (e.g. "2026-08-05T14:00"); only meaningful when
  // item.requires_scheduling is true.
  const [targetExecutionDate, setTargetExecutionDate] = useState('');

  useEffect(() => {
    if (profile?.phone) {
      setSenderPhone(profile.phone);
    }
  }, [profile]);

  useEffect(() => {
    async function fetchItemDetails() {
      if (!itemId) return;

      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('items')
          .select('*, shop:shops(id, name)')
          .eq('id', itemId)
          .single();

        if (error) throw error;
        
        const { shop: shopData, ...itemData } = data as any;
        setItem(itemData);
        setShop(shopData);
      } catch (error) {
        console.error('[useSendFlow] Error fetching item details:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchItemDetails();
  }, [itemId]);

  const validateForm = (): boolean => {
    const newErrors: Partial<SendFlowFormData & { senderPhone?: string; targetExecutionDate?: string }> = {};

    if (!formData.recipientName.trim()) {
      newErrors.recipientName = 'Recipient name is required';
    }

    if (item?.requires_scheduling) {
      if (!targetExecutionDate) {
        newErrors.targetExecutionDate = 'Please choose a date and time';
      } else if (new Date(targetExecutionDate) < new Date(minSchedulableDateTime(item.lead_time_days))) {
        newErrors.targetExecutionDate = item.lead_time_days
          ? `This shop needs at least ${item.lead_time_days} ${item.lead_time_days === 1 ? "day's" : "days'"} notice`
          : 'Please choose a time in the future';
      }
    }

    if (!formData.recipientPhone.trim()) {
      newErrors.recipientPhone = 'Recipient phone is required';
    } else {
      const { isValid } = validateAndFormatPhone(formData.recipientPhone);
      if (!isValid) {
        newErrors.recipientPhone = 'Please enter a valid phone number for Zambia, USA, UK, or Australia';
      }
    }

    if (!senderPhone.trim()) {
      newErrors.senderPhone = 'Your payment phone number is required';
    } else {
      const { isValid } = validateAndFormatPhone(senderPhone);
      if (!isValid) {
        newErrors.senderPhone = 'Please enter a valid phone number (including country code) for payment';
      }
    }

    if (formData.message.length > 200) {
      newErrors.message = 'Message must be 200 characters or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handlePay = async () => {
    // Synchronous double-click guard
    if (isSubmittingRef.current) return;

    if (!validateForm() || !item || !shop) return;

    // Lock the execution gate
    isSubmittingRef.current = true;

    const { formatted: formattedRecipient } = validateAndFormatPhone(formData.recipientPhone);
    const { formatted: formattedSender } = validateAndFormatPhone(senderPhone);

    if (!navigator.onLine) {
      setErrorMsg('No internet connection. Please check your network.');
      setStage('ERROR');
      isSubmittingRef.current = false; // Unlock
      return;
    }

    setStage('SECURING');
    setErrorMsg(null);

    try {
      const payload = {
        cart_items: [
          { item_id: item.id, quantity: 1, shop_id: item.shop_id }
        ],
        origin_type: 'LOCAL',
        recipient_name: formData.recipientName.trim(),
        recipient_phone: formattedRecipient,
        message: formData.message.trim(),
        sender_phone: formattedSender,
        ...(item.requires_scheduling && targetExecutionDate
          ? { target_execution_date: new Date(targetExecutionDate).toISOString() }
          : {}),
      };

      const { data, error } = await supabase.functions.invoke<CheckoutInitResponse>(
        'checkout-init',
        { body: payload }
      );

      if (error) {
        throw new Error(error?.message ?? 'Checkout initialisation failed.');
      }
      if (data?.success === false || (data as any).error) {
        throw new Error((data as any).error ?? 'Checkout rejected by server.');
      }
      if (!data?.transaction_id) {
        throw new Error('Checkout initialisation failed (missing transaction ID).');
      }

      setTransactionId(data.transaction_id);
      setShopOrders(data.shop_orders ?? []);

      if (data.payment_link && data.payment_link !== '#') {
        window.location.href = data.payment_link;
      }

      setStage('PROCESSING');
      // Intentionally left locked during polling
    } catch (err: any) {
      console.error('[useSendFlow] checkout-init error:', err);
      const isNetworkError = err.message?.toLowerCase().includes('fetch') || !navigator.onLine;
      const parsed = parseAuthError(err);
      setErrorMsg(isNetworkError ? 'Network error or timeout. Please check your connection and try again.' : parsed);
      setStage('ERROR');
      
      isSubmittingRef.current = false; // Unlock for retry
    }
  };

  const resetFlow = useCallback(() => {
    setStage('FORM');
    setTransactionId(null);
    setShopOrders([]);
    setErrorMsg(null);
    isSubmittingRef.current = false; // Ensure the gate is unlocked on reset
  }, []);

  return {
    item,
    shop,
    loading,
    formData,
    setFormData,
    errors,
    setErrors,
    stage,
    transactionId,
    shopOrders,
    errorMsg,
    senderPhone,
    setSenderPhone,
    targetExecutionDate,
    setTargetExecutionDate,
    handlePay,
    resetFlow,
    profile,
  };
}
