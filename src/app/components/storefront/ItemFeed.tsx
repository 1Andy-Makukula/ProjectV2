import { motion } from 'motion/react';
import { Minus, Package, Plus, ShoppingCart, Store } from 'lucide-react';
import { cartLineKey, useCart } from '../../hooks/useCart';
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
import { SaveToListButton } from '../shared/SaveToListButton';
import type { CatalogItem } from '../../types/items';
import type { ModeLayout } from '../../types/storefrontModes';

interface ItemFeedProps {
  items: CatalogItem[];
  loading: boolean;
  layout: ModeLayout;
  onGift: (item: CatalogItem) => void;
  onAddToCart?: (item: CatalogItem) => void;
  /** Grid classes for this mode. Density is tone, so the mode decides it. */
  density?: string;
  /** What this mode calls adding something to the cart. */
  addLabel?: string;
  /** The glyph for that action — the same one the navbar's basket wears. */
  addIcon?: typeof ShoppingCart;
  /** A tile treatment, drawn by theme.css. */
  ornament?: 'gift';
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
 * One entry in a row-shaped feed.
 *
 * Two shapes, one set of controls. `row` is the dense line a shopper scanning a
 * catalogue wants. `card` gives the entry a picture worth looking at and moves
 * the controls to its foot — which is what a service needs, because a name like
 * "Deep clean" tells you nothing and the thing has to be read before anyone
 * decides. The cart logic below is shared rather than written twice.
 */
function ItemRow({
  item,
  onGift,
  onAddToCart,
  hideShopName,
  variant = 'row',
  addLabel = 'Add',
  addIcon: AddGlyph = ShoppingCart,
}: {
  item: CatalogItem;
  onGift: () => void;
  onAddToCart?: () => void;
  /** The menu layout already names the business in its group header. */
  hideShopName?: boolean;
  variant?: 'row' | 'card';
  addLabel?: string;
  addIcon?: typeof ShoppingCart;
}) {
  const service = isService(item);
  const discount = discountPercentage(item);
  const conversationFirst = service || requiresConversation(item);
  const priceLabel = servicePriceLabel(item);
  const outOfStock = isOutOfStock(item);

  // Restocking is a counting job, so the row counts. An item with options is
  // deliberately excluded: its price depends on choices that can only be made
  // on the detail page, and a stepper here would quietly add the wrong thing.
  const hasOptions = (item.item_option_groups ?? []).length > 0;
  const lineKey = cartLineKey(item.id);
  const inCart = useCart((state) =>
    state.items.find((line) => (line.lineKey ?? line.product.id) === lineKey),
  );
  const quantity = inCart?.quantity ?? 0;
  const updateQuantity = useCart((state) => state.updateQuantity);
  const steppable = Boolean(onAddToCart) && !conversationFirst && !outOfStock && !hasOptions;

  /* Saving is offered even when it is sold out — that is often exactly when
     someone wants to keep track of it. */
  const actions = (
    <>
      <SaveToListButton
        className="shrink-0"
        target={{ kind: 'item', id: item.id, name: item.name, image_url: item.image_url }}
      />

      {steppable && quantity > 0 ? (
        <div className="kl-rim flex shrink-0 items-center gap-1 rounded-[var(--radius-pill)] bg-card p-0.5">
          <button
            onClick={() => updateQuantity(lineKey, quantity - 1)}
            aria-label={`One fewer ${item.name}`}
            className="grid size-7 place-items-center rounded-[var(--radius-pill)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Minus className="size-3.5" strokeWidth={2} />
          </button>
          <span className="min-w-5 text-center text-xs font-semibold tabular-nums">{quantity}</span>
          <button
            onClick={onAddToCart}
            aria-label={`One more ${item.name}`}
            className="grid size-7 place-items-center rounded-[var(--radius-pill)] text-mode-accent transition-colors hover:bg-mode-tint"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>
      ) : outOfStock ? (
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
            <AddGlyph className="h-3.5 w-3.5" />
            {addLabel}
          </button>
        )
      )}
    </>
  );

  const price = (
    <div className="flex items-baseline gap-2">
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
  );

  const shopLine = !hideShopName && item.shop?.name && (
    <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-400">
      {item.shop.name}
    </p>
  );

  const soldOutLine = outOfStock && (
    <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      {OUT_OF_STOCK_REASON}
    </p>
  );

  if (variant === 'card') {
    return (
      <div
        className={`flex gap-3 border-b border-slate-100 py-3 last:border-0 ${
          outOfStock ? 'opacity-55' : ''
        }`}
      >
        <button
          onClick={onGift}
          className="size-24 shrink-0 overflow-hidden rounded-xl bg-slate-50"
          aria-label={item.name}
        >
          {item.image_url ? (
            <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="h-6 w-6 text-slate-300" strokeWidth={1.5} />
            </div>
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          <button onClick={onGift} className="min-w-0 text-left">
            {shopLine}
            <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
            {item.description && (
              <p className="mt-0.5 line-clamp-2 text-[11px] font-light leading-snug text-slate-500">
                {item.description}
              </p>
            )}
            <div className="mt-1">{price}</div>
            {soldOutLine}
          </button>

          {/* The foot of the card: where the eye finishes, and the only place
              these two do not compete with the price for the same line. */}
          <div className="mt-auto flex items-center justify-end gap-2 pt-2">{actions}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex break-inside-avoid items-center gap-3 border-b border-slate-100 px-1 py-3
                  transition-colors last:border-0 hover:bg-slate-50/70
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

      <button onClick={onGift} className="flex min-w-0 flex-1 items-end gap-2 text-left">
        <span className="min-w-0 flex-1">
          {shopLine}
          <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
          <div className="mt-0.5">{price}</div>
          {soldOutLine}
        </span>

        {/* The run of dots between a service and its price, the way a printed
            menu sets it — and the honest way to fill the width a wide screen
            leaves between the two. */}
        {service && <span aria-hidden className="kl-leader" />}
      </button>

      {actions}
    </div>
  );
}

export function ItemFeed({
  items,
  loading,
  layout,
  onGift,
  onAddToCart,
  density,
  addLabel,
  addIcon,
  ornament,
}: ItemFeedProps) {
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
          density ??
          (layout === 'editorial'
            ? 'grid grid-cols-1 gap-6 sm:grid-cols-2'
            : 'grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4 2xl:grid-cols-5')
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
      <div className="kl-tile columns-1 gap-x-8 px-4 py-1 xl:columns-2 2xl:columns-3">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            addLabel={addLabel}
            addIcon={addIcon}
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
    const byShop = new Map<
      string,
      { name: string; location?: string | null; logo?: string | null; items: CatalogItem[] }
    >();
    for (const item of items) {
      const key = item.shop?.id ?? 'unknown';
      const group = byShop.get(key);
      if (group) {
        group.items.push(item);
      } else {
        byShop.set(key, {
          name: item.shop?.name ?? 'Other providers',
          location: item.shop?.location,
          logo: item.shop?.logo_url,
          items: [item],
        });
      }
    }

    return (
      <div className="space-y-5">
        {Array.from(byShop.entries()).map(([shopId, group]) => (
          <section key={shopId} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {/* Who is offering, with their mark. A price list on a shop wall is
                read under the sign above it — without one, every group here
                looked like the same anonymous business. */}
            <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <div className="size-9 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-slate-50">
                {group.logo ? (
                  <img src={group.logo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center">
                    <Store className="size-4 text-slate-300" strokeWidth={1.5} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
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
                  variant="card"
                  addLabel={addLabel}
                  addIcon={addIcon}
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

  // The mode's own ladder wins; otherwise editorial gives each card room to
  // breathe and grid is the standard density.
  const gridClass =
    density ??
    (layout === 'editorial'
      ? 'grid grid-cols-1 gap-6 sm:grid-cols-2'
      : 'grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4 2xl:grid-cols-5');

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
            ornament={ornament}
            addLabel={addLabel}
            addIcon={addIcon}
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
        <h2 className="kl-display text-[1.75rem] font-semibold text-foreground sm:text-[2.125rem]">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
