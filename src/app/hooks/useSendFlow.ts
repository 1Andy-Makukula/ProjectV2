import { useEffect, useState, useCallback } from 'react';
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

export function useSendFlow(itemId: string | undefined) {
  const { profile } = useAuth();

  const [item, setItem] = useState<Item | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState<SendFlowFormData>({
    recipientName: '',
    recipientPhone: '+260',
    message: '',
  });

  const [errors, setErrors] = useState<Partial<SendFlowFormData & { senderPhone?: string }>>({});
  const [stage, setStage] = useState<CheckoutStage>('FORM');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [shopOrders, setShopOrders] = useState<ShopOrderResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [senderPhone, setSenderPhone] = useState(profile?.phone ?? '+260');

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
    const newErrors: Partial<SendFlowFormData & { senderPhone?: string }> = {};

    if (!formData.recipientName.trim()) {
      newErrors.recipientName = 'Recipient name is required';
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
    if (!validateForm() || !item || !shop) return;

    const { formatted: formattedRecipient } = validateAndFormatPhone(formData.recipientPhone);
    const { formatted: formattedSender } = validateAndFormatPhone(senderPhone);

    if (!navigator.onLine) {
      setErrorMsg('No internet connection. Please check your network.');
      setStage('ERROR');
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
        sender_phone: formattedSender
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
        window.open(data.payment_link, '_blank');
      }

      setStage('PROCESSING');
    } catch (err: any) {
      console.error('[useSendFlow] checkout-init error:', err);
      const isNetworkError = err.message?.toLowerCase().includes('fetch') || !navigator.onLine;
      const parsed = parseAuthError(err);
      setErrorMsg(isNetworkError ? 'Network error or timeout. Please check your connection and try again.' : parsed.message);
      setStage('ERROR');
    }
  };

  const resetFlow = useCallback(() => {
    setStage('FORM');
    setTransactionId(null);
    setShopOrders([]);
    setErrorMsg(null);
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
    handlePay,
    resetFlow,
    profile,
  };
}
