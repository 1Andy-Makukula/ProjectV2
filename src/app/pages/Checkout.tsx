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

import { useState, useEffect, memo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, Trash2, Shield, ArrowLeft, Gift } from 'lucide-react';

import { useCart } from '../hooks/useCart';
import { useAuth } from '../../utils/auth/AuthContext';
import { useSendFlowStore } from '../../utils/sendFlowStore';
import { PaymentProcessingScreen } from '../components/checkout/PaymentProcessingScreen';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { formatCurrency } from '../../utils/currency';
import { PhoneInput } from '../components/shared/PhoneInput';
import { useCheckout, ShopOrderResult } from '../hooks/useCheckout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckoutStage =
  | 'CART'       // browsing the cart, ready to pay
  | 'SECURING'   // optimistic UI — API call in flight
  | 'PROCESSING' // voucherId received, polling begins
  | 'ERROR';     // checkout-init failed

// ---------------------------------------------------------------------------
// Animation presets
// ---------------------------------------------------------------------------

const fadeUp: any = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
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
  const { items, removeFromCart, clearCart, getTotalAmount, applyCredits } = useCart();
  const { recipient } = useSendFlowStore();
  const { profile } = useAuth();

  const [stage, setStage] = useState<CheckoutStage>('CART');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [shopOrders, setShopOrders] = useState<ShopOrderResult[]>([]);

  const [recipientName, setRecipientName] = useState(recipient?.name ?? '');
  const [recipientPhone, setRecipientPhone] = useState(recipient?.phone ?? '');
  const [senderPhone, setSenderPhone] = useState(profile?.phone ?? '');
  const [message, setMessage] = useState(recipient?.message ?? '');

  const {
    walletBalance,
    errorMsg,
    handleCheckout,
  } = useCheckout();

  // Execution Guard: Synchronously tracks if a payment request is in flight
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (profile?.phone && !senderPhone) {
      setSenderPhone(profile.phone);
    }
  }, [profile, senderPhone]);

  const totalAmount = getTotalAmount();
  const creditsToApply = applyCredits ? Math.min(walletBalance, totalAmount) : 0;
  const finalPayable = totalAmount - creditsToApply;

  // ---------- handlers --------------------------------------------------

  const handlePay = async () => {
    // 1. Instantly block duplicate rapid-fire clicks
    if (isSubmittingRef.current) return;

    // 2. Lock the execution gate
    isSubmittingRef.current = true;

    // Immediately shift UI to the compliance screen — don't wait for the API.
    setStage('SECURING');

    try {
      const result = await handleCheckout({
        items,
        recipientName,
        recipientPhone,
        message,
        senderPhone,
      });

      if (!result) {
        setStage('CART');
        isSubmittingRef.current = false; // Unlock if aborted
        return;
      }

      setTransactionId(result.transactionId);
      setShopOrders(result.shopOrders);

      // Clear the cart immediately — the transaction is created, items are committed.
      clearCart();
      
      // Open the Flutterwave-hosted payment page in a new tab so the polling
      // screen can remain active in this tab.
      if (result.paymentLink && result.paymentLink !== '#') {
        window.open(result.paymentLink, '_blank');
      }

      setStage('PROCESSING');
      // Do not unlock here: we are transitioning to the polling screen, 
      // the user should not be able to interact with the pay button anymore.
    } catch (err) {
      setStage('ERROR');
      isSubmittingRef.current = false; // Unlock so they can try again
    }
  };

  const handleComplete = () => {
    setStage('CART');
    setTransactionId(null);
    setShopOrders([]);
    navigate('/orders');
  };

  // ---------- PROCESSING: hand off entirely to PaymentProcessingScreen ----

  if (stage === 'PROCESSING' && transactionId) {
    return (
      <PaymentProcessingScreen
        transactionId={transactionId}
        shopOrders={shopOrders}
        recipientName={recipientName}
        senderName={profile?.name ?? ''}
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
              <div className="flex flex-col items-center justify-center pt-8 pb-4">
                <div className="flex items-center gap-3 group">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center shadow-md">
                    <Gift className="w-6 h-6 text-white" strokeWidth={1.5} />
                  </div>
                  <span className="text-3xl font-light tracking-tight text-slate-800">
                    KithLy Checkout
                  </span>
                </div>
              </div>

              {/* Sticky header */}
              <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-100 rounded-t-2xl">
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
                    onClick={() => navigate('/shops')}
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

                  {/* Recipient Details */}
                  <div className="rounded-2xl bg-white border border-slate-100 px-5 py-5 space-y-4">
                    <h3 className="font-semibold text-slate-900">Recipient Details</h3>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="recipientName" className="text-xs text-slate-500 mb-1.5 block">Recipient Name</Label>
                        <Input
                          id="recipientName"
                          placeholder="e.g. Jane Doe"
                          value={recipientName}
                          onChange={(e) => setRecipientName(e.target.value)}
                          className="h-11 rounded-xl"
                        />
                      </div>
                      <div>
                        <Label htmlFor="recipientPhone" className="text-xs text-slate-500 mb-1.5 block">Recipient Phone (for gift delivery)</Label>
                        <PhoneInput
                          id="recipientPhone"
                          placeholder="e.g. 97 123 4567"
                          value={recipientPhone}
                          onChange={(val) => setRecipientPhone(val)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="message" className="text-xs text-slate-500 mb-1.5 block">Gift Message (Optional)</Label>
                        <Textarea
                          id="message"
                          placeholder="Write a nice message..."
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          className="resize-none rounded-xl"
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Billing Details */}
                  <div className="rounded-2xl bg-white border border-slate-100 px-5 py-5 space-y-4">
                    <h3 className="font-semibold text-slate-900">Billing Details</h3>
                    <div>
                      <Label htmlFor="senderPhone" className="text-xs text-slate-500 mb-1.5 block">Your Phone (for payment)</Label>
                      <PhoneInput
                        id="senderPhone"
                        placeholder="e.g. 97 123 4567"
                        value={senderPhone}
                        onChange={(val) => setSenderPhone(val)}
                      />
                      <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                        Flutterwave will trigger MTN/Airtel mobile money billing prompts on this line.
                      </p>
                    </div>
                  </div>

                  {/* Order total */}
                  <div className="rounded-2xl bg-white border border-slate-100 px-5 py-5 flex flex-col gap-2 shadow-sm">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 font-medium">Subtotal</span>
                      <span className="font-semibold text-slate-800">
                        {formatCurrency(totalAmount, 'ZMW')}
                      </span>
                    </div>
                    {applyCredits && creditsToApply > 0 && (
                      <div className="flex items-center justify-between text-sm text-orange-600 font-medium">
                        <span>Credits applied</span>
                        <span>-{formatCurrency(creditsToApply, 'ZMW')}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm pt-2.5 border-t border-slate-100 mt-1">
                      <span className="text-slate-900 font-bold">Total payable</span>
                      <span className="text-lg font-bold bg-gradient-to-r from-[#F97316] to-[#1E3A8A] bg-clip-text text-transparent">
                        {formatCurrency(finalPayable, 'ZMW')}
                      </span>
                    </div>
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
                      Pay {formatCurrency(finalPayable, 'ZMW')}
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
