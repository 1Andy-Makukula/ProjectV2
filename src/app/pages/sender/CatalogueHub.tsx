// CatalogueHub — where "Send home" leads, at '/catalogue'
//
// THE TWO DOORS, AND WHY THEY GO TO DIFFERENT PLACES
// --------------------------------------------------
// Until 26 Sep both Welcome doors led to the same storefront in different
// modes. Andy's correction: somebody sending home is not browsing a
// marketplace. They are solving a problem for a person far away -- a month of
// groceries, a birthday, a school term -- and a catalogue of forty thousand
// items is the wrong answer to that. So:
//
//   Send home  ->  /catalogue         curated, occasion-led, priced weekly
//   Browse     ->  /browse            the storefront, with its modes
//
// This was the original two-rails design. The occasion pills added to the top
// of /browse the day before were a compromise with it, and have been removed.
//
// WHY THIS IS NOT A COPY OF THE WELCOME PAGE
// ------------------------------------------
// Welcome also shows the occasions, so a hub that repeated that grid would be
// the same page twice. The difference is the job. Welcome ORIENTS: who we are,
// what happens to your money, which door. This is the SHOP for senders, and it
// carries the things Welcome cannot:
//
//   * bundles ready to send today, each with its held-until date
//   * how many bundles each shelf actually holds, so an empty one says so
//     before you open it rather than after
//   * YOUR dates -- a contact's birthday in nine days -- which only exist once
//     somebody is signed in and has told us who they send to
//
// Signed-out visitors see everything here except their own dates. Seeing the
// prices and the bundles before being asked for anything is part of earning
// trust; the sign-up comes at the moment of sending.

import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, CalendarHeart } from 'lucide-react';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { ExperienceRow } from '../../components/storefront/ExperienceRow';
import { useExperiences } from '../../hooks/useExperiences';
import { useContacts } from '../../hooks/useContacts';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useRequestThread, REQUEST_SLA_LINE } from '../../hooks/useRequestThread';
import { OCCASION_TILES } from '../../types/occasions';
import { PROMISES } from '../../types/promises';
import { upcomingOccasions, occasionTitle, countdownLabel } from '../../types/contacts';

/** Enough to show what is on offer without turning the hub into a list. */
const READY_LIMIT = 6;

export function CatalogueHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { contacts, loading: contactsLoading } = useContacts();
  const { askKithly, opening } = useRequestThread();
  // Every active bundle. The hub needs all of them to count the shelves, and
  // there are few enough that one read is cheaper than thirteen.
  const { experiences, loading } = useExperiences({ limit: 60 });

  /** Featured first, then the admin's order. */
  const ready = useMemo(
    () =>
      [...experiences]
        .sort((a, b) => Number(b.is_featured) - Number(a.is_featured) || a.sort_order - b.sort_order)
        .slice(0, READY_LIMIT),
    [experiences],
  );

  const shelfCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of experiences) {
      if (e.occasion_kind) counts[e.occasion_kind] = (counts[e.occasion_kind] ?? 0) + 1;
    }
    return counts;
  }, [experiences]);

  const upcoming = useMemo(
    () => (user ? upcomingOccasions(contacts, 60).slice(0, 4) : []),
    [user, contacts],
  );

  return (
    <PageShell>
      <PageBody>
        <header className="mb-8">
          <h1 className="kl-display text-4xl tracking-tight text-ink-900 md:text-6xl">Send home</h1>
          <p className="mt-2 max-w-xl text-sm font-light leading-relaxed text-muted-foreground md:text-base">
            Put together for the people you send to. Pick an occasion, or take something ready
            to go — bought here, collected there.
          </p>
        </header>

        {/* ── Yours. Only when there is something to say. ─────────────────
            The one section Welcome can never have: a date that belongs to a
            person this sender has told us about. Hidden, not apologised for,
            when there is nothing coming up -- a box saying "no dates" every
            visit teaches people to stop looking at it. */}
        {!contactsLoading && upcoming.length > 0 && (
          <section className="mb-10" aria-labelledby="coming-up">
            <h2 id="coming-up" className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900">
              <CalendarHeart className="h-4 w-4 text-primary" strokeWidth={2.4} />
              Coming up
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {upcoming.map(({ contact, occasion, days }) => (
                <button
                  key={occasion.id}
                  type="button"
                  onClick={() => navigate(`/catalogue/${occasion.kind}`)}
                  className="kl-tile kl-lift flex items-center justify-between gap-3 p-4 text-left
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-900">{contact.name}</span>
                    <span className="block text-xs text-muted-foreground">{occasionTitle(occasion)}</span>
                  </span>
                  <span className={`shrink-0 text-xs font-semibold ${days <= 7 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {countdownLabel(days)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Ready to send ───────────────────────────────────────────────── */}
        <section className="mb-12" aria-labelledby="ready">
          <h2 id="ready" className="kl-display mb-4 text-2xl tracking-tight text-ink-900 md:text-3xl">
            Ready to send
          </h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-[var(--radius-tile)]" />
              ))}
            </div>
          ) : ready.length === 0 ? (
            <p className="text-sm font-light text-muted-foreground">
              Nothing put together yet — choose an occasion below, or ask us.
            </p>
          ) : (
            <div className="space-y-3">
              {ready.map((experience) => (
                <ExperienceRow key={experience.id} experience={experience} />
              ))}
            </div>
          )}
        </section>

        {/* ── By occasion ─────────────────────────────────────────────────── */}
        <section className="mb-12" aria-labelledby="by-occasion">
          <h2 id="by-occasion" className="kl-display mb-4 text-2xl tracking-tight text-ink-900 md:text-3xl">
            By occasion
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {OCCASION_TILES.filter((t) => !t.opensRequest).map((tile) => {
              const count = shelfCounts[tile.kind] ?? 0;
              return (
                <button
                  key={tile.kind}
                  type="button"
                  onClick={() => navigate(`/catalogue/${tile.kind}`)}
                  className="kl-tile kl-lift p-4 text-left
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-sm font-semibold text-ink-900">{tile.label}</span>
                  {/* Said before the press rather than discovered after it.
                      An empty shelf still opens -- it offers to price the
                      thing for you -- but nobody should be surprised by it. */}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {loading ? ' ' : count === 0 ? 'Ask us' : `${count} ready`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── What happens to your money ──────────────────────────────────
            Stated here, at the point of choosing, not only on the Welcome
            page somebody may have skipped. The same three sentences, from the
            same module, so the two can never read differently. */}
        <section className="mb-12 grid gap-3 md:grid-cols-3" aria-label="What happens to your money">
          {PROMISES.map((promise) => (
            <div key={promise.title} className="kl-tile p-5">
              <promise.icon className="mb-3 h-5 w-5 text-primary" strokeWidth={2.2} />
              <h3 className="mb-1 text-sm font-semibold text-ink-900">{promise.title}</h3>
              <p className="text-sm font-light leading-relaxed text-muted-foreground">{promise.body}</p>
            </div>
          ))}
        </section>

        {/* ── Anything else ───────────────────────────────────────────────── */}
        <section className="kl-tile flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="max-w-md">
            <h2 className="kl-display text-xl tracking-tight text-ink-900">Not here?</h2>
            <p className="mt-1 text-sm font-light text-muted-foreground">
              Tell us what you need and we will go and find it. {REQUEST_SLA_LINE}
            </p>
          </div>
          <Button disabled={opening} onClick={() => askKithly('Catalogue request')}>
            Ask us
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </section>
      </PageBody>
    </PageShell>
  );
}

export default CatalogueHub;
