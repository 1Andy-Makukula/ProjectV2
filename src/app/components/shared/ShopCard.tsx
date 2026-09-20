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
                        px-2.5 py-1 text-[11px] font-semibold
                        ${openState.isOpen
                          ? 'bg-white text-foreground'
                          : 'bg-ink text-on-ink-soft'}`}
          >
            <span
              className={`size-1.5 rounded-full ${openState.isOpen ? 'bg-sage' : 'bg-on-ink-soft/60'}`}
              aria-hidden="true"
            />
            {openState.label}
          </span>
        )}

        {/* Bottom scrim for legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/40 via-transparent to-transparent opacity-60" />

        {/* Item count badge */}
        {/* An ink FACT block, and no longer in the same corner as the
            open/closed pill. Both were pinned to `right-4 top-4`, so a shop
            that had published hours AND had a count drew them on top of one
            another. Stacked rather than one of them dropped -- they are two
            different facts and both are worth having. */}
        {itemCount !== undefined && (
          <div
            className={`absolute right-4 rounded-[var(--radius-block)] bg-ink px-2 py-1
                        transition-transform duration-300 group-hover:-translate-y-0.5
                        ${openState ? 'top-[3.25rem]' : 'top-4'}`}
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-on-ink">
              <span className="kl-money">{itemCount}</span> {itemCount === 1 ? 'item' : 'items'}
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
          /* Flat brand fill, 2026-09-18. This was an inline
             linear-gradient(#f97316,#fb923c) -- a second orange, not the
             brand's, and an inline style in a codebase that forbids them.
             Colour arrives in flat blocks now; the initial-letter fallback
             itself is unchanged. */
          <div
            className="kl-display flex h-14 w-14 items-center justify-center rounded-full
                       border-[3px] border-white bg-primary text-lg text-white"
          >
            {shopInitial(shop.name)}
          </div>
        )}
      </div>

      {/* ── Body — top padding clears logo overlap ────────────── */}
      <div className="flex flex-col gap-1.5 px-5 pb-5 pt-9">
        <h3 className="kl-display truncate text-base text-foreground transition-colors duration-200 group-hover:text-primary">
          {shop.name}
        </h3>

        {shop.location && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate text-xs font-medium">{shop.location}</span>
          </div>
        )}

        {shop.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {shop.description}
          </p>
        )}

        {/* Verified pill */}
        <div className="mt-4 flex items-center justify-between border-t border-ink-50 pt-4">
          {/* The pill stays; only the blink goes. A dot pulsing on every
              card in a long feed is twenty things asking for attention, and
              verification is a standing fact, not an event. */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-paper px-2.5 py-1
                           text-[10px] font-bold uppercase tracking-[0.06em] text-sage-deep">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-sage" />
            Verified Partner
          </span>
          {/* An unrated shop shows the store glyph rather than an empty score:
              it has not been judged badly, it has not been judged at all. */}
          {rating !== null ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
              <Star className="h-3.5 w-3.5 fill-current text-brass" strokeWidth={0} />
              <span className="kl-money">{rating.toFixed(1)}</span>
              <span className="kl-money font-normal text-muted-foreground">({shop.rating_count})</span>
            </span>
          ) : (
            <Store className="h-4 w-4 text-brand-200 group-hover:text-primary transition-colors" strokeWidth={1.5} />
          )}
        </div>
      </div>
    </article>
  );
}
