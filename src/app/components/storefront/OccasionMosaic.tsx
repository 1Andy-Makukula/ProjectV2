import { useNavigate } from 'react-router';
import { Skeleton } from '../ui/skeleton';
import { OccasionTile } from './OccasionTile';
import { useConciergeThread } from '../../hooks/useConciergeThread';
import type { OccasionTile as Tile } from '../../hooks/useOccasionTiles';

/**
 * The front door, as a bento of photographic panels.
 *
 * Four panels tile two rows on a six-column grid — a wide one beside a narrow
 * one, then the reverse — so the grid reads as composed rather than as a
 * carousel of equal cards, and never leaves a hole no matter how many
 * occasions are curated. On a phone every panel is full width, because a
 * bento squeezed into 180px is just a small grid.
 *
 * Two panels are not occasions at all:
 *
 *   - the concierge, which is the only tile that works on day one, when
 *     nothing is curated and the honest offer is "tell us and we will find it"
 *   - the full catalogue, so the local shopper is never walled behind an
 *     intent they do not have
 *
 * Both sit in the grid rather than beside it, because a tile is a thing you
 * tap and a link under a grid is a thing you miss.
 */

/** Span and type scale by position. Every group of four tiles fills two rows. */
const LAYOUT: Array<{ span: string; scale: 'sm' | 'md' | 'lg' }> = [
  { span: 'col-span-2 sm:col-span-4 min-h-[240px] sm:min-h-[340px]', scale: 'lg' },
  { span: 'col-span-2 sm:col-span-2 min-h-[240px] sm:min-h-[340px]', scale: 'md' },
  { span: 'col-span-2 sm:col-span-2 min-h-[200px] sm:min-h-[260px]', scale: 'md' },
  { span: 'col-span-2 sm:col-span-4 min-h-[200px] sm:min-h-[260px]', scale: 'lg' },
];

const slot = (i: number) => LAYOUT[i % LAYOUT.length];

interface OccasionMosaicProps {
  tiles: Tile[];
  loading: boolean;
}

export function OccasionMosaic({ tiles, loading }: OccasionMosaicProps) {
  const navigate = useNavigate();
  const { askKithly, opening } = useConciergeThread();

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {LAYOUT.map((l, i) => (
          <Skeleton key={i} className={`rounded-[var(--radius-tile)] ${l.span}`} />
        ))}
      </div>
    );
  }

  // The concierge goes third when there is enough curated to lead with, and
  // first when there is not — an empty shelf that still takes an order.
  const entries: Array<{ key: string; render: (i: number) => React.ReactNode }> = [];

  const occasionEntries = tiles.map((tile) => ({
    key: tile.slug,
    render: (i: number) => (
      <OccasionTile
        key={tile.slug}
        title={tile.label}
        subtitle={`${tile.bundleCount} ${tile.bundleCount === 1 ? 'bundle' : 'bundles'} ready to send`}
        images={tile.images}
        phase={i * 700}
        {...slot(i)}
        onOpen={() => navigate(`/occasion/${tile.slug}`)}
      />
    ),
  }));

  const concierge = {
    key: 'concierge',
    render: (i: number) => (
      <OccasionTile
        key="concierge"
        title="Can’t find it? We’ll source it."
        subtitle="Tell us what you need. We buy it in Lusaka and send you a price to approve."
        images={[]}
        gradient
        {...slot(i)}
        onOpen={() => {
          if (!opening) askKithly('A custom request');
        }}
      />
    ),
  };

  const catalogue = {
    key: 'catalogue',
    render: (i: number) => (
      <OccasionTile
        key="catalogue"
        title="Explore the full catalogue"
        subtitle="Every shop, every item — browse it the ordinary way."
        images={[]}
        gradient
        {...slot(i)}
        onOpen={() => navigate('/shops')}
      />
    ),
  };

  if (occasionEntries.length >= 2) {
    entries.push(occasionEntries[0], occasionEntries[1], concierge, ...occasionEntries.slice(2));
  } else {
    entries.push(concierge, ...occasionEntries);
  }
  entries.push(catalogue);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
      {entries.map((entry, i) => entry.render(i))}
    </div>
  );
}
