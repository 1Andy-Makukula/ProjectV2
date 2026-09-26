// StorefrontProductCard — Weekly picks / storefront item card
// Usage: <StorefrontProductCard item={item} onGift={() => navigate(`/send/${item.id}`)} />
// Named StorefrontProductCard to avoid conflict with the existing ProductCard.tsx

import { Package, Shield, ShoppingCart, ConciergeBell, CalendarClock } from 'lucide-react';
import {
  OUT_OF_STOCK_REASON,
  discountPercentage,
  isOutOfStock,
  isService,
  requiresConversation,
  servicePriceLabel,
  galleryUrls,
  type CatalogItem,
} from '../../types/items';
import { BreathingImage } from './BreathingImage';
import { Vector } from './Vector';
import { SaveToListButton } from './SaveToListButton';
import { WatchButton } from './WatchButton';

export type StorefrontItem = CatalogItem;

interface StorefrontProductCardProps {
  item: StorefrontItem;
  onGift?: () => void;
  onView?: () => void;
  onAddToCart?: () => void;
  /** A per-mode tile treatment, drawn by theme.css. */
  ornament?: 'gift';
  /** What the active mode calls adding to the cart. */
  addLabel?: string;
  /** The glyph for that action, so the tile agrees with the navbar. */
  addIcon?: typeof ShoppingCart;
}

function formatZmw(ngwee: number | null | undefined): string {
  return ngwee != null ? (ngwee / 100).toFixed(2) : '—';
}

export function StorefrontProductCard({
  item,
  onGift,
  onView,
  onAddToCart,
  ornament,
  addLabel = 'Add',
  addIcon: AddGlyph = ShoppingCart,
}: StorefrontProductCardProps) {
  const service = isService(item);
  const outOfStock = isOutOfStock(item);

  // Services carry terms — where the work happens, how far ahead to book, what
  // the validity is measured from — that a one-tap add-to-cart would hide. They
  // always go through the detail view, as does anything needing a quote first.
  const mustOpenDetail = service || requiresConversation(item);
  const showAddToCart = Boolean(onAddToCart) && !mustOpenDetail && !outOfStock;

  const handle = onGift ?? onView;
  const badge = item.is_weekly_pick ? 'Top Pick' : (item.promo_badge_text ?? null);
  const discount = discountPercentage(item);

  const priceLabel = servicePriceLabel(item);

  const primaryLabel = item.requires_scheduling
    ? 'Book'
    : item.allow_custom_quote
      // A minimum price means both routes are open — booking it as listed, or
      // discussing something tailored — so the card must not promise only one.
      ? (item.price_is_minimum ? 'Book or customise' : 'Talk to the shop')
      : mustOpenDetail
        ? 'View details'
        : onGift
          ? 'Gift This'
          : 'View';

  return (
    <article
      // The pulsing rim goes on the cards with a deal on them, not on every
      // card. A light that moves means "look here"; twenty of them side by
      // side means nothing, and the discount is the one thing on this page
      // worth interrupting a scan for. Everything else keeps the static rim
      // .kl-tile already draws.
      // kl-rim--warm: the one place the orange lip survives. On everything
      // else it came off — an orange outline around every tile and post in the
      // app is the brand shouting from the furniture.
      className={`kl-tile kl-lift kl-rim kl-rim--warm group relative flex flex-col overflow-hidden
                  ${discount !== null ? 'kl-pulse-rim' : ''}
                  ${ornament === 'gift' ? 'kl-ornament-gift' : ''}`}
    >
      {/* ── Image block ─────────────────────────────────────────── */}
      {/* Sold out is greyed rather than hidden: the buyer can see the shop
          stocks it and come back. Hiding it is what is_available does. */}
      {/* White, not grey, and padded. The picture used to fill a grey window
          cut into the tile; now it sits on the tile's own surface with room
          around it and throws a shadow of its own shape, so the product reads
          as an object placed there rather than as a photograph mounted in a
          frame. */}
      <div
        className={`relative w-full aspect-square shrink-0 bg-card p-5
                    ${outOfStock ? 'opacity-45 grayscale' : ''}`}
      >
        {item.image_url ? (
          /* Breathes through the item's gallery when it has one, and is a
             plain picture when it does not -- galleryUrls returns just the
             cover in that case, and the Conductor refuses a single slot. */
          <BreathingImage
            id={item.id}
            sources={galleryUrls(item)}
            alt={item.name}
            className="w-full h-full"
            imageClassName="kl-cutout w-full h-full
                            transition-transform duration-500 group-hover:scale-[1.05]"
          />
        ) : (
          /* Gradient placeholder — no image */
          <div className="w-full h-full flex items-center justify-center">
            {service ? (
              <ConciergeBell className="h-10 w-10 text-ink-200" strokeWidth={1} />
            ) : (
              <Package className="h-10 w-10 text-ink-200" strokeWidth={1} />
            )}
          </div>
        )}

        {/* Merchandising badge — top-right corner.
            A BLOCK, not a pill. Round means tappable in this language and this
            is a fact about the item, not a control.

            The braces around this comment matter: without them JSX treats the
            text as a child and renders it onto the tile. It did, on every
            badged card, and the string is in the shipped bundle.

            The discount no longer shares this corner. It is the one thing on
            the tile worth interrupting a scan for, so it gets the sticker
            below instead of a 10px block the eye skates over. */}
        {badge && (
          <div className="absolute top-2.5 right-2.5">
            <span
              className="inline-block rounded-[var(--radius-block)] bg-ink px-2 py-0.5
                         text-[10px] font-bold uppercase tracking-[0.06em] text-on-ink"
            >
              {badge}
            </span>
          </div>
        )}

        {/* ── The discount sticker ──────────────────────────────────
            The promo figure carrying the number, pinned into the picture's
            top-left and deliberately crowding it. The charter's rule for the
            cast is that a character never stands alone -- it is the handle a
            tag hangs from -- so Vector takes the percentage as its tag and
            refuses to render without one.

            It sits INSIDE the image block on purpose. The article clips its
            children, and .kl-rim draws the tile's edge with a ::before, so a
            sticker that broke the card's boundary would mean unpicking both.
            Crowding the picture reads as intended without touching either.

            Scaled rather than resized: Vector's sizes are a closed set of
            40/72/120 and this keeps to 40, with the whole unit scaled from its
            top-left corner so a phone tile at two-across is not swamped and a
            desktop tile at five-across still gets something that shouts. */}
        {discount !== null && (
          <div className="pointer-events-none absolute left-1 top-1 z-10 origin-top-left
                          scale-90 sm:scale-105 lg:scale-125">
            <Vector name="promo" size="S" tone="brand" tag={`-${discount}%`} />
          </div>
        )}

        {/* Service marker — top-left, so it never collides with the badge */}
        {/* Service marker — top-left, unless the discount sticker is standing
            there, in which case it drops beneath it. ShopCard solves the same
            collision the same way. */}
        {service && (
          <div className={`absolute left-2.5 z-10 flex items-center gap-1
                          rounded-[var(--radius-block)] bg-surface-paper px-2 py-0.5
                          ${discount !== null ? 'top-[5.25rem] sm:top-[6rem]' : 'top-2.5'}`}>
            <ConciergeBell className="h-2.5 w-2.5 shrink-0 text-muted-foreground" strokeWidth={2.75} />
            <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-foreground">
              Service
            </span>
          </div>
        )}

        {/* Save and watch — bottom-right, clear of the badge, the service
            marker and the escrow shield. Two gestures about the same thing:
            saving is wanting it, watching is waiting for it to get cheaper. */}
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
          <WatchButton itemId={item.id} />
          <SaveToListButton
            target={{ kind: 'item', id: item.id, name: item.name, image_url: item.image_url }}
          />
        </div>

        {/* Escrow shield — bottom-left */}
        {/* Brass, because brass means held money and nothing else. This was
            brand orange, which in this language means "act now" -- escrow is
            a reassurance, not a call to action. */}
        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1
                        rounded-[var(--radius-block)] bg-brass px-2 py-0.5">
          <Shield className="h-2.5 w-2.5 shrink-0 text-ink" strokeWidth={2.75} />
          <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-ink">
            Escrow
          </span>
        </div>
      </div>

      {/* ── Info block ──────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 gap-1 px-4 py-3">
        {/* Merchant */}
        {item.shop?.name && (
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {item.shop.name}
          </p>
        )}

        {/* Name.
            A service is sold the way the charter sells an advert: the offer
            said once, in the display voice, with room to finish the sentence.
            A product keeps the interface voice -- it is one of forty things
            in a grid and its name is a label, not a pitch. */}
        {service ? (
          <h3 className="kl-display line-clamp-2 text-[0.9375rem] leading-[1.15] text-foreground
                         sm:text-[1.0625rem]">
            {item.name}
          </h3>
        ) : (
          <h3 className="truncate text-[0.8125rem] font-semibold leading-snug text-foreground">
            {item.name}
          </h3>
        )}

        {/* Description — only renders if present */}
        {item.description && (
          <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">
            {item.description}
          </p>
        )}

        {/* Price */}
        <div className="mt-1 flex items-baseline gap-2">
          {priceLabel.prefix && (
            <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {priceLabel.prefix}
            </span>
          )}
          {/* Caprasimo, tabular, solid ink. A price is the loudest FACT on
              the tile; it does not need a colour to be found. */}
          <p className="kl-money text-[1.375rem] leading-none text-foreground">
            ZMW {formatZmw(item.price_zmw)}
          </p>
          {discount !== null && (
            <p className="kl-money text-xs text-muted-foreground line-through">
              ZMW {formatZmw(item.original_price_zmw)}
            </p>
          )}
        </div>
        {priceLabel.prefix && (
          <p className="text-[10px] font-medium text-muted-foreground">Minimum service fee</p>
        )}

        {/* What that price actually buys.
            A wholesaler sells a case, and "K85" beside a photograph of one
            bottle -- where K85 buys twelve -- is an abandoned cart at best
            and a recipient handed an unexpected crate at worst. The unit
            belongs against the price, before the press, not on a detail
            page somebody reaches afterwards. Null means each, which is the
            overwhelming majority, so most tiles render nothing here. */}
        {(item.unit_of_sale || (item.minimum_order_quantity ?? 0) > 1) && (
          <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
            {item.unit_of_sale && <span>per {item.unit_of_sale}</span>}
            {item.unit_of_sale && (item.minimum_order_quantity ?? 0) > 1 && ' · '}
            {(item.minimum_order_quantity ?? 0) > 1 && (
              <span>min {item.minimum_order_quantity}</span>
            )}
          </p>
        )}

        {outOfStock && (
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {OUT_OF_STOCK_REASON}
          </p>
        )}

        {/* Scheduling note — sets the expectation before they tap through */}
        {item.requires_scheduling && (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <CalendarClock className="h-3 w-3 shrink-0" strokeWidth={2} />
            {item.lead_time_days
              ? `Book ${item.lead_time_days} day${item.lead_time_days === 1 ? '' : 's'} ahead`
              : 'Date arranged with the shop'}
          </p>
        )}

        {/* CTA Buttons */}
        <div className="mt-3 flex gap-2">
          {showAddToCart && onAddToCart && (
            /* Ink at rest, brand on hover -- the charter's add-to-bag. Ink
               because at rest this is furniture: twenty tiles each shouting
               in orange is twenty things claiming to be the one action on
               the screen. It becomes brand the moment you reach for it.

               Still a PILL, because it is a press. The label is still the
               mode's own word (addLabel) and the handler is untouched. */
            <button
              onClick={e => { e.stopPropagation(); onAddToCart(); }}
              className="flex h-[38px] flex-1 items-center justify-center gap-1 rounded-[var(--radius-pill)]
                         bg-ink text-xs font-semibold tracking-wide text-on-ink
                         transition-colors duration-200 hover:bg-primary hover:text-white
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                         active:scale-[0.98]"
            >
              <AddGlyph className="h-3.5 w-3.5" />
              {addLabel}
            </button>
          )}
          {handle && (
            <button
              onClick={e => { e.stopPropagation(); handle(); }}
              disabled={outOfStock}
              /* The outlined sibling. A pill too -- both of these are
                 presses, and the grammar does not bend for a secondary. */
              className={`h-[38px] flex-1 rounded-[var(--radius-pill)] border border-border-dark text-xs font-semibold
                         uppercase tracking-wide text-foreground
                         transition-colors duration-200
                         enabled:hover:border-ink enabled:hover:bg-ink enabled:hover:text-on-ink
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                         enabled:active:scale-[0.98]
                         disabled:cursor-not-allowed disabled:opacity-45
                         ${showAddToCart ? '' : 'w-full'}
                         ${service && !showAddToCart
                           ? 'border-transparent bg-ink text-on-ink enabled:hover:bg-primary enabled:hover:text-white'
                           : ''}`}
            >
              {outOfStock ? 'Sold out' : primaryLabel}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
