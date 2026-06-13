import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { validateAndFormatPhone } from '../../utils/phone';
import { parseAuthError } from '../../utils/errorParser';
import { toast } from 'sonner';
import { getFlatCartPayload } from '../../utils/sendFlowStore';

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

export function useCheckout() {
  const { user } = useAuth();
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchWalletBalance = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('kithly_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      setWalletBalance(data?.balance ?? 0);
    } catch (err) {
      console.error('[useCheckout] Error fetching wallet balance:', err);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchWalletBalance();
    }
  }, [user?.id, fetchWalletBalance]);

  const handleCheckout = useCallback(async (params: {
    items: any[];
    recipientName: string;
    recipientPhone: string;
    message: string;
    senderPhone: string;
  }) => {
    const { items, recipientName, recipientPhone, message, senderPhone } = params;

    if (items.length === 0) {
      toast.error('Your cart is empty.');
      return null;
    }

    if (!recipientName.trim()) {
      toast.error("Please provide the recipient's name before proceeding.");
      return null;
    }

    const { isValid: isRecipientValid, formatted: formattedRecipient } = validateAndFormatPhone(recipientPhone);
    if (!isRecipientValid) {
      toast.error('Please provide a valid recipient phone number (including country code) for delivery.');
      return null;
    }

    const { isValid: isSenderValid, formatted: formattedSender } = validateAndFormatPhone(senderPhone);
    if (!isSenderValid) {
      toast.error('Please provide a valid phone number (including country code) for payment billing.');
      return null;
    }

    if (!navigator.onLine) {
      setErrorMsg('No internet connection. Please check your network.');
      return null;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const payload = getFlatCartPayload(items, {
        name: recipientName.trim(),
        phone: formattedRecipient.trim(),
        message: message.trim()
      });

      const { data, error } = await supabase.functions.invoke<CheckoutInitResponse>(
        'checkout-init',
        { body: { ...payload, origin_type: 'LOCAL', sender_phone: formattedSender } },
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

      return {
        transactionId: data.transaction_id,
        shopOrders: data.shop_orders ?? [],
        paymentLink: data.payment_link
      };
    } catch (err: any) {
      console.error('[useCheckout] checkout-init error:', err);
      const isNetworkError = err.message?.toLowerCase().includes('fetch') || !navigator.onLine;
      const parsed = parseAuthError(err);
      const msg = isNetworkError ? 'Network error or timeout. Please check your connection and try again.' : parsed;
      setErrorMsg(msg);
      throw new Error(msg);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return {
    walletBalance,
    isProcessing,
    errorMsg,
    handleCheckout,
    reloadWallet: fetchWalletBalance,
  };
}
