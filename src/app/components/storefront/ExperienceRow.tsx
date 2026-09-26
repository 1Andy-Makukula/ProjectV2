// ExperienceRow — one curated bundle, as a row a sender can act on.
//
// Shared by the catalogue hub (/catalogue) and each shelf under it
// (/catalogue/:kind), so a bundle reads identically wherever it is found --
// the same price, the same held-until date, the same provenance sentence.
// Two copies of this would have been two places for a disclosure to drift.
//
// THE TILE/MANIFEST RULE. A curated basket is a product and a list at the same
// time. The row sells the outcome and the price; pressing it opens the manifest
// with a shop against every line. Nobody should have to open the manifest to
// find out what it costs.

import { useNavigate } from 'react-router';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import {
  experienceTotal,
  experienceShops,
  hasLivePriceLock,
  type Experience,
} from '../../types/experiences';
import { formatCurrency } from '../../../utils/currency';

/** "28 Sep" rather than an ISO date. A promise reads as a date, not a field. */
function readableDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The disclosure, for one experience.
 *
 * Deliberately one sentence and deliberately not on every line. Repeating a
 * badge on every row is how disclosure becomes noise people learn to skip, at
 * which point it has cost something and bought nothing. The page states its
 * default once; a line only speaks up where it differs.
 *
 * Framed as a service rather than an apology. The same fact reads either as a
 * gap ("we have no partnership here") or as a concierge ("we go and buy this
 * for you"), and only one of those is worth the effort we are actually making.
 */
function Provenance({ experience }: { experience: Experience }) {
  const shops = experienceShops(experience);
  const sourced = shops.filter((s) => s.tier === 'sourced');
  const arranged = shops.filter((s) => s.tier === 'arranged');

  if (sourced.length === 0 && arranged.length === 0) return null;

  const names = [...sourced, ...arranged].map((s) => s.name).join(', ');

  return (
    <p className="mt-2 text-xs font-light leading-relaxed text-muted-foreground">
      <span className="font-semibold text-ink-900">KithLy Bundle</span>
      {' — we buy this for you at '}
      {names}
      {', at this week’s prices, and send you the receipt.'}
    </p>
  );
}

export function ExperienceRow({ experience }: { experience: Experience }) {
  const navigate = useNavigate();
  const total = experienceTotal(experience);
  const lines = experience.experience_items ?? [];
  const locked = hasLivePriceLock(experience);

  return (
    <button
      type="button"
      onClick={() => navigate(`/experience/${experience.slug}`)}
      className="kl-tile kl-lift group w-full p-5 text-left
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                 focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="kl-display text-xl tracking-tight text-ink-900">{experience.name}</h3>
          {experience.tagline && (
            <p className="mt-0.5 text-sm font-light text-muted-foreground">{experience.tagline}</p>
          )}
        </div>
        {/* The outcome and the price, without opening anything. */}
        <div className="shrink-0 text-right">
          <p className="kl-display text-2xl tracking-tight text-ink-900">
            {formatCurrency(total, 'ZMW')}
          </p>
          <p className="text-xs text-muted-foreground">
            {lines.length} item{lines.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* The week's promise, as a date. Specific, checkable, falsifiable --
          which is what makes it believable rather than a slogan. */}
      {locked && experience.price_valid_until && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-block)] bg-surface-paper px-2 py-1 text-xs text-ink-900">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-sage-deep" strokeWidth={2.75} />
          Held until {readableDate(experience.price_valid_until)} — if prices rise, we cover it.
        </p>
      )}

      <Provenance experience={experience} />

      <span className="mt-3 flex items-center gap-1.5 text-sm font-medium text-primary">
        See what is in it
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
      </span>
    </button>
  );
}
