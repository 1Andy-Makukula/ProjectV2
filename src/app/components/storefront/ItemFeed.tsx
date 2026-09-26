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
import { Vector } from '../shared/Vector';
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
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
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
  const billboard = variant === 'card';
  const ctaShape = billboard ? 'flex-1 text-center' : 'shrink-0';

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
        <span className={`${ctaShape} rounded-xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-400`}>
          Sold out
        </span>
      ) : conversationFirst ? (
        /* A service says the mode's own word. This branch said "View" to
           everything, so a Services feed whose lexicon is "Book" offered a
           column of buttons that read like a catalogue. Anything that is
           conversation-first WITHOUT being a service -- a quote-only product
           -- still says View, because booking is not what happens next there.

           Filled, not outlined, on a billboard: it is the only press on the
           card and the kit's advert fills its CTA. */
        <button
          onClick={onGift}
          className={`${ctaShape} rounded-xl px-3 py-2 text-xs font-semibold
                      transition-all duration-200 active:scale-[0.98]
                      ${billboard && service
                        ? 'border border-transparent bg-ink-900 text-white hover:bg-primary'
                        : 'border border-ink-200 text-ink-700 hover:border-ink-900 hover:bg-ink-900 hover:text-white'}`}
        >
          {service ? 'Review and book' : 'View'}
        </button>
      ) : (
        onAddToCart && (
          <button
            onClick={onAddToCart}
            className={`flex ${ctaShape} items-center justify-center gap-1 rounded-xl border border-mode-accent/30
                        px-3 py-2 text-xs font-semibold text-mode-accent
                        transition-all duration-200 hover:bg-mode-tint active:scale-[0.98]`}
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
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
          {priceLabel.prefix}
        </span>
      )}
      <span className={`tabular-nums text-ink-900 ${
        variant === 'card' ? 'kl-money text-xl leading-none' : 'text-sm font-semibold'
      }`}>
        {formatCurrency(item.price_zmw, 'ZMW')}
      </span>
      {discount !== null && item.original_price_zmw != null && (
        <span className="text-[11px] text-ink-400 line-through">
          {formatCurrency(item.original_price_zmw, 'ZMW')}
        </span>
      )}
    </div>
  );

  const shopLine = !hideShopName && item.shop?.name && (
    <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-ink-400">
      {item.shop.name}
    </p>
  );

  const soldOutLine = outOfStock && (
    <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
      {OUT_OF_STOCK_REASON}
    </p>
  );

  if (variant === 'card') {
    return (
      /* A BILLBOARD, not a table row.
         This was a 96px thumbnail on the left with the text beside it, which
         is the shape of a spreadsheet: nothing about it said "here is work
         somebody will come and do for you". A service has no packaging and no
         shelf, so the picture has to do the whole job of saying what it is,
         and at 96px square it cannot.

         Picture across the top at a poster's proportion, the offer said once
         in the display voice, and one press along the foot. Paper ground
         because the shop panel around it is already white -- a white card on
         white is an outline, not an object. */
      <article
        className={`flex flex-col overflow-hidden rounded-2xl bg-surface-paper
                    ${outOfStock ? 'opacity-55' : ''}`}
      >
        <button
          onClick={onGift}
          className="relative block aspect-[16/10] w-full overflow-hidden bg-ink-50"
          aria-label={item.name}
        >
          {/* The same sticker the grid tile carries, so a discount looks like
              a discount wherever a shopper meets it. */}
          {discount !== null && (
            <span className="pointer-events-none absolute left-1 top-1 z-10 block origin-top-left scale-90">
              <Vector name="promo" size="S" tone="brand" tag={`-${discount}%`} />
            </span>
          )}
          {item.image_url ? (
            <img
              src={item.image_url}
              alt={item.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="h-8 w-8 text-ink-300" strokeWidth={1.25} />
            </div>
          )}
        </button>

        <div className="flex flex-1 flex-col gap-1 p-4">
          <button onClick={onGift} className="min-w-0 text-left">
            {shopLine}
            {/* Caprasimo, two lines. "Deep Clean (3 Bedroom)" is the whole
                offer and truncating it at one line loses the half that says
                what you get. */}
            <h4 className="kl-display line-clamp-2 text-[1.0625rem] leading-[1.15] text-ink-900">
              {item.name}
            </h4>
            {item.description && (
              <p className="mt-1 line-clamp-2 text-xs font-light leading-snug text-ink-500">
                {item.description}
              </p>
            )}
            <div className="mt-2">{price}</div>
            {soldOutLine}
          </button>

          <div className="mt-auto flex items-center gap-2 pt-3">{actions}</div>
        </div>
      </article>
    );
  }

  return (
    <div
      className={`flex break-inside-avoid items-center gap-3 border-b border-ink-100 px-1 py-3
                  transition-colors last:border-0 hover:bg-ink-50/70
                  ${outOfStock ? 'opacity-55' : ''}`}
    >
      <button
        onClick={onGift}
        className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-ink-50"
        aria-label={item.name}
      >
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-5 w-5 text-ink-300" strokeWidth={1.5} />
          </div>
        )}
      </button>

      <button onClick={onGift} className="flex min-w-0 flex-1 items-end gap-2 text-left">
        <span className="min-w-0 flex-1">
          {shopLine}
          <p className="truncate text-sm font-medium text-ink-900">{item.name}</p>
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
      <div className="rounded-2xl border border-ink-100 bg-white px-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-ink-100 py-3 last:border-0">
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
      <div className="rounded-2xl border border-dashed border-ink-200 py-16 text-center text-ink-400">
        <Package className="mx-auto mb-3 h-10 w-10 text-ink-300" strokeWidth={1} />
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
          <section key={shopId} className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
            {/* Who is offering, with their mark. A price list on a shop wall is
                read under the sign above it — without one, every group here
                looked like the same anonymous business. */}
            <header className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
              <div className="size-9 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-ink-50">
                {group.logo ? (
                  <img src={group.logo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center">
                    <Store className="size-4 text-ink-300" strokeWidth={1.5} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-ink-900">{group.name}</h3>
                {group.location && (
                  <p className="truncate text-[11px] font-light text-ink-400">{group.location}</p>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-ink-400">
                {group.items.length} service{group.items.length === 1 ? '' : 's'}
              </span>
            </header>

            <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
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

/** Shared section heading, tinted by the active mode.
 *
 * FLAT, as of 2026-09-18. These were the gradient-clipped .kl-accent-*
 * classes; gradient text is what substitution 2 of the charter removes. The
 * hues survive as solid fills, which is also the charter's own first
 * principle -- colour as an object with a hard edge rather than as a wash.
 *
 * All five clear 3:1 on white, which is the floor for headline-scale text
 * (these render at 30-38px). They would NOT all clear the 4.5:1 that text
 * under 18px needs, so this map must not be reused on small type. */
const SECTION_ACCENT = {
  brand: 'text-[var(--accent-brand)]',
  coral: 'text-[var(--accent-coral)]',
  berry: 'text-[var(--accent-berry)]',
  leaf: 'text-[var(--accent-leaf)]',
  ink: 'text-[var(--accent-ink)]',
} as const;

export function SectionHeading({
  kicker,
  title,
  subtitle,
  action,
  accent = 'brand',
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Same vocabulary as the rail modules. See ModuleAccent there. */
  accent?: keyof typeof SECTION_ACCENT;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {/* The kicker keeps the travelling pulse — it is the one piece of the
            heading that moves, and it reads as a lit label rather than a flat
            orange line. */}
        <p className="kl-pulse-text mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em]">
          {kicker}
        </p>
        {/* Black weight, and the section's own colour — the same move the rail
            modules make, so the feed and the flanks read as one system rather
            than as two components that happen to share a page. `accent`
            defaults to the brand, so a section that does not choose is
            orange. */}
        <h2
          className={`kl-display text-[1.875rem] leading-[1.02] tracking-[-0.015em]
                      sm:text-[2.375rem] ${SECTION_ACCENT[accent]}`}
        >
          {title}
        </h2>
        {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
