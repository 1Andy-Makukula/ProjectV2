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
import { useCart, lineKeyOf, cartLineUnitPrice } from '../../hooks/useCart';
import { describeSelection } from '../../types/itemOptions';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { Switch } from '../ui/switch';
import { Vector } from './Vector';
import { formatCurrency } from '../../../utils/currency';
import { nextTier } from '../../types/items';
import { usePlatformPricing } from '../../hooks/usePlatformPricing';
import { useEscrowMode } from '../../hooks/useEscrowMode';
import { creditsApplicationFor, feePercentFor, serviceFeeFor, CHECKOUT_ORIGIN } from '../../../utils/pricing';
import { CompensationDisclosure } from '../checkout/CompensationDisclosure';
import { CartReviewDialog } from './CartReviewDialog';

/** A 44px touch target on phones, drawn as an invisible pseudo-element so the
 *  control keeps its 22px visual size. Desktop does not need it and pointer
 *  users would only get an overlapping hit box, so it is md:hidden. */
const HIT =
  "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 " +
  "before:-translate-y-1/2 before:content-[''] md:before:hidden";

export function CartSlider() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const { rates } = usePlatformPricing();
  const { storedValueRetired } = useEscrowMode();

  const fetchWalletBalance = async () => {
    if (!user?.id) return;
    // Under escrow_v2 there is no spendable balance to fetch. Leaving this at
    // zero removes the entire credits affordance below, which is gated on
    // `walletBalance > 0` -- one guard rather than a second rendering path
    // that could drift out of step with the server's refusal.
    if (storedValueRetired) {
      setWalletBalance(0);
      return;
    }
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
  }, [isCartSliderOpen, user?.id, storedValueRetired]);

  const total = getTotalAmount();
  const count = getTotalItems();

  const serviceFee = serviceFeeFor(total, CHECKOUT_ORIGIN, rates);
  const { creditsToApply, finalPayable } = creditsApplicationFor(
    total,
    CHECKOUT_ORIGIN,
    rates,
    walletBalance,
    applyCredits,
  );

  function handleCheckout() {
    setCartSliderOpen(false);
    navigate('/checkout');
  }

  // Group items by shop
  const groupedItems = items.reduce((acc, item) => {
    const shopId = item.product.shop_id;
    if (!acc[shopId]) {
      acc[shopId] = {
        shopName: item.product.shop?.business_name || 'KithLy Merchant',
        items: [],
        subtotal: 0,
      };
    }
    acc[shopId].items.push(item);
    acc[shopId].subtotal += cartLineUnitPrice(item) * item.quantity;
    return acc;
  }, {} as Record<string, { shopName: string; items: typeof items; subtotal: number }>);

  return (
    <Sheet open={isCartSliderOpen && (!profile || profile.role === 'sender')} onOpenChange={setCartSliderOpen}>
      <SheetContent
        side="right"
        className="flex flex-col w-full sm:max-w-md bg-white/80 backdrop-blur-xl border-l border-white/30 p-0 gap-0"
      >
        {/* ── Header ────────────────────────────── */}
        {/* Shallow on purpose. Every pixel here is a pixel the item list does
            not get, and the list is the part somebody actually came to read.
            pt-5/pb-4 plus a 32px glyph was ~69px of chrome to say "Your Cart"
            above a panel that is obviously a cart. */}
        <SheetHeader className="shrink-0 px-5 pt-3 pb-2.5 border-b border-ink-100/80">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50">
              <ShoppingCart className="h-3.5 w-3.5 text-brand-500" strokeWidth={1.75} />
            </div>
            <SheetTitle className="flex-1 text-sm font-semibold tracking-tight text-ink-900">
              Your Cart
              {count > 0 && (
                <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-600">
                  {count} item{count !== 1 ? 's' : ''}
                </span>
              )}
            </SheetTitle>

            {/* The way out of a 400px column. Lives in the header rather than
                the footer because the footer is the thing being protected --
                and because somebody with forty items wants this before they
                start scrolling, not after. */}
            {count > 3 && (
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="shrink-0 rounded-[var(--radius-pill)] px-2 py-1 text-xs font-semibold text-primary
                           transition-colors hover:bg-primary-tint
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                See all
              </button>
            )}
            <SheetDescription className="sr-only">
              View and manage the items in your shopping cart.
            </SheetDescription>
          </div>
        </SheetHeader>

        {/* ── Body ──────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 space-y-2.5">
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
                {/* The bag is the shopper's own surface, so it gets the
                    shopper character and its tag. Not an apology: "nothing
                    here yet" is a state, and the line under it says what to
                    do about it. The button still only closes the slider. */}
                <Vector name="shopper" size="L" tag="Nothing here yet" tone="ink" />
                <p className="mt-4 text-xs text-muted-foreground">
                  Browse shops to find the perfect gift.
                </p>
                <button
                  onClick={() => setCartSliderOpen(false)}
                  className="mt-5 rounded-[var(--radius-pill)] bg-surface-paper px-5 py-2 text-xs font-semibold
                             text-foreground transition-colors hover:bg-secondary
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                      <Store className="h-4 w-4 text-ink-400" />
                      <span className="text-sm font-semibold text-ink-800">{group.shopName}</span>
                    </div>
                    <span className="text-sm font-medium text-ink-600">
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
                        className="flex items-center gap-3 rounded-[var(--radius-lg)] bg-surface-paper p-3"
                      >
                        {/* Thumbnail */}
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-100">
                          {(item.product.image_url || item.product.images?.[0]) ? (
                            <img
                              src={item.product.image_url || item.product.images[0]}
                              alt={item.product.name || item.product.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <ShoppingBag className="h-5 w-5 text-ink-300" />
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground">{item.product.name || item.product.title}</p>
                          {(() => {
                            // Includes any chosen options, so the line agrees
                            // with the total and with what checkout charges.
                            const unit = cartLineUnitPrice(item);
                            const extras = describeSelection(
                              item.product.option_groups,
                              item.selection ?? {},
                            );
                            const upcoming = nextTier(item.product.price_tiers, item.quantity);
                            return (
                              <>
                                {extras && (
                                  <p className="truncate text-[10px] text-muted-foreground">{extras}</p>
                                )}
                                <p className="kl-money text-[11px] text-muted-foreground">
                                  {formatCurrency(unit, 'ZMW')}
                                  {unit < item.product.price_zmw && (
                                    <span className="ml-1 text-[10px] line-through">
                                      {formatCurrency(item.product.price_zmw, 'ZMW')}
                                    </span>
                                  )}
                                </p>
                                {upcoming && (
                                  /* #C93A08 and 700: this is the only place a
                                     shopper is ever told a wholesale tier
                                     exists, and in brand-600 at 500 weight it
                                     was the quietest line on the row. */
                                  <p className="text-[10px] font-bold text-accent-text">
                                    Add {upcoming.min_quantity - item.quantity} more for{' '}
                                    {formatCurrency(upcoming.unit_price_zmw, 'ZMW')} each
                                  </p>
                                )}
                              </>
                            );
                          })()}

                          {/* Qty controls */}
                          <div className="mt-1.5 flex items-center gap-2">
                            {/* 22px circles: minus on the neutral, plus on the
                                brand, because adding is the direction the shop
                                wants and subtracting is merely allowed.

                                The ::before is a 44px touch target on phones
                                only -- it keeps the control 22px to the eye
                                while satisfying the 44px floor, instead of
                                growing the row on the device with least room.
                                Both still call updateQuantity(lineKeyOf(item)),
                                the LINE key, never the product id. */}
                            <button
                              onClick={() => updateQuantity(lineKeyOf(item), item.quantity - 1)}
                              aria-label="Decrease quantity"
                              className={`relative flex size-[22px] items-center justify-center rounded-full
                                          bg-background text-foreground transition-colors hover:bg-border-dark
                                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${HIT}`}
                            >
                              <Minus className="h-3 w-3" strokeWidth={2.75} />
                            </button>
                            <span className="kl-money min-w-[16px] text-center text-xs text-foreground">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => updateQuantity(lineKeyOf(item), item.quantity + 1)}
                              aria-label="Increase quantity"
                              className={`relative flex size-[22px] items-center justify-center rounded-full
                                          bg-primary text-white transition-colors hover:bg-primary/90
                                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${HIT}`}
                            >
                              <Plus className="h-3 w-3" strokeWidth={2.75} />
                            </button>
                          </div>
                        </div>

                        {/* Line total + remove */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <p className="kl-money text-xs text-foreground">
                            {formatCurrency(cartLineUnitPrice(item) * item.quantity, 'ZMW')}
                          </p>
                          {/* Present on EVERY line. Its absence from the kit
                              specimen was an omission in the drawing, not the
                              design -- a cart you can only empty by zeroing a
                              stepper is a cart with a missing control. */}
                          <button
                            onClick={() => removeFromCart(lineKeyOf(item))}
                            className={`relative rounded-md p-1 text-muted-foreground transition-colors
                                        hover:text-destructive
                                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${HIT}`}
                            aria-label="Remove item"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.4} />
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
          <SheetFooter className="shrink-0 px-5 pt-3 border-t border-ink-100/80 flex flex-col gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
            {/* Apply KithLy Credits Section */}
            {user && walletBalance > 0 && (
              /* Gating untouched: user && walletBalance > 0, and
                  storedValueRetired forces walletBalance to zero under
                  escrow_v2. One rendering path, as it was. */
              /* One line instead of a stacked card. The gating is untouched --
                 this disappears entirely once the escrow cutover sets
                 storedValueRetired -- but until then it should cost one row,
                 not a panel. */
              <div className="flex w-full flex-col rounded-[var(--radius-lg)] bg-surface-paper px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Coins className="h-3.5 w-3.5 shrink-0 text-brass-deep" strokeWidth={2.4} />
                    <span className="text-xs font-semibold text-foreground">
                      Credits
                      <span className="kl-money ml-1.5 font-normal text-muted-foreground">
                        {formatCurrency(walletBalance, 'ZMW')}
                      </span>
                    </span>
                  </div>
                  <Switch
                    checked={applyCredits}
                    onCheckedChange={setApplyCredits}
                  />
                </div>
                {applyCredits && (
                  <div className="mt-1 flex items-center justify-between border-t border-border px-1 pt-1.5 text-xs font-bold text-accent-text">
                    <span>Credits Applied</span>
                    <span className="kl-money">-{formatCurrency(creditsToApply, 'ZMW')}</span>
                  </div>
                )}
              </div>
            )}

            {/* Order summary */}
            <div className="w-full flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-muted-foreground">Subtotal</span>
                <span className="kl-money text-foreground">
                  {formatCurrency(total, 'ZMW')}
                </span>
              </div>

              {serviceFee > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-muted-foreground">
                    Service fee
                    {/* The percentage stays. A fee whose rate is hidden is
                        a fee somebody has to work out. */}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({feePercentFor(CHECKOUT_ORIGIN, rates)}%)
                    </span>
                  </span>
                  <span className="kl-money text-foreground">
                    {formatCurrency(serviceFee, 'ZMW')}
                  </span>
                </div>
              )}

              {applyCredits && creditsToApply > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-muted-foreground">Credits applied</span>
                  <span className="kl-money text-accent-text">
                    -{formatCurrency(creditsToApply, 'ZMW')}
                  </span>
                </div>
              )}

              {/* The total in an ink block. The four lines above it stay
                  itemised and separate -- fees are never rolled into one
                  number -- and this is the one the eye should land on. */}
              <div className="mt-1.5 flex items-center justify-between rounded-[var(--radius-lg)] bg-ink px-3.5 py-2">
                <span className="text-sm font-semibold text-on-ink">Total payable</span>
                <span className="kl-money text-[1.4375rem] leading-none text-on-ink">
                  {formatCurrency(finalPayable, 'ZMW')}
                </span>
              </div>
            </div>

            {/* What happens if the gift is never collected.
                
                Placed above the CTA and never behind a link: §7 of the
                settlement model makes this disclosure mandatory BEFORE
                payment, because the old behaviour -- splitting an expired
                gift and telling the sender afterwards -- is what it exists
                to replace. */}
            <CompensationDisclosure items={items} className="mt-1.5" />

            {/* CTA */}
            {/* "Hold it in escrow", not "Checkout". The word is the product's
                only real differentiator and this is the moment it means
                something. It still navigates to /checkout and still closes
                the slider first -- only the label and the skin changed. */}
            <button
              onClick={handleCheckout}
              className="mt-1.5 w-full rounded-[var(--radius-pill)] bg-primary py-3 text-sm font-semibold
                         text-white transition-colors hover:bg-primary/92 active:scale-[0.98]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Hold it in escrow →
            </button>

            {/* Said out loud, because the point of the review is that nobody
                pays while still unsure what they are paying for. */}
            {count > 3 && (
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="w-full pt-0.5 text-center text-[0.6875rem] font-light text-muted-foreground
                           underline-offset-2 hover:underline
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                See all {count} items clearly before you pay
              </button>
            )}
          </SheetFooter>
        )}
      </SheetContent>

      {/* On top of the sheet, not instead of it: closing this returns you to
          the basket exactly as you left it. */}
      <CartReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        groups={Object.values(groupedItems)}
        count={count}
        total={total}
      />
    </Sheet>
  );
}
