import { motion } from 'motion/react';
import { Package, ShoppingCart } from 'lucide-react';
import { StorefrontProductCard } from '../shared/StorefrontProductCard';
import { Skeleton } from '../ui/skeleton';
import { formatCurrency } from '../../../utils/currency';
import {
  OUT_OF_STOCK_REASON,
  isService,
  isOutOfStock,
  requiresConversation,
  discountPercentage,
  servicePriceLabel,
} from '../../types/items';
import type { CatalogItem } from '../../types/items';
import type { ModeLayout } from '../../types/storefrontModes';

interface ItemFeedProps {
  items: CatalogItem[];
  loading: boolean;
  layout: ModeLayout;
  onGift: (item: CatalogItem) => void;
  onAddToCart?: (item: CatalogItem) => void;
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <Skeleton className="aspect-square w-full" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

/**
 * A dense row for the shopping face — the shopper already knows what they want,
 * so the priority is scanning many items and reaching the cart quickly.
 */
function ItemRow({
  item,
  onGift,
  onAddToCart,
  hideShopName,
}: {
  item: CatalogItem;
  onGift: () => void;
  onAddToCart?: () => void;
  /** The menu layout already names the business in its group header. */
  hideShopName?: boolean;
}) {
  const service = isService(item);
  const discount = discountPercentage(item);
  const conversationFirst = service || requiresConversation(item);
  const priceLabel = servicePriceLabel(item);
  const outOfStock = isOutOfStock(item);

  return (
    <div
      className={`flex items-center gap-3 border-b border-slate-100 px-1 py-3 transition-colors last:border-0 hover:bg-slate-50/70
                  ${outOfStock ? 'opacity-55' : ''}`}
    >
      <button
        onClick={onGift}
        className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-50"
        aria-label={item.name}
      >
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-5 w-5 text-slate-300" strokeWidth={1.5} />
          </div>
        )}
      </button>

      <button onClick={onGift} className="min-w-0 flex-1 text-left">
        {!hideShopName && item.shop?.name && (
          <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {item.shop.name}
          </p>
        )}
        <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          {priceLabel.prefix && (
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {priceLabel.prefix}
            </span>
          )}
          <span className="text-sm font-semibold tabular-nums text-slate-900">
            {formatCurrency(item.price_zmw, 'ZMW')}
          </span>
          {discount !== null && item.original_price_zmw != null && (
            <span className="text-[11px] text-slate-400 line-through">
              {formatCurrency(item.original_price_zmw, 'ZMW')}
            </span>
          )}
        </div>
        {outOfStock && (
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {OUT_OF_STOCK_REASON}
          </p>
        )}
      </button>

      {outOfStock ? (
        <span className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-400">
          Sold out
        </span>
      ) : conversationFirst ? (
        <button
          onClick={onGift}
          className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700
                     transition-all duration-200 hover:border-slate-900 hover:bg-slate-900 hover:text-white active:scale-[0.98]"
        >
          View
        </button>
      ) : (
        onAddToCart && (
          <button
            onClick={onAddToCart}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-mode-accent/30 px-3 py-2 text-xs font-semibold
                       text-mode-accent transition-all duration-200 hover:bg-mode-tint active:scale-[0.98]"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Add
          </button>
        )
      )}
    </div>
  );
}

export function ItemFeed({ items, loading, layout, onGift, onAddToCart }: ItemFeedProps) {
  const rowLayout = layout === 'list' || layout === 'menu';

  if (loading) {
    const count = layout === 'editorial' ? 4 : rowLayout ? 6 : 8;
    return rowLayout ? (
      <div className="rounded-2xl border border-slate-100 bg-white px-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-0">
            <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div
        className={
          layout === 'editorial'
            ? 'grid grid-cols-1 gap-6 sm:grid-cols-2'
            : 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 sm:gap-6'
        }
      >
        {Array.from({ length: count }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400">
        <Package className="mx-auto mb-3 h-10 w-10 text-slate-300" strokeWidth={1} />
        <p className="text-sm">Nothing here yet — try another section.</p>
      </div>
    );
  }

  if (layout === 'list') {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white px-4">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            onGift={() => onGift(item)}
            onAddToCart={onAddToCart ? () => onAddToCart(item) : undefined}
          />
        ))}
      </div>
    );
  }

  // A price list per business, rather than one undifferentiated run of rows.
  // Insertion order is preserved so the feed's own ordering still decides which
  // provider appears first.
  if (layout === 'menu') {
    const byShop = new Map<string, { name: string; location?: string | null; items: CatalogItem[] }>();
    for (const item of items) {
      const key = item.shop?.id ?? 'unknown';
      const group = byShop.get(key);
      if (group) {
        group.items.push(item);
      } else {
        byShop.set(key, {
          name: item.shop?.name ?? 'Other providers',
          location: item.shop?.location,
          items: [item],
        });
      }
    }

    return (
      <div className="space-y-5">
        {Array.from(byShop.entries()).map(([shopId, group]) => (
          <section key={shopId} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            <header className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-900">{group.name}</h3>
                {group.location && (
                  <p className="truncate text-[11px] font-light text-slate-400">{group.location}</p>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-slate-400">
                {group.items.length} service{group.items.length === 1 ? '' : 's'}
              </span>
            </header>

            <div className="px-4">
              {group.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  hideShopName
                  onGift={() => onGift(item)}
                  onAddToCart={onAddToCart ? () => onAddToCart(item) : undefined}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  // Editorial gives each card room to breathe; grid is the standard density.
  const gridClass =
    layout === 'editorial'
      ? 'grid grid-cols-1 gap-6 sm:grid-cols-2'
      : 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 sm:gap-6';

  return (
    <div className={gridClass}>
      {items.map((item, i) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.05 }}
        >
          <StorefrontProductCard
            item={item}
            onGift={() => onGift(item)}
            onAddToCart={onAddToCart ? () => onAddToCart(item) : undefined}
          />
        </motion.div>
      ))}
    </div>
  );
}

/** Shared section heading, tinted by the active mode. */
export function SectionHeading({
  kicker,
  title,
  subtitle,
  action,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-mode-accent">
          {kicker}
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
