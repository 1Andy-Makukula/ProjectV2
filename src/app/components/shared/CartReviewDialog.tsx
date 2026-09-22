// Every item in the cart, on the whole screen, before anybody pays.
//
// WHY THIS EXISTS
// ---------------
// The cart is a 400px panel down one edge. That is the right shape for
// four items and the wrong shape for forty — and forty is exactly what a
// month of groceries looks like. Scrolling a long basket through a narrow
// column, on a phone, while deciding whether to part with money, is where
// somebody stops and closes the tab.
//
// So this is not a second cart. It is a READING surface: no steppers, no
// remove buttons, nothing to fiddle with or knock by accident. The cart
// remains the place you change things; this is the place you check them.
// Separating those two jobs is the whole point — a review you can edit is a
// review you can ruin.
//
// It sits on top of the cart sheet rather than replacing it, so dismissing it
// puts you back exactly where you were with the basket still open.

import { Fragment } from 'react';
import { Package, ShoppingBag } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { formatCurrency } from '../../../utils/currency';
import { cartLineUnitPrice } from '../../hooks/useCart';
import { describeSelection } from '../../types/itemOptions';
import type { CartItem } from '../../types';

interface ShopGroup {
  shopName: string;
  items: CartItem[];
  subtotal: number;
}

interface CartReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ShopGroup[];
  count: number;
  total: number;
}

export function CartReviewDialog({
  open,
  onOpenChange,
  groups,
  count,
  total,
}: CartReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Nearly the whole viewport. A review that needs its own scrollbar to
          show six lines has not solved the problem it was opened for. */}
      <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-4rem)]">
        <DialogHeader className="shrink-0 border-b border-ink-100 px-5 py-3 text-left">
          <DialogTitle className="text-base font-semibold tracking-tight text-ink-900">
            Everything in your cart
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {count} item{count === 1 ? '' : 's'} from {groups.length} shop
            {groups.length === 1 ? '' : 's'}. Check it over — nothing is paid for yet.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              <ShoppingBag className="mx-auto mb-2 h-8 w-8 text-ink-300" strokeWidth={1} />
              Your cart is empty.
            </p>
          ) : (
            groups.map((group) => (
              <Fragment key={group.shopName}>
                {/* Grouped by shop, and never merged. Each shop is a separate
                    collection with its own claim code, so a basket that read
                    as one list would misdescribe what actually happens. */}
                <div className="mb-2 mt-5 flex items-baseline justify-between border-b border-ink-100 pb-1.5 first:mt-0">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                    <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.4} />
                    {group.shopName}
                  </h3>
                  <span className="kl-money text-sm text-muted-foreground">
                    {formatCurrency(group.subtotal, 'ZMW')}
                  </span>
                </div>

                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const unit = cartLineUnitPrice(item);
                    const extras = describeSelection(
                      item.product.option_groups,
                      item.selection ?? {},
                    );
                    return (
                      <li
                        key={item.product.id}
                        className="flex items-start gap-3 rounded-[var(--radius-md)] px-2 py-1.5 odd:bg-surface-paper/60"
                      >
                        {/* Quantity first. On a long list the question being
                            asked is "how many of each", not "what is it
                            called" -- the name is recognisable at a glance
                            and the count is not. */}
                        <span className="kl-money w-8 shrink-0 text-right text-sm text-ink-900">
                          {item.quantity}×
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink-900">
                            {item.product.name || item.product.title}
                          </span>
                          {extras && (
                            <span className="block text-xs text-muted-foreground">{extras}</span>
                          )}
                        </span>
                        <span className="kl-money shrink-0 text-sm text-ink-900">
                          {formatCurrency(unit * item.quantity, 'ZMW')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Fragment>
            ))
          )}
        </div>

        {/* The subtotal only. Fees, credits and the payable total stay in the
            cart where the pay button is -- repeating them here would make two
            places that state a total, and the moment those ever disagree the
            product has a credibility problem far bigger than a layout one. */}
        <div className="shrink-0 border-t border-ink-100 px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Items subtotal</span>
            <span className="kl-money text-lg text-ink-900">{formatCurrency(total, 'ZMW')}</span>
          </div>
          <p className="mt-1 text-xs font-light text-muted-foreground">
            Fees and the total payable are on the cart. Close this to go back to it.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
