// Buying from a post.
//
// The card shows no price. This is where one appears, and it is read live when
// the sheet opens rather than stored on the post — a post outlives the price it
// was written against, and a stale price on a purchasable surface is a dispute.
//
// The sheet does not check anybody out. It puts the chosen items in the
// ordinary cart and hands over to the ordinary checkout, so stock reservation
// and the authoritative total stay inside checkout_init_atomic where they
// already live.

import { useNavigate } from 'react-router';
import { Gift, Loader2, Minus, Plus, ShoppingBag, User } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { useAuth } from '../../../utils/auth/AuthContext';
import { usePostBasket } from '../../hooks/usePostBasket';
import { formatCurrency } from '../../../utils/currency';
import type { PostSummary } from '../../types/posts';

interface PostBuySheetProps {
  post: PostSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the shop calls this. See postActionLabel. */
  actionLabel?: string;
}

export function PostBuySheet({ post, open, onOpenChange, actionLabel = 'Buy' }: PostBuySheetProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { lines, chosen, loading, total, listTotal, pricing, setQuantity, handOver } =
    usePostBasket(post, open);

  if (!post) return null;

  const go = (forSelf: boolean) => {
    if (!profile) {
      navigate('/signup');
      return;
    }
    handOver(
      forSelf,
      profile.name && profile.phone ? { name: profile.name, phone: profile.phone } : null,
    );
    onOpenChange(false);
    navigate('/checkout');
  };

  // A break applied: the database priced it lower than the listed prices add up
  // to. Worth saying out loud rather than leaving as an unexplained discrepancy.
  const discounted = total !== null && listTotal > 0 && total < listTotal;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>{actionLabel} from this post</SheetTitle>
          <SheetDescription>
            {post.author.name}
            {post.location_label ? ` · ${post.location_label}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {loading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              This post has nothing attached to buy.
            </p>
          ) : (
            lines.map((line) => (
              <div
                key={line.item_id}
                className={`flex items-center gap-3 rounded-[var(--radius-md)] p-2 ${
                  line.unavailable ? 'opacity-60' : ''
                }`}
              >
                <div className="size-12 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-muted">
                  {line.image_url && (
                    <img src={line.image_url} alt="" className="h-full w-full object-cover" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{line.name}</p>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {line.unavailable ? line.reason : formatCurrency(line.price_zmw, 'ZMW')}
                  </p>
                </div>

                {!line.unavailable && (
                  <div className="kl-rim flex shrink-0 items-center gap-1 rounded-[var(--radius-pill)] bg-card p-0.5">
                    <button
                      onClick={() => setQuantity(line.item_id, line.quantity - 1)}
                      aria-label={`One fewer ${line.name}`}
                      className="grid size-7 place-items-center rounded-[var(--radius-pill)] text-muted-foreground hover:bg-accent"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="min-w-5 text-center text-sm tabular-nums">{line.quantity}</span>
                    <button
                      onClick={() => setQuantity(line.item_id, line.quantity + 1)}
                      aria-label={`One more ${line.name}`}
                      className="grid size-7 place-items-center rounded-[var(--radius-pill)] text-primary hover:bg-accent"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {chosen.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-semibold tabular-nums">
                {pricing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : total !== null ? (
                  formatCurrency(total, 'ZMW')
                ) : (
                  formatCurrency(listTotal, 'ZMW')
                )}
              </span>
            </div>
            {discounted && (
              <p className="mt-0.5 text-right text-[0.6875rem] text-primary">
                Bulk price applied
              </p>
            )}
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">
              Fees and any currency conversion are shown at checkout.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => go(true)}>
                <User className="mr-1.5 size-4" /> For me
              </Button>
              <Button onClick={() => go(false)}>
                <Gift className="mr-1.5 size-4" /> For someone
              </Button>
            </div>
          </div>
        )}

        {!loading && lines.length > 0 && chosen.length === 0 && (
          <p className="mt-4 flex items-center justify-center gap-1.5 py-4 text-sm text-muted-foreground">
            <ShoppingBag className="size-4" /> Nothing selected.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
