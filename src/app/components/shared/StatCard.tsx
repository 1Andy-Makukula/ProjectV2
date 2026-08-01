/**
 * Dashboard stat primitives.
 *
 * These exist because the app had grown three separate StatCard
 * implementations that disagreed on weight, size and shape, while the
 * `kl-stat` / `kl-card` / `kl-dot` utilities in theme.css went unused. This is
 * that design language, wired up — no new tokens are introduced here.
 *
 *   StatCard      headline figure, optionally counted up
 *   StatStrip     compact row of secondary figures
 *   SectionHeading consistent titling between dashboard regions
 */

import { cn } from '../ui/utils';
import { AnimatedMetric } from './AnimatedMetric';

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ElementType;
  /** Context line under the value — a secondary figure or qualifier. */
  sub?: string;
  /** Count the value up on mount. Numeric values only. */
  animate?: boolean;
  /** Format an animated value as currency. */
  isCurrency?: boolean;
  /** Marks a figure that moves on its own; renders the pulsing live dot. */
  live?: boolean;
  onClick?: () => void;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  sub,
  animate = false,
  isCurrency = false,
  live = false,
  onClick,
  className,
}: StatCardProps) {
  const interactive = typeof onClick === 'function';

  return (
    <div
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
      className={cn(
        'kl-card group p-5 transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-[var(--shadow-dropdown)]',
        interactive && 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="kl-stat min-w-0">
          <span className="kl-stat__label flex items-center gap-1.5">
            {live && <span className="kl-dot kl-dot--live" aria-hidden />}
            <span className="truncate">{label}</span>
          </span>
          <span className="kl-stat__value truncate">
            {animate && typeof value === 'number' ? (
              <AnimatedMetric value={value} isCurrency={isCurrency} />
            ) : (
              value
            )}
          </span>
          {sub && (
            <span className="truncate text-xs font-light text-muted-foreground">
              {sub}
            </span>
          )}
        </div>

        {Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary-tint text-primary transition-colors group-hover:bg-primary-tint-mid">
            <Icon className="size-4" strokeWidth={1.5} />
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatStrip — secondary figures that shouldn't compete with the headline row
// ---------------------------------------------------------------------------

export interface StatStripEntry {
  label: string;
  value: string | number;
  live?: boolean;
  tone?: 'default' | 'success' | 'muted';
}

const TONE_CLASS: Record<NonNullable<StatStripEntry['tone']>, string> = {
  default: 'text-foreground',
  success: 'text-[var(--success)]',
  muted: 'text-muted-foreground',
};

export function StatStrip({
  entries,
  className,
}: {
  entries: StatStripEntry[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'kl-card grid grid-cols-2 gap-px overflow-hidden bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-6',
        className,
      )}
    >
      {entries.map((entry) => (
        <div key={entry.label} className="flex flex-col gap-1 bg-card px-4 py-3.5">
          <span className="kl-stat__label flex items-center gap-1.5">
            {entry.live && <span className="kl-dot kl-dot--live" aria-hidden />}
            <span className="truncate">{entry.label}</span>
          </span>
          <span
            className={cn(
              'truncate text-base font-medium tracking-tight',
              TONE_CLASS[entry.tone ?? 'default'],
            )}
          >
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionHeading
// ---------------------------------------------------------------------------

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm font-light text-muted-foreground/80">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
