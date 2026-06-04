// CartSlider — Animated sliding cart panel
// Globally mounted in Root.tsx. State driven by useCart Zustand store.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, Trash2, Plus, Minus, ShoppingBag, Store, Coins } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '../ui/sheet';
import { useCart } from '../../hooks/useCart';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { Switch } from '../ui/switch';
import { formatCurrency } from '../../../utils/currency';

export function CartSlider() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    items,
    isCartSliderOpen,
    setCartSliderOpen,
    removeFromCart,
    updateQuantity,
    getTotalAmount,
    getTotalItems,
    applyCredits,
    setApplyCredits,
  } = useCart();

  const [walletBalance, setWalletBalance] = useState<number>(0);

  const fetchWalletBalance = async () => {
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
      console.error('[CartSlider] Error fetching wallet balance:', err);
    }
  };

  useEffect(() => {
    if (isCartSliderOpen && user?.id) {
      fetchWalletBalance();
    }
  }, [isCartSliderOpen, user?.id]);

  const total = getTotalAmount();
  const count = getTotalItems();
  
  const creditsToApply = applyCredits ? Math.min(walletBalance, total) : 0;
  const finalPayable = total - creditsToApply;

  function handleCheckout() {
    setCartSliderOpen(false);
    navigate('/checkout');
  }

  // Group items by shop
  const groupedItems = items.reduce((acc, item) => {
    const shopId = item.product.shop_id;
    if (!acc[shopId]) {
      acc[shopId] = {
        shopName: item.product.shop?.name || item.product.shop?.business_name || 'KithLy Merchant',
        items: [],
        subtotal: 0,
      };
    }
    acc[shopId].items.push(item);
    acc[shopId].subtotal += item.product.price_zmw * item.quantity;
    return acc;
  }, {} as Record<string, { shopName: string; items: typeof items; subtotal: number }>);

  return (
    <Sheet open={isCartSliderOpen} onOpenChange={setCartSliderOpen}>
      <SheetContent
        side="right"
        className="flex flex-col w-full sm:max-w-md bg-white/80 backdrop-blur-xl border-l border-white/30 p-0 gap-0"
      >
        {/* ── Header ────────────────────────────── */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-slate-100/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50">
              <ShoppingCart className="h-4 w-4 text-orange-500" strokeWidth={1.75} />
            </div>
            <SheetTitle className="text-base font-semibold tracking-tight text-slate-900">
              Your Cart
              {count > 0 && (
                <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-600">
                  {count} item{count !== 1 ? 's' : ''}
                </span>
              )}
            </SheetTitle>
            <SheetDescription className="sr-only">
              View and manage the items in your shopping cart.
            </SheetDescription>
          </div>
        </SheetHeader>

        {/* ── Body ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <AnimatePresence initial={false}>
            {items.length === 0 ? (
              /* Empty state */
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full min-h-[300px] text-center"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 mb-4">
                  <ShoppingBag className="h-8 w-8 text-orange-400" strokeWidth={1.25} />
                </div>
                <p className="text-sm font-medium text-slate-700">Your cart is empty</p>
                <p className="mt-1 text-xs text-slate-400">Browse shops to find the perfect gift.</p>
                <button
                  onClick={() => setCartSliderOpen(false)}
                  className="mt-5 rounded-full border border-orange-200 bg-orange-50 px-5 py-2 text-xs font-semibold text-orange-600 hover:bg-orange-100 transition-colors"
                >
                  Browse Shops
                </button>
              </motion.div>
            ) : (
              Object.entries(groupedItems).map(([shopId, group]) => (
                <div key={shopId} className="mb-6 last:mb-0">
                  {/* Shop Header */}
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4 text-slate-400" />
                      <span className="text-sm font-semibold text-slate-800">{group.shopName}</span>
                    </div>
                    <span className="text-sm font-medium text-slate-600">
                      {formatCurrency(group.subtotal, 'ZMW')}
                    </span>
                  </div>

                  {/* Shop Items */}
                  <div className="space-y-3">
                    {group.items.map((item, i) => (
                      <motion.div
                        key={item.product.id}
                        layout
                        initial={{ opacity: 0, x: 30 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 30, transition: { duration: 0.18 } }}
                        transition={{
                          type: 'spring',
                          stiffness: 340,
                          damping: 26,
                          delay: i * 0.06,
                        }}
                        className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm"
                      >
                        {/* Thumbnail */}
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                          {(item.product.image_url || item.product.images?.[0]) ? (
                            <img
                              src={item.product.image_url || item.product.images[0]}
                              alt={item.product.name || item.product.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <ShoppingBag className="h-5 w-5 text-slate-300" />
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{item.product.name || item.product.title}</p>
                          <p className="text-xs text-slate-400">{formatCurrency(item.product.price_zmw, 'ZMW')}</p>

                          {/* Qty controls */}
                          <div className="mt-1.5 flex items-center gap-2">
                            <button
                              onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                              className="flex h-5 w-5 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-orange-300 hover:text-orange-500 transition-colors"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="min-w-[16px] text-center text-xs font-semibold text-slate-700">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                              className="flex h-5 w-5 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-orange-300 hover:text-orange-500 transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        {/* Line total + remove */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <p className="text-sm font-semibold text-slate-900">
                            {formatCurrency(item.product.price_zmw * item.quantity, 'ZMW')}
                          </p>
                          <button
                            onClick={() => removeFromCart(item.product.id)}
                            className="rounded-md p-1 text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors"
                            aria-label="Remove item"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </AnimatePresence>
        </div>

        {/* ── Footer ────────────────────────────── */}
        {items.length > 0 && (
          <SheetFooter className="px-5 py-4 border-t border-slate-100/80 flex flex-col gap-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
            {/* Apply KithLy Credits Section */}
            {user && walletBalance > 0 && (
              <div className="w-full flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100/80 mb-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-orange-500" />
                    <div className="flex flex-col text-left">
                      <span className="text-xs font-semibold text-slate-800">Apply KithLy Credits</span>
                      <span className="text-[10px] text-slate-400">Available: {formatCurrency(walletBalance, 'ZMW')}</span>
                    </div>
                  </div>
                  <Switch
                    checked={applyCredits}
                    onCheckedChange={setApplyCredits}
                  />
                </div>
                {applyCredits && (
                  <div className="flex items-center justify-between text-xs text-orange-600 font-semibold px-1 mt-1 border-t border-slate-200/50 pt-1.5">
                    <span>Credits Applied</span>
                    <span>-{formatCurrency(creditsToApply, 'ZMW')}</span>
                  </div>
                )}
              </div>
            )}

            {/* Order summary */}
            <div className="w-full flex flex-col gap-1.5 pt-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500 font-medium">Subtotal</span>
                <span className="text-slate-800 font-semibold">
                  {formatCurrency(total, 'ZMW')}
                </span>
              </div>
              
              {applyCredits && creditsToApply > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 font-medium">Credits applied</span>
                  <span className="text-orange-600 font-semibold">
                    -{formatCurrency(creditsToApply, 'ZMW')}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-100/80 mt-1">
                <span className="text-slate-800 font-bold">Total payable</span>
                <span className="text-lg font-bold bg-gradient-to-r from-[#F97316] to-[#1E3A8A] bg-clip-text text-transparent">
                  {formatCurrency(finalPayable, 'ZMW')}
                </span>
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={handleCheckout}
              className="w-full rounded-xl bg-gradient-to-r from-[#F97316] to-[#1E3A8A] py-3.5 text-sm font-semibold text-white shadow-md hover:opacity-90 active:scale-[0.98] transition-all mt-2"
            >
              Proceed to Checkout
            </button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
