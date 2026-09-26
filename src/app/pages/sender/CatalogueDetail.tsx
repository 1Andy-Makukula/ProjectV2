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
import { Link, useParams } from 'react-router';
import { ArrowLeft, PackageOpen } from 'lucide-react';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { useExperiences } from '../../hooks/useExperiences';
import { useRequestThread, REQUEST_SLA_LINE } from '../../hooks/useRequestThread';
import { OCCASION_TILES } from '../../types/occasions';
import { ExperienceRow } from '../../components/storefront/ExperienceRow';
import type { OccasionKind } from '../../types/contacts';

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
          {/* Up one level. A shelf is a room in the catalogue, not a
              destination of its own, and it should always say how to get back
              to the rest of it. */}
          <Link
            to="/catalogue"
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground
                       transition-colors hover:text-ink-900
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
            All occasions
          </Link>
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
                <ExperienceRow key={experience.id} experience={experience} />
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
