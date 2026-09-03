// ItemDetail — the considered view for anything that cannot go straight into
// the cart: booked services, custom-quote work, and discounted or wholesale
// listings whose terms need stating before the buyer commits.

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  CalendarClock,
  ConciergeBell,
  Layers,
  ListChecks,
  MapPin,
  MessageSquare,
  Package,
  Shield,
  ShoppingCart,
  Store,
  Timer,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart, toProduct } from '../../hooks/useCart';
import { useItemDetail } from '../../hooks/useItemDetail';
import { supabase } from '../../../lib/supabaseClient';
import { parseAuthError } from '../../../utils/errorParser';
import { toast } from 'sonner';
import {
  FULFILLMENT_LOCATION_LABELS,
  discountPercentage,
  expiryBasis,
  isService,
  isOutOfStock,
  requiresConversation,
  servicePriceLabel,
  sortedTiers,
  galleryUrls as itemGalleryUrls,
  OUT_OF_STOCK_REASON,
} from '../../types/items';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '../../components/ui/carousel';
import { AddToListDialog } from '../../components/shared/AddToListDialog';
import { ItemOptionPicker } from '../../components/shared/ItemOptionPicker';
import {
  initialSelection,
  selectionDelta,
  selectionProblem,
  sortedGroups,
  type OptionSelection,
} from '../../types/itemOptions';

function formatZmw(ngwee: number | null | undefined): string {
  return ngwee != null ? (ngwee / 100).toFixed(2) : '—';
}

/** A labelled row inside the terms panel. */
function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarClock;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-slate-700">{children}</p>
      </div>
    </div>
  );
}

export function ItemDetail() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { item, loading } = useItemDetail(itemId);
  const { addToCart } = useCart();
  const [startingChat, setStartingChat] = useState(false);
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [selection, setSelection] = useState<OptionSelection>({});

  // Declared above the early returns because hooks must be, and seeded once the
  // item lands: a required single-choice group starts on its first option so
  // the buyer is not blocked by something they were never shown.
  const loadedGroups = item?.item_option_groups;
  useEffect(() => {
    setSelection(initialSelection(loadedGroups));
  }, [itemId, loadedGroups]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <Package className="mx-auto mb-4 h-10 w-10 text-slate-300" strokeWidth={1} />
          <h2 className="mb-2 text-2xl font-medium">Item not found</h2>
          <p className="mb-6 text-muted-foreground">
            This listing is no longer available, or the link has expired.
          </p>
          <Button onClick={() => navigate('/')}>Back to storefront</Button>
        </div>
      </div>
    );
  }

  const service = isService(item);
  const mustOpenDetail = requiresConversation(item);
  const discount = discountPercentage(item);
  const basis = expiryBasis(item);
  const priceLabel = servicePriceLabel(item);
  const galleryUrls = itemGalleryUrls(item);
  const outOfStock = isOutOfStock(item);
  const optionGroups = sortedGroups(item.item_option_groups);
  const optionsDelta = selectionDelta(optionGroups, selection);
  const tiers = sortedTiers(item.item_price_tiers);

  const handleGift = () => navigate(profile ? `/send/${item.id}` : '/signup');

  /** Opens (or rejoins) the thread with this shop about this item. */
  const handleAskForQuote = async () => {
    if (!profile) {
      navigate('/signup');
      return;
    }
    if (!item.shop?.id) return;

    setStartingChat(true);
    try {
      const { data, error } = await supabase.rpc('start_conversation', {
        p_shop_id: item.shop.id,
        p_item_id: item.id,
        p_subject: item.name,
      });
      if (error) throw error;
      navigate(`/messages?c=${data}`);
    } catch (err: any) {
      toast.error(parseAuthError(err));
    } finally {
      setStartingChat(false);
    }
  };

  const handleAddToCart = (quantity = 1) => {
    if (!profile) {
      navigate('/signup');
      return;
    }
    const problem = selectionProblem(optionGroups, selection);
    if (problem) {
      toast.error(problem);
      return;
    }

    addToCart(toProduct({ ...item, shop_id: item.shop?.id ?? '' }), quantity, selection);
    toast.success(
      quantity > 1
        ? `${quantity} × ${item.name} added to cart`
        : `${item.name} added to cart`,
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4 md:px-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">{service ? 'Service' : 'Product'} Details</h1>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8"
        >
          {/* ── Image ─────────────────────────────────────────────── */}
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {galleryUrls.length > 1 ? (
              // More than one photograph, so it becomes swipeable. A single
              // image stays a plain <img> — no controls, no embla instance.
              <Carousel className="h-full w-full" opts={{ loop: true }}>
                <CarouselContent className="ml-0 h-full">
                  {galleryUrls.map((url, index) => (
                    <CarouselItem key={url} className="pl-0">
                      <img
                        src={url}
                        alt={`${item.name} — image ${index + 1} of ${galleryUrls.length}`}
                        className="aspect-square h-full w-full object-cover"
                      />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="left-3" />
                <CarouselNext className="right-3" />
                <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                  {galleryUrls.length} photos
                </div>
              </Carousel>
            ) : item.image_url ? (
              <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100">
                {service ? (
                  <ConciergeBell className="h-14 w-14 text-slate-200" strokeWidth={1} />
                ) : (
                  <Package className="h-14 w-14 text-slate-200" strokeWidth={1} />
                )}
              </div>
            )}

            {service && (
              <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full border border-slate-100 bg-white/90 px-2.5 py-1 shadow-sm backdrop-blur-sm">
                <ConciergeBell className="h-3 w-3 text-slate-500" strokeWidth={2} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  Service
                </span>
              </div>
            )}

            {discount !== null && (
              <div className="absolute right-3 top-3 rounded-full bg-orange-600 px-2.5 py-1 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wide text-white">
                  {discount}% off
                </span>
              </div>
            )}
          </div>

          {/* ── Summary ───────────────────────────────────────────── */}
          <div className="flex flex-col">
            {item.shop?.name && (
              <button
                onClick={() => item.shop?.id && navigate(`/shop/${item.shop.id}`)}
                className="mb-2 flex items-center gap-1.5 self-start text-[11px] font-semibold uppercase tracking-widest text-slate-400 transition-colors hover:text-slate-700"
              >
                <Store className="h-3 w-3" strokeWidth={2} />
                {item.shop.name}
              </button>
            )}

            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{item.name}</h2>

            {item.description && (
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{item.description}</p>
            )}

            {/* Price */}
            <div className="mt-5 flex items-baseline gap-3">
              {priceLabel.prefix && (
                <span className="text-sm font-medium uppercase tracking-wide text-slate-400">
                  {priceLabel.prefix}
                </span>
              )}
              <span className="text-3xl font-light tracking-tight text-slate-900">
                ZMW {formatZmw(item.price_zmw)}
              </span>
              {discount !== null && (
                <span className="text-sm text-slate-400 line-through">
                  ZMW {formatZmw(item.original_price_zmw)}
                </span>
              )}
            </div>
            {optionsDelta > 0 && (
              <p className="mt-1.5 text-sm font-medium text-slate-700">
                With your choices: ZMW {formatZmw(item.price_zmw + optionsDelta)}
              </p>
            )}

            {!outOfStock && optionGroups.length > 0 && (
              <ItemOptionPicker
                groups={optionGroups}
                selection={selection}
                onChange={setSelection}
              />
            )}

            {priceLabel.note && (
              <p className="mt-1.5 text-xs font-light text-slate-500">{priceLabel.note}</p>
            )}

            {/* Quantity breaks. Unlike the wholesale panel this replaces, these
                are genuinely charged: checkout_init_atomic recomputes the same
                break server-side from the total quantity of the item. */}
            {tiers.length > 0 && (
              <div className="mt-3 space-y-1.5 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-orange-500" strokeWidth={2} />
                  Buy more, pay less
                </p>
                {tiers.map((tier) => (
                  <div
                    key={tier.min_quantity}
                    className="flex items-center justify-between gap-4 text-xs"
                  >
                    <span className="text-slate-600">{tier.min_quantity} or more</span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-semibold text-slate-900">
                        ZMW {formatZmw(tier.unit_price_zmw)}
                      </span>
                      <span className="text-slate-400">each</span>
                      <button
                        onClick={() => handleAddToCart(tier.min_quantity)}
                        className="rounded-md border border-orange-200 px-2 py-0.5 text-[11px] font-semibold text-orange-600 transition-colors hover:bg-orange-50"
                      >
                        Add {tier.min_quantity}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Escrow reassurance */}
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
              <Shield className="h-3.5 w-3.5 shrink-0 text-orange-500" strokeWidth={2} />
              Held in escrow until the recipient confirms collection.
            </div>

            {/* ── CTAs ────────────────────────────────────────────── */}
            {outOfStock ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-medium text-slate-700">{OUT_OF_STOCK_REASON}</p>
                <p className="mt-0.5 text-xs font-light text-slate-500">
                  The shop has been told to restock. This listing stays here so you can come
                  back for it.
                </p>
              </div>
            ) : (
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              {/* Quote-first work has no settled price yet, so the conversation
                  is the primary action rather than a purchase. */}
              {item.allow_custom_quote ? (
                item.price_is_minimum ? (
                  // The listed figure is a real, bookable price — someone who
                  // just wants the standard job should not have to open a
                  // conversation to get it.
                  <>
                    <Button onClick={handleGift} className="w-full sm:flex-1">
                      {item.requires_scheduling ? 'Book at' : 'Buy at'} ZMW{' '}
                      {formatZmw(item.price_zmw)}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleAskForQuote}
                      disabled={startingChat}
                      className="flex w-full items-center justify-center gap-2 sm:flex-1"
                    >
                      <MessageSquare className="h-4 w-4" />
                      {startingChat ? 'Opening…' : 'Talk to the shop about a custom order'}
                    </Button>
                  </>
                ) : (
                  // No minimum declared, so the price is indicative only and
                  // the conversation stays the primary action.
                  <>
                    <Button
                      onClick={handleAskForQuote}
                      disabled={startingChat}
                      className="flex w-full items-center justify-center gap-2 sm:flex-1"
                    >
                      <MessageSquare className="h-4 w-4" />
                      {startingChat ? 'Opening…' : 'Talk to the shop about a custom order'}
                    </Button>
                    <Button variant="outline" onClick={handleGift} className="w-full sm:flex-1">
                      {item.requires_scheduling ? 'Book at listed price' : 'Buy at listed price'}
                    </Button>
                  </>
                )
              ) : (
                <>
                  <Button onClick={handleGift} className="w-full sm:flex-1">
                    {item.requires_scheduling ? 'Book this' : 'Gift this'}
                  </Button>

                  {!mustOpenDetail && (
                    <Button
                      variant="outline"
                      onClick={() => handleAddToCart()}
                      className="flex w-full items-center justify-center gap-2 sm:flex-1"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      Add to cart
                    </Button>
                  )}
                </>
              )}
            </div>
            )}

            {profile && (
              <button
                onClick={() => setAddToListOpen(true)}
                className="mt-3 flex items-center gap-1.5 self-start text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
              >
                <ListChecks className="h-3.5 w-3.5" strokeWidth={2} />
                Add to a list
              </button>
            )}

            {!item.allow_custom_quote && item.shop?.id && (
              <button
                onClick={handleAskForQuote}
                disabled={startingChat}
                className="mt-3 flex items-center gap-1.5 self-start text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 disabled:opacity-50"
              >
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
                Message the shop about this
              </button>
            )}

            {item.requires_scheduling && (
              <p className="mt-3 text-xs font-light leading-relaxed text-slate-500">
                You pay now and the date is agreed with the shop. Your money stays in escrow
                until the work is done.
              </p>
            )}
          </div>
        </motion.div>

        {/* ── Terms panel ─────────────────────────────────────────── */}
        <div className="mt-8 rounded-2xl border border-slate-100 bg-white p-5 sm:p-6">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            What to expect
          </h3>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {item.requires_scheduling && (
              <DetailRow icon={CalendarClock} label="Scheduling">
                {item.lead_time_days
                  ? `Book at least ${item.lead_time_days} day${item.lead_time_days === 1 ? '' : 's'} in advance.`
                  : 'The date is arranged directly with the shop.'}
              </DetailRow>
            )}

            {item.fulfillment_location && (
              <DetailRow icon={MapPin} label="Where">
                {FULFILLMENT_LOCATION_LABELS[item.fulfillment_location]}
                {item.shop?.location ? ` — ${item.shop.location}` : ''}
              </DetailRow>
            )}

            <DetailRow icon={Timer} label="Validity">
              {basis === 'none' && 'No expiry — claim it whenever suits.'}
              {basis === 'purchase_date' &&
                (item.valid_for_days
                  ? `Valid for ${item.valid_for_days} days from purchase.`
                  : 'Standard validity period applies from purchase.')}
              {basis === 'execution_date' &&
                (item.valid_for_days
                  ? `Valid for ${item.valid_for_days} days around the agreed date.`
                  : 'Stays valid through to the agreed date.')}
            </DetailRow>

            {item.allow_custom_quote && (
              <DetailRow icon={MessageSquare} label="Custom work">
                {item.price_is_minimum
                  ? 'The listed price is this shop’s minimum for this service. Talk to them to price a larger or more tailored job.'
                  : 'This shop takes custom requests. Talk to them about a custom order instead of buying at the listed price.'}
              </DetailRow>
            )}
          </div>
        </div>
      </div>

      {profile && (
        <AddToListDialog
          open={addToListOpen}
          onOpenChange={setAddToListOpen}
          target={{ kind: 'item', id: item.id, name: item.name, image_url: item.image_url }}
        />
      )}
    </div>
  );
}
