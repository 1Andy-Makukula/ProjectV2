// ShopCard — Merchant directory card with cover + overlapping circular logo
// Usage: <ShopCard shop={shop} onClick={() => navigate(`/shops/${shop.id}`)} />

import { MapPin, Store } from 'lucide-react';

export interface ShopCardProps {
  shop: {
    id: string;
    name: string;
    location?: string | null;
    cover_image_url?: string | null;
    /** Alias: image_url is used where cover_image_url doesn't exist yet */
    image_url?: string | null;
    logo_url?: string | null;
    description?: string | null;
  };
  onClick?: () => void;
  /** Optional item count badge */
  itemCount?: number;
}

function shopInitial(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

export function ShopCard({ shop, onClick, itemCount }: ShopCardProps) {
  const cover = shop.cover_image_url ?? shop.image_url ?? null;
  const logo  = shop.logo_url ?? null;

  return (
    <article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
      className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white
                 overflow-hidden cursor-pointer select-none
                 transition-all duration-300
                 hover:border-slate-300 hover:shadow-lg hover:-translate-y-0.5
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
    >
      {/* ── Cover image ─────────────────────────────────────────── */}
      <div className="relative w-full h-40 shrink-0 bg-slate-100 overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={`${shop.name} cover`}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          /* Gradient placeholder */
          <div className="w-full h-full bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200" />
        )}

        {/* Bottom scrim for legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />

        {/* Item count badge */}
        {itemCount !== undefined && (
          <div className="absolute top-3 right-3 rounded-full bg-white/90 backdrop-blur-sm
                          border border-slate-100 px-2.5 py-0.5 shadow-sm">
            <span className="text-[10px] font-semibold text-slate-600">
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>
        )}

        {/* ── Logo — overlaps the bottom-left of the cover ────── */}
        <div className="absolute -bottom-5 left-5">
          {logo ? (
            <img
              src={logo}
              alt={`${shop.name} logo`}
              className="h-12 w-12 rounded-full object-cover
                         border-4 border-white shadow-md bg-white"
            />
          ) : (
            <div
              className="h-12 w-12 rounded-full border-4 border-white shadow-md
                         flex items-center justify-center text-white text-base font-bold"
              style={{ background: 'linear-gradient(135deg,#f97316,#1e3a8a)' }}
            >
              {shopInitial(shop.name)}
            </div>
          )}
        </div>
      </div>

      {/* ── Body — top padding clears logo overlap ────────────── */}
      <div className="flex flex-col gap-1 px-5 pb-5 pt-8">
        <h3 className="truncate text-sm font-semibold text-slate-900 leading-snug">
          {shop.name}
        </h3>

        {shop.location && (
          <div className="flex items-center gap-1 text-slate-400">
            <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate text-xs">{shop.location}</span>
          </div>
        )}

        {shop.description && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500 leading-relaxed">
            {shop.description}
          </p>
        )}

        {/* Verified pill */}
        <div className="mt-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 rounded-full
                           bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase
                           tracking-wider text-green-700 ring-1 ring-green-100">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
            Verified
          </span>
          <Store className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" strokeWidth={1.5} />
        </div>
      </div>
    </article>
  );
}
