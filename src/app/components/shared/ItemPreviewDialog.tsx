import { Eye, EyeOff } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { StorefrontProductCard } from './StorefrontProductCard';
import { formatCurrency } from '../../../utils/currency';
import {
  OUT_OF_STOCK_REASON,
  isOutOfStock,
  servicePriceLabel,
  sortedTiers,
  type CatalogItem,
} from '../../types/items';

interface ItemPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: CatalogItem;
  shopName?: string | null;
  /**
   * From the form's own toggle, not from CatalogItem — a delisted item is
   * filtered out of the storefront queries entirely, so it is not a property
   * the card can render, but it is the single most important thing to tell a
   * merchant previewing a listing that will not appear at all.
   */
  isAvailable?: boolean;
}

/**
 * The item as a buyer will see it, rendered from unsaved form state.
 *
 * Uses the real StorefrontProductCard rather than a mock-up, so the preview
 * cannot drift from the storefront: if the card changes, this changes with it.
 * That matters more now that an item carries a gallery, a minimum-price label,
 * stock state and quantity breaks — a merchant filling in that form has no
 * other way to know what any of it looks like until it is already live.
 */
export function ItemPreviewDialog({
  open,
  onOpenChange,
  item,
  shopName,
  isAvailable = true,
}: ItemPreviewDialogProps) {
  const priceLabel = servicePriceLabel(item);
  const tiers = sortedTiers(item.item_price_tiers);
  const soldOut = isOutOfStock(item);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="size-4" strokeWidth={2} />
            Customer preview
          </DialogTitle>
          <DialogDescription>
            How this listing appears while browsing. Nothing here is saved yet.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
        {!isAvailable && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            <EyeOff className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
            <span>
              This item is switched off, so buyers will not see it at all — not even greyed
              out. Turn on “Available Status” to publish it.
            </span>
          </p>
        )}

        {/* Constrained to roughly a real grid cell so the card is judged at the
            width it will actually be seen at, not stretched across a dialog. */}
        <div className="mx-auto w-full max-w-[15rem]">
          <StorefrontProductCard
            item={{ ...item, shop: item.shop ?? (shopName ? { id: '', name: shopName } : null) }}
            onView={() => undefined}
          />
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Also shown on the item page
          </p>

          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">Price</span>
            <span className="font-medium">
              {priceLabel.prefix ? `${priceLabel.prefix} ` : ''}
              {formatCurrency(item.price_zmw, 'ZMW')}
            </span>
          </div>

          {priceLabel.note && (
            <p className="text-xs font-light text-muted-foreground">{priceLabel.note}</p>
          )}

          {tiers.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="text-xs text-muted-foreground">Bulk pricing</p>
              {tiers.map((tier) => {
                const inert = tier.unit_price_zmw >= item.price_zmw;
                return (
                  <div
                    key={tier.min_quantity}
                    className="flex items-baseline justify-between gap-4 text-xs"
                  >
                    <span className="text-muted-foreground">{tier.min_quantity} or more</span>
                    <span className={inert ? 'text-amber-700' : 'font-medium'}>
                      {formatCurrency(tier.unit_price_zmw, 'ZMW')} each
                      {inert && ' — will not apply'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {soldOut && (
            <p className="border-t border-border pt-2 text-xs font-medium text-muted-foreground">
              Shown as “{OUT_OF_STOCK_REASON}” and greyed out.
            </p>
          )}
        </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
