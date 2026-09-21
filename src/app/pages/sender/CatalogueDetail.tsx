// CatalogueDetail — where an occasion tile lands, at '/catalogue/:kind'
//
// The change this page represents: an occasion tile stops being a filter over
// a feed and becomes a destination. "Monthly Essentials" is no longer a search
// term, it is a shelf somebody arranged.
//
// NO NEW TABLE. A catalogue page is every active experience filed under one
// occasion kind, in the order an admin put them. `occasion_kind` is a foreign
// key to the same taxonomy that `contact_occasions` and the Welcome tiles are
// written against, so the reminder, the tile and the shelf can never drift
// into three slightly different vocabularies.
//
// FLAT, NOT NESTED. An experience never contains another experience. The page
// is the grouping -- the meat box, the dry goods and the household box are
// siblings here, not children of a parent bundle. Recursion would make
// pricing, stock and partial availability recursive problems for nothing.
//
// THE TILE/MANIFEST RULE. A curated basket is a product and a list at the same
// time. The card sells the outcome and the price; pressing it opens the
// manifest with a shop against every line. Nobody should have to open the
// manifest to find out what it costs.

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowRight, PackageOpen, ShieldCheck } from 'lucide-react';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { useExperiences } from '../../hooks/useExperiences';
import { useRequestThread, REQUEST_SLA_LINE } from '../../hooks/useRequestThread';
import { OCCASION_TILES } from '../../types/occasions';
import {
  experienceTotal,
  experienceShops,
  hasLivePriceLock,
  type Experience,
} from '../../types/experiences';
import { formatCurrency } from '../../../utils/currency';
import type { OccasionKind } from '../../types/contacts';

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

function ExperienceCardRow({ experience }: { experience: Experience }) {
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

export function CatalogueDetail() {
  const { kind } = useParams<{ kind: string }>();
  const { askKithly, opening } = useRequestThread();
  const { experiences, loading } = useExperiences({ occasionKind: kind, limit: 40 });

  const tile = useMemo(
    () => OCCASION_TILES.find((t) => t.kind === (kind as OccasionKind)),
    [kind],
  );

  const title = tile?.label ?? 'Catalogue';

  return (
    <PageShell>
      <PageBody>
        <header className="mb-6">
          <h1 className="kl-display text-3xl tracking-tight text-ink-900 md:text-5xl">{title}</h1>
          {tile?.blurb && (
            <p className="mt-2 max-w-xl text-sm font-light leading-relaxed text-muted-foreground">
              {tile.blurb}
            </p>
          )}
        </header>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-[var(--radius-tile)]" />
            ))}
          </div>
        ) : experiences.length === 0 ? (
          /* Not an apology, and not a dead end. Nothing curated here YET is a
             reason to ask us, which is the one thing that always works. */
          <div className="kl-tile p-8 text-center">
            <PackageOpen className="mx-auto mb-3 h-10 w-10 text-ink-300" strokeWidth={1} />
            <h2 className="kl-display text-xl tracking-tight text-ink-900">
              Nothing put together for this yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm font-light leading-relaxed text-muted-foreground">
              Tell us what you need and we will price it for you. {REQUEST_SLA_LINE}
            </p>
            <Button
              className="mt-5"
              disabled={opening}
              onClick={() => askKithly(`${title} — request`)}
            >
              Ask us for {title.toLowerCase()}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {experiences.map((experience) => (
                <ExperienceCardRow key={experience.id} experience={experience} />
              ))}
            </div>

            {/* Always reachable, even on a full shelf. The catalogue absorbs
                what repeats; requests are the long tail, and the long tail is
                also where the next thing worth stocking comes from. */}
            <div className="kl-tile mt-4 flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="text-sm font-light text-muted-foreground">
                Not quite what you are after? {REQUEST_SLA_LINE}
              </p>
              <Button
                variant="outline"
                disabled={opening}
                onClick={() => askKithly(`${title} — request`)}
              >
                Ask for something else
              </Button>
            </div>
          </>
        )}
      </PageBody>
    </PageShell>
  );
}

export default CatalogueDetail;
