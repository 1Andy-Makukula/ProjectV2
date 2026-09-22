// A closer look at one item, without leaving the page.
//
// The rail's tiles are small on purpose — they are a glance, not a catalogue —
// which left nowhere to read what something actually is. Navigating away to the
// item page for that costs the browse you were in the middle of, so this is the
// middle step: tap a tile, read the thing, add it or go deeper.
//
// It reads live rather than trusting whatever the rail was given. The rail's
// copy came from the storefront's one cached fetch and may be minutes old; a
// price somebody is about to act on should not be.

import { create } from 'zustand';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, ChevronLeft, ChevronRight, LayoutGrid, Package, ShoppingCart, Store } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { supabase } from '../../../lib/supabaseClient';
import { useCart, toProduct } from '../../hooks/useCart';
import { useAuth } from '../../../utils/auth/AuthContext';
import { formatCurrency } from '../../../utils/currency';
import { hapticTap } from '../../../utils/native';
import { toast } from 'sonner';

/**
 * Which item is being looked at.
 *
 * A store rather than props because the tiles that open it are rendered deep
 * inside the rail's module registry, and threading a callback down through that
 * would mean every module knowing about a dialog none of them own.
 */
interface QuickViewState {
  itemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
}

export const useItemQuickView = create<QuickViewState>((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}));

interface QuickItem {
  id: string;
  name: string;
  description: string | null;
  price_zmw: number;
  image_url: string | null;
  item_type: string;
  is_available: boolean | null;
  is_quote_only: boolean;
  stock_quantity: number | null;
  minimum_order_quantity: number;
  lead_time_days: number | null;
  requires_scheduling: boolean;
  shop_id: string;
  shop: { id: string; name: string; location: string | null } | null;
  /** Where to send somebody who likes this and wants more of the same. */
  category: { slug: string; name: string } | null;
  images: string[];
}

/** Marks the swipe hint as seen for this browsing session. */
const SWIPE_HINT_KEY = 'kithly-gallery-hint-seen';

/** Far enough to be a swipe rather than a tap that wandered. */
const SWIPE_THRESHOLD_PX = 40;

export function ItemQuickView() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { itemId, close } = useItemQuickView();
  const [item, setItem] = useState<QuickItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  // Shown once per session, and killed by the first interaction of any kind.
  // A hint that returns every time stops being a hint and becomes furniture.
  const [showHint, setShowHint] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (!itemId) {
      setItem(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setActive(0);
    touchStartX.current = null;
    // Once per browsing session, not once per item.
    try {
      if (sessionStorage.getItem(SWIPE_HINT_KEY) !== '1') setShowHint(true);
    } catch {
      // Private windows throw on sessionStorage. Losing the hint is a far
      // better failure than an exception on the way into a product view.
      setShowHint(false);
    }

    (async () => {
      const { data, error } = await supabase
        .from('items')
        .select(
          'id, name, description, price_zmw, image_url, item_type, is_available, is_quote_only, ' +
            'stock_quantity, minimum_order_quantity, lead_time_days, requires_scheduling, shop_id, ' +
            'shop:shops(id, name, location), category:categories(slug, name), ' +
            'item_images(image_url, sort_order)',
        )
        .eq('id', itemId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setItem(null);
      } else {
        const row = data as any;
        const gallery = (row.item_images ?? [])
          .slice()
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((image: any) => image.image_url as string);

        setItem({
          ...row,
          shop: row.shop ?? null,
          category: row.category ?? null,
          // The cover is the gallery's first entry when there is one; otherwise
          // it is all we have. Deduped so a cover mirrored into the gallery does
          // not show twice.
          images: Array.from(new Set([...(row.image_url ? [row.image_url] : []), ...gallery])),
        });
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  /** Any deliberate interaction retires the hint for the rest of the session. */
  const dismissHint = useCallback(() => {
    setShowHint(false);
    try {
      sessionStorage.setItem(SWIPE_HINT_KEY, '1');
    } catch {
      // Nothing to do. The hint simply reappears next session.
    }
  }, []);

  /** Move through the gallery, wrapping, so neither end is a dead stop. */
  const step = useCallback(
    (delta: number, length: number) => {
      if (length <= 1) return;
      dismissHint();
      setActive((current) => (current + delta + length) % length);
    },
    [dismissHint],
  );

  // Arrow keys, for the half of the audience holding a keyboard rather than a
  // phone. Bound only while a gallery with something to move through is open.
  useEffect(() => {
    const length = item?.images.length ?? 0;
    if (itemId === null || length <= 1) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') step(-1, length);
      if (event.key === 'ArrowRight') step(1, length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [itemId, item?.images.length, step]);

  const outOfStock = item?.stock_quantity !== null && (item?.stock_quantity ?? 1) <= 0;
  const unavailable = !item || item.is_available === false || outOfStock || item.is_quote_only;

  const addToCart = useCallback(() => {
    if (!item) return;
    hapticTap();
    useCart.getState().addToCart(
      toProduct({
        id: item.id,
        name: item.name,
        price_zmw: item.price_zmw,
        image_url: item.images[0] ?? item.image_url,
        shop_id: item.shop_id,
      }),
      Math.max(1, item.minimum_order_quantity ?? 1),
    );
    toast.success(`${item.name} added to cart`);
    close();
  }, [item, close]);

  return (
    <Dialog open={itemId !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="aspect-[4/3] w-full rounded-[var(--radius-md)]" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : !item ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            This item is no longer available.
          </p>
        ) : (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="kl-display text-xl leading-tight">{item.name}</DialogTitle>
            </DialogHeader>

            {/* The gallery.
                Swipe on a phone, arrows on a pointer, arrow keys on a
                keyboard -- three ways through the same pictures, because a
                shop with five photographs of a thing has four more reasons
                to look and only one of them survives if you have to hunt for
                a thumbnail. */}
            <div
              className="relative touch-pan-y select-none overflow-hidden rounded-[var(--radius-md)] bg-muted"
              onTouchStart={(e) => {
                touchStartX.current = e.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(e) => {
                const start = touchStartX.current;
                touchStartX.current = null;
                if (start === null) return;
                const dx = (e.changedTouches[0]?.clientX ?? start) - start;
                // A tap wanders a few pixels; a swipe does not.
                if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
                step(dx < 0 ? 1 : -1, item.images.length);
              }}
            >
              {item.images[active] ? (
                <img
                  src={item.images[active]}
                  alt={item.name}
                  draggable={false}
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="grid aspect-[4/3] w-full place-items-center">
                  <Package className="size-10 text-muted-foreground/30" strokeWidth={1.25} />
                </div>
              )}

              {item.images.length > 1 && (
                <>
                  {/* Pointer devices only. On a touch screen these would sit
                      under the thumb that is already swiping. */}
                  <button
                    type="button"
                    onClick={() => step(-1, item.images.length)}
                    aria-label="Previous picture"
                    className="absolute left-2 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full
                               bg-ink/55 text-white backdrop-blur-sm transition-colors hover:bg-ink/75
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                               sm:grid"
                  >
                    <ChevronLeft className="size-4" strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1, item.images.length)}
                    aria-label="Next picture"
                    className="absolute right-2 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full
                               bg-ink/55 text-white backdrop-blur-sm transition-colors hover:bg-ink/75
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                               sm:grid"
                  >
                    <ChevronRight className="size-4" strokeWidth={2.5} />
                  </button>

                  {/* Where you are in the set. Cheaper to read than counting
                      thumbnails, and it survives on a narrow screen. */}
                  <span className="absolute bottom-2 right-2 rounded-[var(--radius-block)] bg-ink/70 px-1.5 py-0.5 text-[0.625rem] font-semibold text-white">
                    {active + 1}/{item.images.length}
                  </span>

                  {/* The hint. Touch only, once per session, gone the moment
                      anything is touched. Unobtrusive by construction: it sits
                      in the corner the picture is least likely to need. */}
                  {showHint && (
                    <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-[var(--radius-block)] bg-ink/70 px-2 py-1 text-[0.625rem] font-medium text-white sm:hidden">
                      <ChevronLeft className="size-3" strokeWidth={2.75} />
                      swipe for more
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Only worth showing when there is a choice to make. */}
            {item.images.length > 1 && (
              <div className="kl-scroll -mx-1 flex gap-2 overflow-x-auto px-1">
                {item.images.map((url, index) => (
                  <button
                    key={url}
                    onClick={() => { dismissHint(); setActive(index); }}
                    aria-label={`Picture ${index + 1}`}
                    aria-pressed={index === active}
                    className={`size-14 shrink-0 overflow-hidden rounded-[var(--radius-md)] transition-opacity
                                ${index === active ? 'ring-2 ring-primary ring-offset-2' : 'opacity-70 hover:opacity-100'}`}
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-baseline justify-between gap-3">
              <span className="kl-money text-[1.5625rem] text-foreground">
                {formatCurrency(item.price_zmw, 'ZMW')}
              </span>
              {item.shop && (
                <button
                  onClick={() => {
                    close();
                    navigate(profile ? `/shop/${item.shop!.id}` : '/signup');
                  }}
                  className="inline-flex min-w-0 items-center gap-1 text-[0.8125rem] text-accent-text hover:opacity-75"
                >
                  <Store className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{item.shop.name}</span>
                </button>
              )}
            </div>

            {/* The way onward.
                Somebody who opened this because they liked the look of it is
                one press from more of the same, instead of having to close
                the modal, work out which shelf it came from, and go looking.
                Null category is normal -- plenty of items are uncategorised --
                and then this simply is not drawn. */}
            {item.category && (
              <button
                onClick={() => {
                  close();
                  navigate(`/browse?category=${encodeURIComponent(item.category!.slug)}`);
                }}
                className="flex w-full items-center justify-between rounded-[var(--radius-md)] bg-surface-paper px-3 py-2
                           text-left text-[0.8125rem] transition-colors hover:bg-ink-100
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                  <LayoutGrid className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.4} />
                  <span className="truncate">More in {item.category.name}</span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              </button>
            )}

            {item.description ? (
              <p className="whitespace-pre-line text-[0.8125rem] leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            ) : (
              <p className="text-[0.8125rem] italic text-muted-foreground/70">
                No description yet.
              </p>
            )}

            {/* The facts that change whether somebody can actually have it.
                Each is now a hard block rather than a line of grey text --
                square informs, and this is the most information-dense thing
                in the app. All six conditions render exactly when they did
                before; none has been dropped for tidiness. The colours carry
                meaning: destructive for out of stock, ink for a fact about
                how it is sold, sage for where you collect it. */}
            <ul className="flex flex-wrap gap-1.5 text-[11px]">
              {outOfStock && (
                <li className="rounded-[var(--radius-block)] bg-destructive px-2 py-1 font-bold uppercase tracking-[0.06em] text-white">
                  Out of stock
                </li>
              )}
              {item.is_quote_only && (
                <li className="rounded-[var(--radius-block)] bg-ink px-2 py-1 font-semibold text-on-ink">
                  Priced on request — message the shop
                </li>
              )}
              {item.minimum_order_quantity > 1 && (
                <li className="rounded-[var(--radius-block)] bg-surface-paper px-2 py-1 font-semibold text-foreground">
                  Minimum order: <span className="kl-money">{item.minimum_order_quantity}</span>
                </li>
              )}
              {item.lead_time_days ? (
                <li className="rounded-[var(--radius-block)] bg-surface-paper px-2 py-1 font-semibold text-foreground">
                  Ready in about <span className="kl-money">{item.lead_time_days}</span> days
                </li>
              ) : null}
              {item.requires_scheduling && (
                <li className="rounded-[var(--radius-block)] bg-surface-paper px-2 py-1 font-semibold text-foreground">
                  Arranged with the shop for a date
                </li>
              )}
              {item.shop?.location && (
                <li className="rounded-[var(--radius-block)] bg-sage-deep px-2 py-1 font-semibold text-white">
                  Collected at {item.shop.location}
                </li>
              )}
            </ul>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => {
                  close();
                  navigate(`/item/${item.id}`);
                }}
              >
                Full details <ArrowRight className="ml-1.5 size-4" />
              </Button>
              <Button onClick={addToCart} disabled={unavailable}>
                <ShoppingCart className="mr-1.5 size-4" />
                {unavailable ? 'Unavailable' : 'Add'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
