// ShopCard — Merchant directory card with cover + overlapping circular logo
// Usage: <ShopCard shop={shop} onClick={() => navigate(`/shops/${shop.id}`)} />

import { MapPin, Star, Store } from 'lucide-react';
import { shopOpenState } from '../../../utils/openingHours';
import { shopRating } from '../../types/shops';
import { SaveToListButton } from './SaveToListButton';
import { WatchButton } from './WatchButton';

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
    /** KithLy Rating aggregate; absent or zero means nobody has rated yet. */
    rating_count?: number | null;
    rating_sum?: number | null;
    /** Published trading hours. Absent means nothing is claimed either way. */
    opening_hours?: unknown | null;
  };
  onClick?: () => void;
  /** Optional item count badge */
  itemCount?: number;
}

function shopInitial(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

export function ShopCard({ shop, onClick, itemCount }: ShopCardProps) {
  const rating = shopRating(shop);
  const cover = shop.cover_image_url ?? shop.image_url ?? null;

  // The city waking up. A shop that has published hours looks different at
  // 7am and at 11pm -- honest, daily motion that needs no new data and no
  // animation at all. A shop that has published none renders exactly as
  // before: shopOpenState returns null, and claiming "closed" about a shop
  // that never said would be worse than saying nothing.
  const openState = shopOpenState(shop.opening_hours);
  const logo = shop.logo_url ?? null;

  return (
    <article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
      className="kl-tile kl-lift group relative flex flex-col overflow-hidden
                 cursor-pointer select-none
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* ── Cover image ─────────────────────────────────────────── */}
      <div className="relative w-full h-48 shrink-0 bg-brand-50 overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={`${shop.name} cover`}
            className={`w-full h-full object-cover transition-[transform,filter,opacity] duration-700 ease-out group-hover:scale-105
                        ${openState?.isOpen === false ? 'brightness-[0.72] saturate-[0.6]' : ''}`}
          />
        ) : (
          /* Gradient placeholder */
          <div className="w-full h-full bg-gradient-to-br from-brand-50 via-brand-100/50 to-warn-50" />
        )}

        {/* Open or shut, said plainly. Only ever rendered when the shop has
            actually published hours. */}
        {openState && (
          <span
            className={`absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full
                        px-2.5 py-1 text-[0.6875rem] font-medium backdrop-blur-sm
                        ${openState.isOpen
                          ? 'bg-white/90 text-[var(--success)]'
                          : 'bg-ink-900/70 text-white/90'}`}
          >
            <span
              className={`size-1.5 rounded-full ${openState.isOpen ? 'bg-[var(--success)]' : 'bg-white/60'}`}
              aria-hidden="true"
            />
            {openState.label}
          </span>
        )}

        {/* Bottom scrim for legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/40 via-transparent to-transparent opacity-60" />

        {/* Item count badge */}
        {itemCount !== undefined && (
          <div className="absolute top-4 right-4 rounded-full bg-white/95 backdrop-blur-md
                          border border-brand-100/50 px-3 py-1 shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5">
            <span className="text-[11px] font-semibold tracking-wide text-brand-700">
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>
        )}

        {/* Save the shop itself to a list — the card is a button, so this
            stops the click from also opening the storefront. */}
        <div className="absolute top-4 left-4 flex items-center gap-1.5">
          <SaveToListButton
            target={{
              kind: 'shop',
              id: shop.id,
              name: shop.name,
              image_url: shop.cover_image_url ?? shop.image_url ?? shop.logo_url ?? null,
            }}
          />
          {/* A shop watch covers everything it sells, which is the point:
              you rarely know which item will be the one to drop. */}
          <WatchButton shopId={shop.id} />
        </div>
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
        <h3 className="truncate text-base font-semibold text-ink-900 group-hover:text-primary transition-colors duration-200">
          {shop.name}
        </h3>

        {shop.location && (
          <div className="flex items-center gap-1.5 text-ink-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate text-xs font-medium">{shop.location}</span>
          </div>
        )}

        {shop.description && (
          <p className="mt-1 line-clamp-2 text-xs text-ink-500 leading-relaxed group-hover:text-ink-600 transition-colors">
            {shop.description}
          </p>
        )}

        {/* Verified pill */}
        <div className="mt-4 flex items-center justify-between border-t border-ink-50 pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full
                           bg-gradient-to-r from-ok-50 to-ok-50 px-2.5 py-1 text-[10px] font-bold uppercase
                           tracking-wider text-ok-700 ring-1 ring-ok-200/50">
            <span className="h-1.5 w-1.5 rounded-full bg-ok-500 animate-pulse inline-block" />
            Verified Partner
          </span>
          {/* An unrated shop shows the store glyph rather than an empty score:
              it has not been judged badly, it has not been judged at all. */}
          {rating !== null ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-600">
              <Star className="h-3.5 w-3.5 fill-current text-warn-500" strokeWidth={0} />
              {rating.toFixed(1)}
              <span className="text-ink-400">({shop.rating_count})</span>
            </span>
          ) : (
            <Store className="h-4 w-4 text-brand-200 group-hover:text-primary transition-colors" strokeWidth={1.5} />
          )}
        </div>
      </div>
    </article>
  );
}
