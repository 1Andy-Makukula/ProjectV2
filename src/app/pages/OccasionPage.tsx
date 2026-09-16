// One occasion, and everything KithLy can do about it.
//
// The intent-led entry point: somebody arrives knowing the situation — a
// graduation, a month of groceries, a pharmacy run — rather than the product.
// So the page leads with curated bundles and ends with a way to ask for what
// is not there, which during a cold start is the more useful of the two.

import { useParams, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeft, PackageSearch, Shield } from 'lucide-react';
import { ExperienceCard } from '../components/shared/ExperienceCard';
import { Skeleton } from '../components/ui/skeleton';
import { useExperiences } from '../hooks/useExperiences';
import { useConciergeThread } from '../hooks/useConciergeThread';
import { occasionGroupBySlug } from '../types/occasionGroups';

export function OccasionPage() {
  const { kind } = useParams<{ kind: string }>();
  const navigate = useNavigate();
  const { askKithly, opening } = useConciergeThread();

  // A tile's address is a group slug, which is usually a kind and sometimes
  // is not: /occasion/celebrations stands for six of them.
  const group = occasionGroupBySlug(kind);

  // The hook runs whatever the address says — hooks cannot be called
  // conditionally — so an unknown address hands it undefined and it fetches
  // nothing rather than fetching everything.
  const { experiences, loading } = useExperiences({
    occasionKind: group?.kinds,
    limit: 24,
  });

  // The tile’s words, so the page a tile opens is headed by what was on it.
  const label = group?.label ?? '';

  // The first bundle carrying a photograph lends the page its hero.
  // Merchandised imagery rather than a stock library: whatever the admin chose
  // for the bundle is already the truest picture of what this occasion buys
  // here, and it costs no second asset to maintain.
  const heroImage = experiences.find((e) => e.image_url)?.image_url ?? null;

  if (!group) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="mb-3 text-2xl font-semibold text-slate-900">No such occasion</h1>
        <p className="mb-8 text-sm font-light text-slate-500">
          That address does not match anything we send for.
        </p>
        <button
          onClick={() => navigate('/')}
          className="kl-gradient-brand rounded-full px-7 py-3 text-sm font-light text-white shadow-lg"
        >
          Back to the storefront
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <button
          onClick={() => navigate(-1)}
          className="mb-5 flex items-center gap-1.5 text-sm font-light text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Back
        </button>

        {/* The hero.
            A glass plate only when there is a photograph under it. Over a flat
            gradient it would be a dirty card and buy nothing, which is the
            rule .kl-glass exists to keep. */}
        <div className="kl-stage relative mb-10 flex min-h-[188px] items-end p-6 md:min-h-[260px] md:p-8">
          {heroImage ? (
            <>
              <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="kl-scrim absolute inset-0" />
            </>
          ) : (
            <div className="kl-gradient-brand-br absolute inset-0" />
          )}

          <div className="relative z-[3] max-w-xl">
            {heroImage ? (
              <div className="kl-glass kl-rim rounded-2xl px-5 py-4">
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{label}</h1>
                <p className="mt-1.5 text-sm font-light opacity-80">{group.blurb}</p>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  {label}
                </h1>
                <p className="mt-2 text-sm font-light text-white/85">{group.blurb}</p>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-[var(--radius-tile)]" />
            ))}
          </div>
        ) : experiences.length > 0 ? (
          <>
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold text-slate-900">Ready to send</h2>
              <span className="flex items-center gap-1.5 text-xs font-light text-slate-500">
                <Shield className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
                Held in escrow until collected
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {experiences.map((experience, i) => (
                <motion.div
                  key={experience.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                >
                  <ExperienceCard
                    experience={experience}
                    onOpen={() => navigate(`/experience/${experience.slug}`)}
                  />
                </motion.div>
              ))}
            </div>
          </>
        ) : null}

        {/* The concierge door.
            Always present, and the whole page when nothing is curated yet —
            which on day one is most occasions. An empty shelf that can still
            take an order is worth considerably more than an empty shelf. */}
        <div className={`kl-tile kl-rim p-6 md:p-8 ${experiences.length > 0 ? 'mt-12' : ''}`}>
          <div className="flex items-start gap-4">
            <div className="kl-gradient-brand-br flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
              <PackageSearch className="h-5 w-5 text-white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                {experiences.length > 0
                  ? 'Something else in mind?'
                  : `Nothing curated for ${label.toLowerCase()} yet`}
              </h2>
              <p className="mb-5 max-w-xl text-sm font-light text-slate-500">
                Tell us what you need and we will find it in Lusaka, send you a price to
                approve, and hold the money in escrow until your person collects it.
              </p>
              <button
                onClick={() => askKithly(label)}
                disabled={opening}
                className="kl-gradient-brand rounded-full px-7 py-3 text-sm font-light text-white shadow-lg disabled:opacity-60"
              >
                {opening ? 'Opening…' : 'Ask KithLy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
