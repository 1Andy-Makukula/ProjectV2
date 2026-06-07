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
  const logo = shop.logo_url ?? null;

  return (
    <article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
      className="group relative flex flex-col rounded-2xl border border-orange-100/50 bg-white
                 overflow-hidden cursor-pointer select-none shadow-sm
                 transition-all duration-300
                 hover:border-orange-200 hover:shadow-[0_12px_30px_-10px_rgba(249,115,22,0.15)] hover:-translate-y-1
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      {/* ── Cover image ─────────────────────────────────────────── */}
      <div className="relative w-full h-48 shrink-0 bg-orange-50 overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={`${shop.name} cover`}
            className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
        ) : (
          /* Gradient placeholder */
          <div className="w-full h-full bg-gradient-to-br from-orange-50 via-orange-100/50 to-amber-50" />
        )}

        {/* Bottom scrim for legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 via-transparent to-transparent opacity-60" />

        {/* Item count badge */}
        {itemCount !== undefined && (
          <div className="absolute top-4 right-4 rounded-full bg-white/95 backdrop-blur-md
                          border border-orange-100/50 px-3 py-1 shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5">
            <span className="text-[11px] font-semibold tracking-wide text-orange-700">
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>
        )}
      </div>

      {/* ── Logo — overlaps the bottom-left of the cover ────── */}
      <div className="absolute top-[164px] left-5 z-10">
        {logo ? (
          <img
            src={logo}
            alt={`${shop.name} logo`}
            className="h-14 w-14 rounded-full object-cover
                       border-[3px] border-white shadow-sm bg-white"
          />
        ) : (
          <div
            className="h-14 w-14 rounded-full border-[3px] border-white shadow-sm
                       flex items-center justify-center text-white text-lg font-bold"
            style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)' }}
          >
            {shopInitial(shop.name)}
          </div>
        )}
      </div>

      {/* ── Body — top padding clears logo overlap ────────────── */}
      <div className="flex flex-col gap-1.5 px-5 pb-5 pt-9">
        <h3 className="truncate text-base font-semibold text-slate-900 group-hover:text-primary transition-colors duration-200">
          {shop.name}
        </h3>

        {shop.location && (
          <div className="flex items-center gap-1.5 text-slate-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate text-xs font-medium">{shop.location}</span>
          </div>
        )}

        {shop.description && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500 leading-relaxed group-hover:text-slate-600 transition-colors">
            {shop.description}
          </p>
        )}

        {/* Verified pill */}
        <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full
                           bg-gradient-to-r from-emerald-50 to-green-50 px-2.5 py-1 text-[10px] font-bold uppercase
                           tracking-wider text-emerald-700 ring-1 ring-emerald-200/50">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
            Verified Partner
          </span>
          <Store className="h-4 w-4 text-orange-200 group-hover:text-primary transition-colors" strokeWidth={1.5} />
        </div>
      </div>
    </article>
  );
}
