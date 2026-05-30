/**
 * Checkout.tsx — KithLy V2 Cart Checkout Page
 *
 * Render flow:
 *   CART      → Cart summary with line items + "Pay" button
 *   SECURING  → Instant transitional screen: "Global Compliance Check Active"
 *               (shown the moment the user taps Pay, before the API resolves)
 *   PROCESSING → Hands off to <PaymentProcessingScreen> once we have a voucherId
 *   ERROR     → Inline error with retry
 */

import { useState, memo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, Trash2, Shield, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

import { useCart } from '../hooks/useCart';
import { supabase } from '../../lib/supabaseClient';
import { getGroupedCartPayload } from '../../utils/sendFlowStore';
import { useSendFlowStore } from '../../utils/sendFlowStore';
import { PaymentProcessingScreen } from '../components/checkout/PaymentProcessingScreen';
import { Button } from '../components/ui/button';
import { formatCurrency } from '../../utils/currency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckoutStage =
  | 'CART'       // browsing the cart, ready to pay
  | 'SECURING'   // optimistic UI — API call in flight
  | 'PROCESSING' // voucherId received, polling begins
  | 'ERROR';     // checkout-init failed

interface ShopOrderResult {
  shop_order_id: string;
  claim_code: string;
  shop_id: string;
  subtotal: number;
}

interface CheckoutInitResponse {
  success: boolean;
  transaction_id: string;
  shop_orders: ShopOrderResult[];
  payment_link: string;
}

// ---------------------------------------------------------------------------
// Animation presets
// ---------------------------------------------------------------------------

const fadeUp = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -12, transition: { duration: 0.25, ease: 'easeIn' } },
};

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

/** Pulsing compliance lock screen shown immediately on "Pay" click */
function SecuringEscrowView() {
  return (
    <motion.div
      key="securing"
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex min-h-screen w-full flex-col items-center justify-center bg-white px-6"
    >
      <div className="flex flex-col items-center gap-10 text-center">
        {/* Animated lock rings */}
        <div className="relative flex items-center justify-center" aria-hidden>
          <motion.span
            className="absolute h-28 w-28 rounded-full border border-orange-100"
            animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.1, 0.4] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.span
            className="absolute h-20 w-20 rounded-full border border-orange-200"
            animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0.2, 0.6] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
          />
          {/* Core shield */}
          <motion.div
            className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C] shadow-lg shadow-orange-200"
            animate={{ scale: [1, 0.95, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }}
          >
            <Shield className="h-6 w-6 text-white" strokeWidth={1.5} />
          </motion.div>
        </div>

        {/* Copy */}
        <div className="flex flex-col items-center gap-3">
          <motion.h1
            className="text-xl font-semibold tracking-tight text-slate-900"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Global Compliance Check Active
          </motion.h1>
          <motion.p
            className="max-w-xs text-sm leading-relaxed text-slate-500"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
          >
            Securing Escrow — your funds are being locked and verified before
            the gift is released to the merchant.
          </motion.p>
        </div>

        {/* Animated progress dots */}
        <div className="flex gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full bg-orange-300"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-8 flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round"
          className="h-3.5 w-3.5 text-slate-300" aria-hidden>
          <rect x="3" y="7" width="10" height="8" rx="1.5" />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" />
        </svg>
        <span className="text-xs text-slate-400">Escrow-protected transaction</span>
      </div>
    </motion.div>
  );
}

/** Cart line item row */
const CartLineItem = memo(function CartLineItem({
  product,
  quantity,
  onRemove,
}: {
  product: { id: string; name?: string; title?: string; price_zmw: number; image_url?: string | null; images?: string[]; shop?: { business_name?: string; name?: string } };
  quantity: number;
  onRemove: (id: string) => void;
}) {
  const handleRemove = useCallback(() => {
    onRemove(product.id);
  }, [onRemove, product.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, transition: { duration: 0.2 } }}
      className="flex items-center gap-3 sm:gap-4 py-4 border-b border-slate-100 last:border-0"
    >
      {/* Thumbnail */}
      <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
        {(product.image_url || product.images?.[0]) ? (
          <img src={product.image_url || product.images![0]} alt={product.name || product.title} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <ShoppingBag className="h-6 w-6 text-slate-300" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-900 truncate">{product.name || product.title}</p>
        {(product.shop?.business_name || product.shop?.name) && (
          <p className="text-xs text-slate-500 mt-0.5">{product.shop.business_name || product.shop.name}</p>
        )}
        <p className="text-sm font-semibold text-[#F97316] mt-1">
          {formatCurrency(product.price_zmw * quantity, 'ZMW')}
          {quantity > 1 && (
            <span className="ml-1 text-xs font-normal text-slate-500">
              × {quantity}
            </span>
          )}
        </p>
      </div>

      {/* Remove */}
      <button
        onClick={handleRemove}
        className="p-2 text-slate-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50"
        aria-label={`Remove ${product.name || product.title} from cart`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </motion.div>
  );
});

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function Checkout() {
  const navigate = useNavigate();
  const { items, removeFromCart, clearCart, getTotalAmount } = useCart();
  const { recipient } = useSendFlowStore();

  const [stage, setStage] = useState<CheckoutStage>('CART');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [shopOrders, setShopOrders] = useState<ShopOrderResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const totalAmount = getTotalAmount();

  // ---------- handlers --------------------------------------------------

  const handlePay = async () => {
    if (items.length === 0) {
      toast.error('Your cart is empty.');
      return;
    }

    if (!navigator.onLine) {
      setErrorMsg('No internet connection. Please check your network.');
      setStage('ERROR');
      return;
    }

    // Immediately shift UI to the compliance screen — don't wait for the API.
    setStage('SECURING');
    setErrorMsg(null);

    try {
      // Include recipient details from the SendFlow store so checkout-init
      // can persist them to each shop_orders row it creates.
      const payload = getGroupedCartPayload(items, recipient ?? undefined);

      const { data, error } = await supabase.functions.invoke<CheckoutInitResponse>(
        'checkout-init',
        { body: { ...payload, origin_type: 'LOCAL' } },
      );

      if (error || !data?.transaction_id) {
        throw new Error(error?.message ?? 'Checkout initialisation failed. Please try again.');
      }

      setTransactionId(data.transaction_id);
      setShopOrders(data.shop_orders ?? []);
      
      // Open the Flutterwave-hosted payment page in a new tab so the polling
      // screen can remain active in this tab.
      if (data.payment_link && data.payment_link !== '#') {
        window.open(data.payment_link, '_blank');
      }

      setStage('PROCESSING');
    } catch (err: any) {
      console.error('[Checkout] checkout-init error:', err);
      const isNetworkError = err.message?.toLowerCase().includes('fetch') || !navigator.onLine;
      setErrorMsg(isNetworkError ? 'Network error or timeout. Please check your connection and try again.' : (err.message ?? 'Something went wrong. Please try again.'));
      setStage('ERROR');
    }
  };

  const handleComplete = () => {
    clearCart();
    navigate('/orders');
  };

  // ---------- PROCESSING: hand off entirely to PaymentProcessingScreen ----

  if (stage === 'PROCESSING' && transactionId) {
    return (
      <PaymentProcessingScreen
        transactionId={transactionId}
        shopOrders={shopOrders}
        onComplete={handleComplete}
      />
    );
  }

  // ---------- SECURING / CART / ERROR screens -----------------------------

  return (
    <div className="min-h-screen bg-slate-50">
      <AnimatePresence mode="wait">
        {/* ---- Compliance/securing transitional screen ---- */}
        {stage === 'SECURING' && <SecuringEscrowView key="securing" />}

        {/* ---- Cart + error ---- */}
        {(stage === 'CART' || stage === 'ERROR') && (
          <motion.div
            key="cart"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="max-w-2xl mx-auto"
          >
            {/* Sticky header */}
            <div className="sticky top-0 z-10 bg-white border-b border-slate-100">
              <div className="flex items-center gap-3 px-4 sm:px-5 py-4">
                <button
                  onClick={() => navigate(-1)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                  Your Cart
                </h1>
                {items.length > 0 && (
                  <span className="ml-auto text-xs text-slate-500">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                  </span>
                )}
              </div>
            </div>

            <div className="px-4 sm:px-5 py-6 space-y-4">
              {/* Error banner */}
              {stage === 'ERROR' && errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {errorMsg}
                </motion.div>
              )}

              {/* Empty state */}
              {items.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center gap-4 py-20 text-center"
                >
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100">
                    <ShoppingBag className="h-9 w-9 text-slate-300" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">Your cart is empty</p>
                    <p className="text-sm text-slate-500 mt-1">
                      Add gifts to your cart from the shop catalogue.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-2"
                    onClick={() => navigate('/')}
                  >
                    Browse Gifts
                  </Button>
                </motion.div>
              )}

              {/* Line items */}
              {items.length > 0 && (
                <>
                  <div className="rounded-2xl bg-white border border-slate-100 px-4 sm:px-5 divide-y divide-slate-50">
                    <AnimatePresence>
                      {items.map(({ product, quantity }) => (
                        <CartLineItem
                          key={product.id}
                          product={product as any}
                          quantity={quantity}
                          onRemove={removeFromCart}
                        />
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* Order total */}
                  <div className="rounded-2xl bg-white border border-slate-100 px-5 py-4 flex items-center justify-between">
                    <span className="text-sm text-slate-500">Total</span>
                    <span className="text-xl font-semibold text-slate-900">
                      {formatCurrency(totalAmount, 'ZMW')}
                    </span>
                  </div>

                  {/* Escrow notice */}
                  <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                    <Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                    <p className="text-xs leading-relaxed text-blue-700">
                      Your payment is held in secure escrow. Funds are only
                      released to the merchant after your recipient collects
                      their gift.
                    </p>
                  </div>

                  {/* Pay button */}
                  <motion.div
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button
                      id="checkout-pay-button"
                      onClick={handlePay}
                      className="w-full h-14 text-base font-semibold rounded-2xl bg-gradient-to-r from-[#F97316] to-[#FB923C] hover:from-[#ea6c0a] hover:to-[#f58220] text-white shadow-lg shadow-orange-200 border-0"
                    >
                      Pay {formatCurrency(totalAmount, 'ZMW')}
                    </Button>
                  </motion.div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Checkout;
