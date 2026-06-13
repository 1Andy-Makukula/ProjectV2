import { useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useSendFlowStore } from '../../../utils/sendFlowStore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { PhoneInput } from '../../components/shared/PhoneInput';
import { ArrowLeft, Store, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCart } from '../../hooks/useCart';
import { PaymentProcessingScreen } from '../../components/checkout/PaymentProcessingScreen';
import { formatZMW } from '../../utils/formatters';
import { useSendFlow } from '../../hooks/useSendFlow';

type CheckoutStage =
  | 'FORM'
  | 'SECURING'
  | 'PROCESSING'
  | 'ERROR';

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

const fadeUp = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -12, transition: { duration: 0.25, ease: 'easeIn' } },
};

export function SendFlow() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { setRecipient } = useSendFlowStore();
  const { addToCart, items: cartItems } = useCart();

  const {
    item,
    shop,
    loading,
    formData,
    setFormData,
    errors,
    stage,
    transactionId,
    shopOrders,
    errorMsg,
    senderPhone,
    setSenderPhone,
    handlePay,
    resetFlow,
  } = useSendFlow(itemId);

  const handlePhoneChange = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, recipientPhone: value }));
  }, [setFormData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!item || !shop) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-medium mb-2">Item Not Found</h2>
          <p className="text-muted-foreground mb-6">
            This item doesn't exist or is no longer available.
          </p>
          <Button onClick={() => navigate('/')}>Go Back Home</Button>
        </div>
      </div>
    );
  }

  if (!item.is_available) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-medium mb-2">Item Unavailable</h2>
          <p className="text-muted-foreground mb-6">
            This item is currently unavailable for purchase.
          </p>
          <Button onClick={() => navigate(`/shop/${item.shop_id}`)}>
            Back to Shop
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'PROCESSING' && transactionId) {
    return (
      <PaymentProcessingScreen
        transactionId={transactionId}
        shopOrders={shopOrders}
        recipientName={formData.recipientName}
        senderName={profile?.name ?? ''}
        onComplete={() => navigate('/orders')}
      />
    );
  }

  const messageCharsRemaining = 200 - formData.message.length;

  return (
    <div className="min-h-screen bg-slate-50">
      <AnimatePresence mode="wait">
        {stage === 'SECURING' && <SecuringEscrowView key="securing" />}

        {(stage === 'FORM' || stage === 'ERROR') && (
          <motion.div
            key="form"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="max-w-2xl mx-auto"
          >
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-10">
              <div className="px-6 py-4 flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate(`/shop/${item.shop_id}`)}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <h1 className="text-xl font-semibold">Send Gift</h1>
              </div>
            </div>

            {/* Main Content */}
            <div className="px-6 py-8 space-y-6">
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

              {/* Item Summary Card */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex gap-4">
                    {/* Item Image */}
                    <div className="w-24 h-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Store className="w-8 h-8 text-gray-400" />
                        </div>
                      )}
                    </div>

                    {/* Item Details */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg mb-1">{item.name}</h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        from {shop.name}
                      </p>
                      <p className="text-lg font-bold text-primary">
                        {formatZMW(item.price_zmw)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Recipient & Billing Form */}
              <Card>
                <CardHeader>
                  <CardTitle>Gift Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Recipient Name */}
                  <div>
                    <label
                      htmlFor="recipientName"
                      className="block text-sm font-medium mb-2"
                    >
                      Recipient Name <span className="text-red-500">*</span>
                    </label>
                    <Input
                      id="recipientName"
                      type="text"
                      placeholder="Enter recipient's full name"
                      value={formData.recipientName}
                      onChange={(e) =>
                        setFormData({ ...formData, recipientName: e.target.value })
                      }
                      aria-invalid={!!errors.recipientName}
                    />
                    {errors.recipientName && (
                      <p className="text-sm text-red-500 mt-1">
                        {errors.recipientName}
                      </p>
                    )}
                  </div>

                  {/* Recipient Phone */}
                  <div>
                    <label
                      htmlFor="recipientPhone"
                      className="block text-sm font-medium mb-2"
                    >
                      Recipient Phone <span className="text-red-500">*</span>
                    </label>
                    <PhoneInput
                      id="recipientPhone"
                      value={formData.recipientPhone}
                      onChange={handlePhoneChange}
                      aria-invalid={!!errors.recipientPhone}
                    />
                    {errors.recipientPhone && (
                      <p className="text-sm text-red-500 mt-1">
                        {errors.recipientPhone}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      Recipient's phone number to deliver the claim code once payment succeeds.
                    </p>
                  </div>

                  {/* Message */}
                  <div>
                    <label
                      htmlFor="message"
                      className="block text-sm font-medium mb-2"
                    >
                      Personal Message{' '}
                      <span className="text-muted-foreground font-normal">
                        (Optional)
                      </span>
                    </label>
                    <Textarea
                      id="message"
                      placeholder="Add a personal message for the recipient..."
                      value={formData.message}
                      onChange={(e) =>
                        setFormData({ ...formData, message: e.target.value })
                      }
                      rows={4}
                      maxLength={200}
                      aria-invalid={!!errors.message}
                    />
                    <div className="flex justify-between items-center mt-1">
                      {errors.message ? (
                        <p className="text-sm text-red-500">{errors.message}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Make it special with a heartfelt message
                        </p>
                      )}
                      <p
                        className={`text-sm ${messageCharsRemaining < 20
                          ? 'text-orange-500'
                          : 'text-muted-foreground'
                          }`}
                      >
                        {messageCharsRemaining} characters remaining
                      </p>
                    </div>
                  </div>

                  {/* Billing Details Divider & Field */}
                  <div className="border-t border-slate-100 my-4 pt-4">
                    <h3 className="font-semibold text-slate-900 text-sm mb-3">Billing Details</h3>
                    <div>
                      <label
                        htmlFor="senderPhone"
                        className="block text-sm font-medium mb-2"
                      >
                        Your Phone (for payment) <span className="text-red-500">*</span>
                      </label>
                      <PhoneInput
                        id="senderPhone"
                        value={senderPhone}
                        onChange={(val) => setSenderPhone(val)}
                        aria-invalid={!!errors.senderPhone}
                      />
                      {errors.senderPhone && (
                        <p className="text-sm text-red-500 mt-1">
                          {errors.senderPhone}
                        </p>
                      )}
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                        Flutterwave will trigger a USSD/Mobile Money payment prompt on this phone.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pay Button */}
              <motion.div
                whileTap={{ scale: 0.98 }}
              >
                <Button
                  onClick={handlePay}
                  className="w-full h-14 text-base font-semibold rounded-2xl bg-gradient-to-r from-[#F97316] to-[#FB923C] hover:from-[#ea6c0a] hover:to-[#f58220] text-white shadow-lg shadow-orange-200 border-0"
                >
                  Pay {formatZMW(item.price_zmw)}
                </Button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
