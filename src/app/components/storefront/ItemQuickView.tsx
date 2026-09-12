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
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Package, ShoppingCart, Store } from 'lucide-react';
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
  images: string[];
}

export function ItemQuickView() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { itemId, close } = useItemQuickView();
  const [item, setItem] = useState<QuickItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!itemId) {
      setItem(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setActive(0);

    (async () => {
      const { data, error } = await supabase
        .from('items')
        .select(
          'id, name, description, price_zmw, image_url, item_type, is_available, is_quote_only, ' +
            'stock_quantity, minimum_order_quantity, lead_time_days, requires_scheduling, shop_id, ' +
            'shop:shops(id, name, location), item_images(image_url, sort_order)',
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

            <div className="overflow-hidden rounded-[var(--radius-md)] bg-muted">
              {item.images[active] ? (
                <img
                  src={item.images[active]}
                  alt={item.name}
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="grid aspect-[4/3] w-full place-items-center">
                  <Package className="size-10 text-muted-foreground/30" strokeWidth={1.25} />
                </div>
              )}
            </div>

            {/* Only worth showing when there is a choice to make. */}
            {item.images.length > 1 && (
              <div className="kl-scroll -mx-1 flex gap-2 overflow-x-auto px-1">
                {item.images.map((url, index) => (
                  <button
                    key={url}
                    onClick={() => setActive(index)}
                    aria-label={`Picture ${index + 1}`}
                    aria-pressed={index === active}
                    className={`size-14 shrink-0 overflow-hidden rounded-[var(--radius-md)] transition-opacity
                                ${index === active ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-baseline justify-between gap-3">
              <span className="kl-display text-2xl font-semibold">
                {formatCurrency(item.price_zmw, 'ZMW')}
              </span>
              {item.shop && (
                <button
                  onClick={() => {
                    close();
                    navigate(profile ? `/shop/${item.shop!.id}` : '/signup');
                  }}
                  className="inline-flex min-w-0 items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground"
                >
                  <Store className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{item.shop.name}</span>
                </button>
              )}
            </div>

            {item.description ? (
              <p className="whitespace-pre-line text-[0.8125rem] leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            ) : (
              <p className="text-[0.8125rem] italic text-muted-foreground/70">
                No description yet.
              </p>
            )}

            {/* The facts that change whether somebody can actually have it. */}
            <ul className="space-y-1 text-[0.75rem] text-muted-foreground">
              {outOfStock && <li className="text-destructive">Out of stock</li>}
              {item.is_quote_only && <li>Priced on request — message the shop</li>}
              {item.minimum_order_quantity > 1 && (
                <li>Minimum order: {item.minimum_order_quantity}</li>
              )}
              {item.lead_time_days ? <li>Ready in about {item.lead_time_days} days</li> : null}
              {item.requires_scheduling && <li>Arranged with the shop for a date</li>}
              {item.shop?.location && <li>Collected at {item.shop.location}</li>}
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
