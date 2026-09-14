// VitalityPanel — what your shop is worth to the storefront, and what to do next.
//
// This is the supply side of the aliveness plan. Tiles cannot flip through
// galleries nobody has filled, so the shopkeeper has to want to fill them, and
// wanting comes from seeing what it buys. Hence the reward line under the
// score: not "you are at 46" but "your tiles move on the storefront".
//
// One instruction at a time, deliberately. A checklist of eight things is a
// checklist nobody starts; the weakest fixable component is the only one shown.

import { ArrowRight, Camera, Images, ListTree, Clock, Package } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  useShopVitality,
  vitalityBand,
  vitalityReward,
  type ShopVitality,
} from '../../hooks/useShopVitality';

interface VitalityPanelProps {
  shopId: string | null | undefined;
}

const BAND_CLASS: Record<ReturnType<typeof vitalityBand>, string> = {
  low: 'text-muted-foreground',
  fair: 'text-[var(--primary)]',
  good: 'text-[var(--primary)]',
  strong: 'text-[var(--success)]',
};

/** The components, in the order the score weights them. */
function componentRows(v: ShopVitality) {
  return [
    {
      key: 'gallery',
      icon: Images,
      label: 'Photographs per item',
      value: v.avg_images_per_item.toFixed(1),
      of: 'of 5',
      fill: v.gallery_depth,
    },
    {
      key: 'covers',
      icon: Camera,
      label: 'Items with a photograph',
      value: `${Math.round(v.cover_coverage * 100)}%`,
      of: '',
      fill: v.cover_coverage,
    },
    {
      key: 'catalogue',
      icon: Package,
      label: 'Items listed',
      value: String(v.item_count),
      of: v.item_count < 20 ? 'of 20' : '',
      fill: v.catalogue_size,
    },
    {
      key: 'collections',
      icon: ListTree,
      label: 'Collections',
      value: String(v.collection_count),
      of: v.collection_count < 3 ? 'of 3' : '',
      fill: v.organisation,
    },
    {
      key: 'hours',
      icon: Clock,
      label: 'Opening hours',
      value: v.has_opening_hours ? 'Set' : 'Not set',
      of: '',
      fill: v.hours_set,
    },
  ];
}

export function VitalityPanel({ shopId }: VitalityPanelProps) {
  const navigate = useNavigate();
  const { vitality, nudge, loading } = useShopVitality(shopId);

  // Quiet when it cannot be computed. A merchant should never be shown a
  // broken score, and there is nothing useful to say in its place.
  if (loading || !vitality) return null;

  const band = vitalityBand(vitality.score);

  return (
    <section className="kl-tile p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Shop strength
          </p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${BAND_CLASS[band]}`}>
            {vitality.score}
            <span className="text-base font-normal text-muted-foreground">/100</span>
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            {vitalityReward(vitality.score)}
          </p>
        </div>

        <div
          className="relative size-16 shrink-0"
          role="img"
          aria-label={`Shop strength ${vitality.score} out of 100`}
        >
          {/* A ring rather than a bar: it reads as a single standing measure
              rather than progress towards a finish line, which is what this is. */}
          <svg viewBox="0 0 36 36" className="size-16 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="var(--secondary)"
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke={band === 'strong' ? 'var(--success)' : 'var(--primary)'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(vitality.score / 100) * 97.4} 97.4`}
              className="transition-[stroke-dasharray] duration-700 ease-out"
            />
          </svg>
        </div>
      </div>

      {/* The one instruction. */}
      {nudge && (
        <button
          onClick={() => {
            // Send them where the work is, rather than making them find it.
            if (nudge.includes('photograph') || nudge.includes('first item')) {
              navigate('/merchant/items/new');
            } else if (nudge.includes('Group your items')) {
              navigate('/merchant/collections');
            } else if (nudge.includes('opening hours')) {
              navigate('/merchant/shop/edit');
            }
          }}
          className="kl-rim mt-4 flex w-full items-center gap-2 rounded-[var(--radius-lg)]
                     bg-[var(--primary-tint)] p-3 text-left transition-colors hover:bg-[var(--primary-tint-mid)]"
        >
          <span className="flex-1 text-sm text-foreground">{nudge}</span>
          <ArrowRight className="size-4 shrink-0 text-primary" strokeWidth={2} />
        </button>
      )}

      <dl className="mt-4 space-y-2 border-t border-border pt-4">
        {componentRows(vitality).map(({ key, icon: Icon, label, value, of, fill }) => (
          <div key={key} className="flex items-center gap-3">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
            <dt className="flex-1 text-xs text-muted-foreground">{label}</dt>
            <dd className="shrink-0 text-xs tabular-nums text-foreground">
              {value}
              {of && <span className="text-muted-foreground"> {of}</span>}
            </dd>
            <div className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${fill >= 1 ? 'bg-[var(--success)]' : 'bg-primary'}`}
                style={{ width: `${Math.round(fill * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default VitalityPanel;
