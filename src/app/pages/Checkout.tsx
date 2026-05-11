// KithLy Checkout - Multi-Vendor Gift Purchase Flow

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, CreditCard, Smartphone, Gift, Check, QrCode } from 'lucide-react';
import { useCart } from '../hooks/useCart';
import { useAuth } from '../hooks/useAuth';
import { formatZMW } from '../utils/formatters';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { QRCodeDisplay } from '../components/shared/QRCodeDisplay';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';

export function Checkout() {
  const navigate = useNavigate();
  const { items, getItemsByShop, getTotalAmount, clearCart } = useCart();
  const { isAuthenticated, profile } = useAuth();
  const [step, setStep] = useState<'cart' | 'personalize' | 'payment' | 'success'>('cart');
  const [handshakeCodes, setHandshakeCodes] = useState<string[]>([]);

  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [senderName, setSenderName] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [giftMessage, setGiftMessage] = useState('');

  const itemsByShop = getItemsByShop();
  const total = getTotalAmount();

  const generateHandshake = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'KL-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handlePayment = async () => {
    setStep('payment');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const codes = Array.from(itemsByShop.keys()).map(() => generateHandshake());
    setHandshakeCodes(codes);
    setStep('success');
    clearCart();
    toast.success('Gift purchase complete!');
  };

  if (!isAuthenticated) {
    navigate('/auth');
    return null;
  }

  if (items.length === 0 && step !== 'success') {
    navigate('/');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8 max-w-4xl">
        <AnimatePresence mode="wait">
          {step === 'cart' && (
            <motion.div
              key="cart"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 text-sm font-light text-muted-foreground hover:text-black mb-6"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
                Back
              </button>

              <h1 className="text-3xl font-light text-black mb-8">Checkout</h1>

              <div className="space-y-6">
                {Array.from(itemsByShop.entries()).map(([shopId, shopItems], idx) => {
                  const shop = shopItems[0].product.shop;
                  const shopTotal = shopItems.reduce((sum, item) => sum + item.product.price_zmw * item.quantity, 0);

                  return (
                    <div key={shopId} className="bg-white rounded-[1.5rem] p-6 border border-border">
                      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                          <Gift className="w-5 h-5 text-white" strokeWidth={1.5} />
                        </div>
                        <div>
                          <h3 className="font-light text-black">{shop?.name}</h3>
                          <p className="text-xs font-light text-muted-foreground">
                            {shop?.district?.name}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {shopItems.map((item) => (
                          <div key={item.product.id} className="flex gap-3">
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100">
                              <ImageWithFallback
                                src={item.product.images[0]}
                                alt={item.product.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-light text-sm text-black line-clamp-1">
                                {item.product.title}
                              </h4>
                              <p className="text-xs font-light text-muted-foreground">
                                Qty: {item.quantity}
                              </p>
                              <p className="text-sm font-medium text-[#F97316] mt-1">
                                {formatZMW(item.product.price_zmw * item.quantity)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
                        <span className="font-light text-muted-foreground">Shop Total</span>
                        <span className="font-medium text-black">{formatZMW(shopTotal)}</span>
                      </div>
                    </div>
                  );
                })}

                <div className="bg-white rounded-[1.5rem] p-6 border border-border">
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="font-light text-muted-foreground">Subtotal</span>
                      <span className="font-light">{formatZMW(total)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-light text-muted-foreground">Service Fee</span>
                      <span className="font-light">{formatZMW(0)}</span>
                    </div>
                    <div className="flex justify-between pt-3 border-t border-border">
                      <span className="font-medium text-black">Total</span>
                      <span className="text-xl font-medium bg-gradient-to-r from-[#F97316] to-[#FB923C] bg-clip-text text-transparent">
                        {formatZMW(total)}
                      </span>
                    </div>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setStep('personalize')}
                    className="w-full mt-6 py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                  >
                    Continue
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'personalize' && (
            <motion.div
              key="personalize"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <button
                onClick={() => setStep('cart')}
                className="flex items-center gap-2 text-sm font-light text-muted-foreground hover:text-black mb-6"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
                Back
              </button>

              <h1 className="text-3xl font-light text-black mb-8">Personalize Your Gift</h1>

              <div className="bg-white rounded-[1.5rem] p-6 border border-border space-y-6">
                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Recipient Name</label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. Mwape Banda"
                    className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                  />
                </div>

                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Recipient Phone</label>
                  <input
                    type="tel"
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    placeholder="+260 977 123 456"
                    className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="anonymous"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="anonymous" className="text-sm font-light text-muted-foreground">Send anonymously</label>
                </div>

                {!isAnonymous && (
                  <div>
                    <label className="text-sm font-light text-muted-foreground mb-2 block">Your Name (Sender)</label>
                    <input
                      type="text"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="Your name"
                      className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Gift Message (Optional)</label>
                  <textarea
                    value={giftMessage}
                    onChange={(e) => setGiftMessage(e.target.value)}
                    placeholder="Write a personal message..."
                    rows={4}
                    className="w-full px-4 py-3 border border-border rounded-2xl font-light focus:outline-none focus:border-[#F97316] resize-none"
                  />
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('payment')}
                  className="w-full py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                >
                  Proceed to Payment
                </motion.button>
              </div>
            </motion.div>
          )}

          {step === 'payment' && (
            <motion.div
              key="payment"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <h1 className="text-3xl font-light text-black mb-8">Payment</h1>

              <div className="bg-white rounded-[1.5rem] p-6 border border-border mb-6">
                <Tabs defaultValue="momo" className="space-y-6">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="momo" className="font-light gap-2">
                      <Smartphone className="w-4 h-4" strokeWidth={1.5} />
                      Mobile Money
                    </TabsTrigger>
                    <TabsTrigger value="card" className="font-light gap-2">
                      <CreditCard className="w-4 h-4" strokeWidth={1.5} />
                      Card
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="momo" className="space-y-4">
                    <div>
                      <label className="text-sm font-light text-muted-foreground">Mobile Number</label>
                      <input
                        type="tel"
                        placeholder="+260 977 123 456"
                        defaultValue={profile?.momo_number}
                        className="w-full mt-2 px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                      />
                    </div>
                    <p className="text-xs font-light text-muted-foreground">
                      A prompt will be sent to your phone to approve the payment
                    </p>
                  </TabsContent>

                  <TabsContent value="card" className="space-y-4">
                    <p className="text-sm font-light text-muted-foreground">
                      Card payments coming soon
                    </p>
                  </TabsContent>
                </Tabs>

                <div className="mt-6 p-4 bg-gray-50 rounded-xl">
                  <div className="flex justify-between mb-2">
                    <span className="font-light text-muted-foreground">Total</span>
                    <span className="font-medium text-black">{formatZMW(total)}</span>
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePayment}
                  className="w-full mt-6 py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                >
                  Confirm Payment
                </motion.button>
              </div>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="text-center mb-8">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring' }}
                  className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center"
                >
                  <Check className="w-10 h-10 text-white" strokeWidth={2} />
                </motion.div>
                <h1 className="text-3xl font-light text-black mb-2">Purchase Complete!</h1>
                <p className="text-sm font-light text-muted-foreground">
                  Your gifts have been secured with handshake codes
                </p>
              </div>

              <div className="space-y-4 mb-8">
                {handshakeCodes.map((code, idx) => (
                  <motion.div
                    key={code}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + idx * 0.1 }}
                    className="bg-white rounded-[1.5rem] p-6 border border-border"
                  >
                    <div className="text-center space-y-4">
                      <p className="text-xs font-light text-muted-foreground">
                        Handshake Code
                      </p>
                      <p className="text-3xl font-mono font-medium bg-gradient-to-r from-[#F97316] to-[#FB923C] bg-clip-text text-transparent">
                        {code}
                      </p>
                      <div className="pt-4">
                        <QRCodeDisplay value={code} size={180} />
                      </div>
                      <Badge className="font-light">Ready for redemption</Badge>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="space-y-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate('/dashboard')}
                  className="w-full py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                >
                  View in Gift Vault
                </motion.button>
                <button
                  onClick={() => navigate('/')}
                  className="w-full py-4 border-2 border-border rounded-full font-light hover:bg-gray-50 transition-colors"
                >
                  Continue Shopping
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
