// TileMosaic — the front door's arrangement of pressable tiles.
//
// A grid of equal squares is a menu; a mosaic where some things are twice the
// size of their neighbour is an arrangement, and an arrangement says somebody
// decided. That is the whole argument for the uneven rhythm here.
//
// The rhythm is a repeating six-column pattern — wide+narrow, narrow+wide,
// then one full band — so every row closes exactly and the mosaic never ends
// ragged regardless of how many tiles it is given.
//
// DELIBERATELY IGNORANT OF WHAT A TILE MEANS. It takes a name, a picture and a
// handler. The Send Home rail feeds it occasions; the Browse rail feeds it
// categories; nothing in here knows the difference, which is what lets the two
// rails share one component instead of growing two that drift apart.
// (Was `CategoryTiles` until it had a second caller.)

import { Skeleton } from '../ui/skeleton';
import { BreathingImage } from './BreathingImage';

/**
 * How long one picture is held before the next fades in.
 *
 * Thirty seconds, which is a long time for an animation and the right amount
 * for this one. These tiles are large and sit beside copy asking somebody to
 * trust us with money; anything quicker turns the page into something moving
 * in your peripheral vision while you read, which is the single most reliable
 * way to make a page feel cheap. The Conductor's house cycle of nine seconds
 * is tuned for small product tiles in a dense grid and is far too eager here.
 */
const DWELL_MS = 30_000;

/** The least a thing needs to be to sit in the mosaic. */
export interface MosaicTile {
  id: string;
  name: string;
  /** Cover first; anything after it is what the tile breathes through. */
  images: string[];
  /** One line under the name. Drawn only where the tile is wide enough. */
  blurb?: string;
  /** Suppresses hover lift and any loud treatment. See OccasionTile.quiet. */
  quiet?: boolean;
}

export interface TileMosaicProps {
  tiles: MosaicTile[];
  loading?: boolean;
  onSelect: (tile: MosaicTile) => void;
  /** Accessible name for the grid, since it carries no visible heading. */
  label: string;
}

/**
 * Column spans, in the order they repeat. 4+2, 2+4, 6.
 *
 * Every row sums to six, which is what keeps the mosaic flush on both edges
 * without a single explicit row break.
 */
const SPANS = [4, 2, 2, 4, 6] as const;

/** The pattern positions that leave a row half-open when they land last. */
const OPENS_A_ROW = new Set([0, 2]);

/** Skeletons while the source is in flight: enough to state the shape. */
const PLACEHOLDER_COUNT = 4;

function mosaicSpans(count: number): number[] {
  const spans = Array.from({ length: count }, (_, i) => SPANS[i % SPANS.length] as number);

  // Close the final row. Positions 0 and 2 expect a partner that a short list
  // never supplies, and a 4-wide tile with a 2-wide hole beside it looks like
  // something failed to load rather than like a composition.
  const last = spans.length - 1;
  if (last >= 0 && OPENS_A_ROW.has(last % SPANS.length)) spans[last] = 6;

  return spans;
}

/** Tailwind needs whole class names, so these are spelled out, not built. */
const SPAN_CLASS: Record<number, string> = {
  2: 'col-span-6 md:col-span-2',
  4: 'col-span-6 md:col-span-4',
  6: 'col-span-6',
};

/**
 * A full band is shorter than the tiles flanking each other.
 *
 * Partners in the same row must agree, and 4 and 2 are always partners, so
 * they share a height and only the 6 differs.
 */
function heightClass(span: number): string {
  return span === 6 ? 'h-44 md:h-52' : 'h-52 md:h-64';
}

function titleClass(span: number): string {
  if (span === 6) return 'text-4xl md:text-6xl';
  if (span === 4) return 'text-3xl md:text-5xl';
  return 'text-2xl md:text-3xl';
}

function Tile({
  tile,
  span,
  index,
  onSelect,
}: {
  tile: MosaicTile;
  span: number;
  index: number;
  onSelect: (tile: MosaicTile) => void;
}) {
  // A blurb needs room to be read. On a 2-wide tile it would set to two words
  // a line under a 30px display face, which is worse than no blurb at all.
  const showBlurb = Boolean(tile.blurb) && span >= 4;
  const hasArt = tile.images.length > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(tile)}
      className={`group relative overflow-hidden rounded-[var(--radius-tile)] text-left
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  focus-visible:ring-offset-2 ${tile.quiet ? '' : 'kl-lift'}
                  ${SPAN_CLASS[span]} ${heightClass(span)}`}
    >
      {/* Motion is the Conductor's to give out, not this component's to take.
          One clock for the whole page means the tiles change in a slow wave
          rather than as popcorn, never more than the motion budget at once,
          never off screen, never in a hidden tab, and never at all for
          somebody who has asked their system to calm animations down. */}
      <BreathingImage
        id={tile.id}
        sources={tile.images}
        alt=""
        dwellMs={DWELL_MS}
        /* h-full w-full, NOT `absolute inset-0`.
           BreathingImage renders its host as `relative ${className}`, and in
           the built stylesheet `.relative` is emitted AFTER `.absolute` at
           equal specificity -- so `relative` wins, `inset-0` does nothing on
           it, and the host collapses to zero height because every frame
           inside is absolute. The result is a tile with no picture at all.
           This is the same cascade trap theme.css already records for
           .kl-rim's position beating Tailwind's `fixed`. Size the host and
           let it stay relative; the frames position against it. */
        className="h-full w-full"
        /* Platform furniture, not a shop's own photograph: washed so the name
           on top of it survives and so a shelf never out-shouts the
           merchandise it is pointing at. */
        imageClassName="h-full w-full object-cover kl-wash-furniture"
        fallback={
          /* No picture is a fine state, not a broken one. A flat block with
             the word on it is the same grammar as the rest of the language.

             Alternating the two inks rather than sitting on one: two greys
             apart is enough for the tiles to read as separate objects instead
             of one black shape with gaps in it, and neither spends a colour
             that means something elsewhere -- brand is act-now, brass is
             escrow, sage is verified, and a shelf is none of those. */
          <div
            className={`h-full w-full ${index % 2 === 0 ? 'bg-ink' : 'bg-ink-soft'}`}
          />
        }
      />

      {/* The scrim earns the type its contrast without tinting the whole
          picture. Bottom-weighted, because that is where the name sits, and
          drawn in --ink so it is the same black as the chrome rather than a
          second one arriving from nowhere. */}
      {hasArt && (
        <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/30 to-ink/5" />
      )}

      <span className="absolute bottom-0 left-0 right-0 p-5">
        <span className={`kl-display block tracking-[-0.03em] text-on-ink ${titleClass(span)}`}>
          {tile.name}
        </span>
        {showBlurb && (
          <span className="mt-1.5 block max-w-md text-sm font-light leading-snug text-on-ink-soft">
            {tile.blurb}
          </span>
        )}
      </span>
    </button>
  );
}

export function TileMosaic({ tiles, loading = false, onSelect, label }: TileMosaicProps) {
  // Nothing to show hides the mosaic rather than rendering an apology. The
  // page around it does not depend on this section existing.
  const showPlaceholders = loading && tiles.length === 0;
  if (!showPlaceholders && tiles.length === 0) return null;

  const spans = mosaicSpans(showPlaceholders ? PLACEHOLDER_COUNT : tiles.length);

  return (
    <div className="grid grid-cols-6 gap-3 md:gap-4" role="group" aria-label={label}>
      {showPlaceholders
        ? spans.map((span, i) => (
            <Skeleton
              key={i}
              className={`rounded-[var(--radius-tile)] ${SPAN_CLASS[span]} ${heightClass(span)}`}
            />
          ))
        : tiles.map((tile, i) => (
            <Tile
              key={tile.id}
              tile={tile}
              span={spans[i] ?? 6}
              index={i}
              onSelect={onSelect}
            />
          ))}
    </div>
  );
}
