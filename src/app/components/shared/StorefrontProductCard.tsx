// StorefrontProductCard — Weekly picks / storefront item card
// Usage: <StorefrontProductCard item={item} onGift={() => navigate(`/send/${item.id}`)} />
// Named StorefrontProductCard to avoid conflict with the existing ProductCard.tsx

import { Package, Shield, ShoppingCart } from 'lucide-react';

export interface StorefrontItem {
  id: string;
  name: string;
  description?: string | null;
  /** Price in whole ZMW (price_zmw column) */
  price_zmw: number;
  image_url?: string | null;
  is_weekly_pick?: boolean;
  /** Optional free-form badge text e.g. "Sale" or "New" */
  promo_badge_text?: string | null;
  shop?: { id: string; name: string } | null;
}

interface StorefrontProductCardProps {
  item: StorefrontItem;
  onGift?: () => void;
  onView?: () => void;
  onAddToCart?: () => void;
}

export function StorefrontProductCard({ item, onGift, onView, onAddToCart }: StorefrontProductCardProps) {
  const handle = onGift ?? onView;
  const badge = item.is_weekly_pick ? 'Top Pick' : (item.promo_badge_text ?? null);

  return (
    <article
      className="group relative flex flex-col rounded-2xl border border-slate-100 bg-white
                 overflow-hidden transition-all duration-300
                 hover:border-slate-200 hover:shadow-md"
    >
      {/* ── Image block ─────────────────────────────────────────── */}
      <div className="relative w-full aspect-square overflow-hidden bg-slate-50 shrink-0">
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
            <Package className="h-10 w-10 text-slate-200" strokeWidth={1} />
          </div>
        )}

        {/* Merchandising badge — top-right corner */}
        {badge && (
          <div className="absolute top-2.5 right-2.5">
            <span
              className="inline-block rounded-full px-2.5 py-0.5
                         text-[10px] font-bold uppercase tracking-wider
                         border border-orange-200 bg-white/90 backdrop-blur-sm text-orange-600
                         shadow-sm"
            >
              {badge}
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
        <p className="mt-1 text-sm font-semibold text-slate-900">
          ZMW {item.price_zmw != null ? (item.price_zmw / 100).toFixed(2) : '—'}
        </p>

        {/* CTA Buttons */}
        <div className="mt-3 flex gap-2">
          {onAddToCart && (
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
              className={`flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold
                         text-slate-700 tracking-wide uppercase
                         hover:border-slate-900 hover:bg-slate-900 hover:text-white
                         active:scale-[0.98] transition-all duration-200
                         ${onAddToCart ? '' : 'w-full'}`}
            >
              {onGift ? 'Gift This' : 'View'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
