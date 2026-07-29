import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { validateAndFormatPhone } from '../../utils/phone';
import { parseAuthError } from '../../utils/errorParser';
import { toast } from 'sonner';
import { getFlatCartPayload, useSendFlowStore } from '../../utils/sendFlowStore';
import { useCart } from './useCart';
import { usePlatformPricing } from './usePlatformPricing';
import { grossPayableFor, CHECKOUT_ORIGIN } from '../../utils/pricing';

export interface ShopOrderResult {
  shop_order_id: string;
  claim_code: string;
  shop_id: string;
  subtotal: number;
}

export interface CheckoutInitResponse {
  success: boolean;
  transaction_id: string;
  total_amount: number;
  /** Basket total before the service fee. */
  items_subtotal?: number;
  /** Buyer-facing service fee included in total_amount. */
  platform_fee?: number;
  /** `checkout-init` returns this key; the camelCase form is a legacy fallback. */
  payment_link?: string;
  paymentLink?: string;
  shop_orders: ShopOrderResult[];
}

export function useCheckout() {
  const { profile } = useAuth();
  const { rates: feeRates } = usePlatformPricing();
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchWalletBalance = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('kithly_wallets')
      .select('balance')
      .eq('user_id', profile.id)
      .maybeSingle();

    if (!error && data) {
      setWalletBalance(data.balance);
    }
  }, [profile?.id]);

  // Fetch wallet balance
  useEffect(() => {
    fetchWalletBalance();
  }, [fetchWalletBalance]);

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
      const { applyCredits, getTotalAmount } = useCart.getState();
      const totalAmount = getTotalAmount();
      // Credits offset the whole bill, service fee included, so cap against the
      // gross rather than the basket — otherwise the server rejects the excess.
      const grossPayable = grossPayableFor(totalAmount, CHECKOUT_ORIGIN, feeRates);
      const creditsToApply = applyCredits ? Math.min(walletBalance, grossPayable) : 0;

      const payload = getFlatCartPayload(items, {
        name: recipientName.trim(),
        phone: formattedRecipient.trim(),
        message: message.trim()
      });

      const { data, error } = await supabase.functions.invoke<CheckoutInitResponse>(
        'checkout-init',
        {
          body: {
            ...payload,
            origin_type: 'LOCAL',
            sender_phone: formattedSender,
            credits_to_apply: creditsToApply,
            // Present when this checkout came from an accepted quotation for
            // work booked on a specific date.
            target_execution_date: useSendFlowStore.getState().targetExecutionDate,
            // Present when the cart was filled from a curated experience.
            experience_id: useSendFlowStore.getState().experienceId,
          }
        },
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
        paymentLink: data.payment_link || data.paymentLink || null
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
