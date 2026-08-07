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
  type CatalogItem,
} from '../../types/items';

export type StorefrontItem = CatalogItem;

interface StorefrontProductCardProps {
  item: StorefrontItem;
  onGift?: () => void;
  onView?: () => void;
  onAddToCart?: () => void;
}

function formatZmw(ngwee: number | null | undefined): string {
  return ngwee != null ? (ngwee / 100).toFixed(2) : '—';
}

export function StorefrontProductCard({ item, onGift, onView, onAddToCart }: StorefrontProductCardProps) {
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
      className="group relative flex flex-col rounded-2xl border border-slate-100 bg-white
                 overflow-hidden transition-all duration-300
                 hover:border-slate-200 hover:shadow-md"
    >
      {/* ── Image block ─────────────────────────────────────────── */}
      {/* Sold out is greyed rather than hidden: the buyer can see the shop
          stocks it and come back. Hiding it is what is_available does. */}
      <div
        className={`relative w-full aspect-square overflow-hidden bg-slate-50 shrink-0
                    ${outOfStock ? 'opacity-45 grayscale' : ''}`}
      >
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-full object-cover
                       transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          /* Gradient placeholder — no image */
          <div className="w-full h-full bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100
                          flex items-center justify-center">
            {service ? (
              <ConciergeBell className="h-10 w-10 text-slate-200" strokeWidth={1} />
            ) : (
              <Package className="h-10 w-10 text-slate-200" strokeWidth={1} />
            )}
          </div>
        )}

        {/* Discount / merchandising badge — top-right corner */}
        {(discount !== null || badge) && (
          <div className="absolute top-2.5 right-2.5">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5
                          text-[10px] font-bold uppercase tracking-wider
                          backdrop-blur-sm shadow-sm border
                          ${discount !== null
                            ? 'border-transparent bg-orange-600 text-white'
                            : 'border-orange-200 bg-white/90 text-orange-600'}`}
            >
              {discount !== null ? `${discount}% off` : badge}
            </span>
          </div>
        )}

        {/* Service marker — top-left, so it never collides with the badge */}
        {service && (
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1
                          rounded-full bg-white/90 backdrop-blur-sm border border-slate-100
                          px-2 py-0.5 shadow-sm">
            <ConciergeBell className="h-2.5 w-2.5 text-slate-500 shrink-0" strokeWidth={2} />
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-600">
              Service
            </span>
          </div>
        )}

        {/* Escrow shield — bottom-left */}
        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1
                        rounded-full bg-white/90 backdrop-blur-sm border border-slate-100
                        px-2 py-0.5 shadow-sm">
          <Shield className="h-2.5 w-2.5 text-orange-500 shrink-0" strokeWidth={2} />
          <span className="text-[9px] font-bold uppercase tracking-wide text-orange-600">
            Escrow
          </span>
        </div>
      </div>

      {/* ── Info block ──────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 gap-1 px-4 py-3">
        {/* Merchant */}
        {item.shop?.name && (
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 truncate">
            {item.shop.name}
          </p>
        )}

        {/* Name */}
        <h3 className="text-sm font-semibold text-slate-900 truncate leading-snug">
          {item.name}
        </h3>

        {/* Description — only renders if present */}
        {item.description && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400 leading-snug">
            {item.description}
          </p>
        )}

        {/* Price */}
        <div className="mt-1 flex items-baseline gap-2">
          {priceLabel.prefix && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {priceLabel.prefix}
            </span>
          )}
          <p className="text-sm font-semibold text-slate-900">
            ZMW {formatZmw(item.price_zmw)}
          </p>
          {discount !== null && (
            <p className="text-[11px] text-slate-400 line-through">
              ZMW {formatZmw(item.original_price_zmw)}
            </p>
          )}
        </div>
        {priceLabel.prefix && (
          <p className="text-[10px] font-medium text-slate-500">Minimum service fee</p>
        )}

        {outOfStock && (
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {OUT_OF_STOCK_REASON}
          </p>
        )}

        {/* Scheduling note — sets the expectation before they tap through */}
        {item.requires_scheduling && (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-slate-500">
            <CalendarClock className="h-3 w-3 shrink-0" strokeWidth={2} />
            {item.lead_time_days
              ? `Book ${item.lead_time_days} day${item.lead_time_days === 1 ? '' : 's'} ahead`
              : 'Date arranged with the shop'}
          </p>
        )}

        {/* CTA Buttons */}
        <div className="mt-3 flex gap-2">
          {showAddToCart && onAddToCart && (
            <button
              onClick={e => { e.stopPropagation(); onAddToCart(); }}
              className="flex-1 flex items-center justify-center gap-1 rounded-xl border border-orange-200 py-2 text-xs font-semibold
                         text-orange-600 tracking-wide
                         hover:border-orange-400 hover:bg-orange-50
                         active:scale-[0.98] transition-all duration-200"
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              Add
            </button>
          )}
          {handle && (
            <button
              onClick={e => { e.stopPropagation(); handle(); }}
              disabled={outOfStock}
              className={`flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold
                         text-slate-700 tracking-wide uppercase
                         enabled:hover:border-slate-900 enabled:hover:bg-slate-900 enabled:hover:text-white
                         enabled:active:scale-[0.98] transition-all duration-200
                         disabled:cursor-not-allowed disabled:text-slate-400
                         ${showAddToCart ? '' : 'w-full'}`}
            >
              {outOfStock ? 'Sold out' : primaryLabel}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
