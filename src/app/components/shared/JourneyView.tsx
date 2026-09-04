// The storyboard — a list read as a journey.
//
// A scrapbook page rather than a product grid: paper ground, a wax seal
// numbering each stop, a dotted route threading between them, the photograph
// taped down slightly askew, and the curator's own words beside it in a hand.
//
// Everything here is CSS and markup. There is not one image file, one animation
// or one scroll listener in it, and that is the design rather than a shortcut:
// this is a long page of photographs that people will read on cheap Android
// handsets over slow connections, and a page that stutters while you read it
// undoes whatever the decoration bought. The tilts are transforms, which cost
// the compositor nothing; the grain is a repeating gradient measured in bytes.

import { MapPin, Package, ShoppingCart, Store } from 'lucide-react';
import { Button } from '../ui/button';
import { formatCurrency } from '../../../utils/currency';
import {
  ENTRY_UNAVAILABLE_TEXT,
  entryDisplay,
  entryUnavailableReason,
  isBuyableEntry,
  listAuthorLabel,
  type ListDetail,
  type ListEntry,
} from '../../types/lists';

interface JourneyViewProps {
  list: ListDetail;
  /** Adds one stop's item to the cart. */
  onAdd: (entry: ListEntry) => void;
  /** Opens a shop stop. */
  onVisitShop: (shopId: string) => void;
  addLabel?: string;
}

/**
 * Four tilts, cycled.
 *
 * Enough that no two neighbours share an angle and the column reads as placed
 * by hand; few enough that it never looks like an effect. Chosen by position
 * rather than at random, so the page looks identical every time it is opened —
 * a journey somebody shared should not rearrange itself between viewings.
 */
const TILTS = ['kl-tilt-1', 'kl-tilt-2', 'kl-tilt-3', 'kl-tilt-4'];

export function JourneyView({ list, onAdd, onVisitShop, addLabel = 'Add' }: JourneyViewProps) {
  const stops = list.entries;

  return (
    <article className="kl-paper rounded-[var(--radius-modal)] px-4 py-8 sm:px-8 sm:py-12">
      {/* ── The cover ─────────────────────────────────────────────────── */}
      <header className="mx-auto max-w-2xl text-center">
        <p className="kl-hand text-[1.05rem]">a journey by {listAuthorLabel(list)}</p>

        <h1 className="kl-paper-display mt-1 text-3xl leading-tight sm:text-5xl">
          {list.title}
        </h1>

        {list.description && (
          <p className="kl-hand mx-auto mt-3 max-w-lg text-[1.1rem]">{list.description}</p>
        )}

        <div className="mx-auto mt-5 flex items-center justify-center gap-3">
          <span className="h-px w-10 bg-[var(--paper-line)]" />
          <span className="kl-paper-display text-xs uppercase tracking-[0.22em] text-[var(--paper-ink-soft)]">
            {stops.length} stop{stops.length === 1 ? '' : 's'}
          </span>
          <span className="h-px w-10 bg-[var(--paper-line)]" />
        </div>
      </header>

      {/* ── The stops ─────────────────────────────────────────────────── */}
      <div className="mx-auto mt-10 max-w-2xl">
        {stops.map((entry, index) => (
          <Stop
            key={entry.id}
            entry={entry}
            index={index}
            isLast={index === stops.length - 1}
            onAdd={() => onAdd(entry)}
            onVisitShop={onVisitShop}
            addLabel={addLabel}
          />
        ))}

        {stops.length === 0 && (
          <p className="kl-hand py-12 text-center text-[1.15rem]">
            Nothing on this journey yet.
          </p>
        )}
      </div>

      {/* ── The end ───────────────────────────────────────────────────── */}
      {stops.length > 0 && (
        <footer className="mx-auto mt-10 max-w-2xl text-center">
          <span className="kl-hand text-[1.15rem]">— end of the journey —</span>
        </footer>
      )}
    </article>
  );
}

function Stop({
  entry,
  index,
  isLast,
  onAdd,
  onVisitShop,
  addLabel,
}: {
  entry: ListEntry;
  index: number;
  isLast: boolean;
  onAdd: () => void;
  onVisitShop: (shopId: string) => void;
  addLabel: string;
}) {
  const reason = entryUnavailableReason(entry);
  const { name, imageUrl } = entryDisplay(entry);
  const buyable = isBuyableEntry(entry);
  const isShop = entry.entry_kind === 'shop';
  const shopName = isShop ? entry.shop?.location : entry.item?.shop?.name;

  return (
    <section className="flex gap-4">
      {/* The gutter: the seal, and the route running on to the next stop. */}
      <div className="flex flex-col items-center">
        <div className="kl-seal">{index + 1}</div>
        {!isLast && <div className="kl-route" />}
      </div>

      <div className={`min-w-0 flex-1 ${isLast ? 'pb-2' : 'pb-10'}`}>
        {/* The photograph, taped down. */}
        <div className={`${TILTS[index % TILTS.length]} kl-photo`}>
          <span
            aria-hidden
            className={`kl-tape ${index % 2 === 0 ? 'kl-tape--tl' : 'kl-tape--tr'}`}
          />

          <div
            className={`aspect-[4/3] w-full overflow-hidden bg-[var(--paper-deep)]
                        ${reason ? 'opacity-45 grayscale' : ''}`}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={name}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center">
                {isShop ? (
                  <Store className="size-8 text-[var(--paper-ink-soft)]/40" strokeWidth={1.25} />
                ) : (
                  <Package className="size-8 text-[var(--paper-ink-soft)]/40" strokeWidth={1.25} />
                )}
              </div>
            )}
          </div>

          {/* The caption, written on the photo's own margin. */}
          <div className="mt-2 flex items-baseline gap-2 px-1">
            <h2 className="kl-paper-display min-w-0 flex-1 truncate text-base">{name}</h2>
            {buyable && entry.item && (
              <span className="kl-paper-display shrink-0 text-sm">
                {formatCurrency(entry.item.price_zmw, 'ZMW')}
              </span>
            )}
          </div>

          {shopName && (
            <p className="kl-hand px-1 text-[0.95rem]">
              <MapPin className="mb-0.5 mr-0.5 inline size-3" strokeWidth={2} />
              {shopName}
            </p>
          )}
        </div>

        {/* What the curator said about this stop. */}
        {entry.note && (
          <p className="kl-hand kl-margin-note mt-4 text-[1.15rem]">{entry.note}</p>
        )}

        {/* What you can do about it. */}
        <div className="mt-4 flex items-center gap-3">
          {reason ? (
            <span className="kl-hand text-[1.05rem]">{ENTRY_UNAVAILABLE_TEXT[reason]}</span>
          ) : isShop ? (
            <Button variant="outline" size="sm" onClick={() => onVisitShop(entry.shop!.id)}>
              <Store className="size-3.5" strokeWidth={2} />
              Visit this shop
            </Button>
          ) : (
            <Button size="sm" onClick={onAdd}>
              <ShoppingCart className="size-3.5" strokeWidth={2} />
              {addLabel} this stop
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
