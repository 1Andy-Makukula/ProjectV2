// ConsumerStorefront — the public entry point at '/'.
//
// One data layer, five faces. `useStorefrontData` fetches everything once; the
// active mode decides which sections appear, in what order, how the item feed
// is laid out, and — through `data-mode` on the root element — what the whole
// thing is tinted. Switching mode refetches nothing.
//
// Authenticated merchants and admins are redirected to their own hubs.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Shield, Store, ArrowRight, Package, ListChecks } from 'lucide-react';

import { useAuth } from '../../utils/auth/AuthContext';
import { Skeleton } from '../components/ui/skeleton';
import { cn } from '../components/ui/utils';
import { ShopCard } from '../components/shared/ShopCard';
import { ExperienceCard } from '../components/shared/ExperienceCard';
import { ListCard } from '../components/shared/ListCard';
import { Header } from '../components/layout/Header';
import { ModeSwitcher } from '../components/storefront/ModeSwitcher';
import { ItemFeed, SectionHeading } from '../components/storefront/ItemFeed';
import { useCart, toProduct } from '../hooks/useCart';
import { useExperiences } from '../hooks/useExperiences';
import { useStorefrontData } from '../hooks/useStorefrontData';
import { useStorefrontMode } from '../hooks/useStorefrontMode';
import { modeDefinition } from '../types/storefrontModes';
import { isService, requiresConversation, type CatalogItem } from '../types/items';
import { toast } from 'sonner';

const SLIDE_MS = 5000;

const ROLE_MAP: Record<string, string> = {
  admin: '/admin',
  merchant: '/merchant',
};

function ShopCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <Skeleton className="h-44 w-full" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function ConsumerStorefront() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();

  const { data, loading: dataLoading } = useStorefrontData();
  const communityLists = data?.lists ?? [];
  const { experiences, loading: experiencesLoading } = useExperiences({ limit: 6 });
  const { mode } = useStorefrontMode();
  const definition = modeDefinition(mode);

  const [slide, setSlide] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auth redirect ────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || !user || !profile) return;
    if (ROLE_MAP[profile.role]) navigate(ROLE_MAP[profile.role], { replace: true });
  }, [authLoading, user, profile, navigate]);

  // ── Carousel ─────────────────────────────────────────────────────────────
  const campaigns = data?.campaigns ?? [];
  const totalSlides = campaigns.length;

  useEffect(() => {
    if (totalSlides === 0) return;
    timerRef.current = setInterval(() => setSlide((p) => (p + 1) % totalSlides), SLIDE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [totalSlides]);

  const goSlide = useCallback(
    (index: number) => {
      if (timerRef.current) clearInterval(timerRef.current);
      setSlide(index);
      timerRef.current = setInterval(() => setSlide((p) => (p + 1) % totalSlides), SLIDE_MS);
    },
    [totalSlides],
  );

  const activeCampaign = campaigns[slide] ?? null;

  // ── The mode's slice of the same data ────────────────────────────────────
  const visibleItems = useMemo(() => {
    const all = data?.items ?? [];
    if (!definition.itemFilter) return all;
    return all.filter((i) => (i.item_type ?? 'product') === definition.itemFilter);
  }, [data?.items, definition.itemFilter]);

  // ── Item actions ─────────────────────────────────────────────────────────
  const openItem = useCallback(
    (item: CatalogItem) => {
      if (isService(item) || requiresConversation(item)) {
        navigate(`/item/${item.id}`);
        return;
      }
      navigate(profile ? `/send/${item.id}` : '/signup');
    },
    [navigate, profile],
  );

  const addItemToCart = useCallback((item: CatalogItem) => {
    const { addToCart, setCartSliderOpen } = useCart.getState();
    addToCart(toProduct({ ...item, shop_id: item.shop?.id ?? '' }));
    toast.success(`${item.name} added to cart`);
    setCartSliderOpen(true);
  }, []);

  // ── Sections, rendered in the order this mode asks for ───────────────────
  const sections: Record<string, React.ReactNode> = {
    items: (
      <section key="items">
        <SectionHeading
          kicker={definition.itemsKicker}
          title={definition.itemsHeading}
          action={
            <button
              onClick={() => navigate(profile ? '/shops' : '/signup')}
              className="flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
        />
        <ItemFeed
          items={visibleItems}
          loading={dataLoading}
          layout={definition.layout}
          onGift={openItem}
          onAddToCart={profile ? addItemToCart : undefined}
        />
      </section>
    ),

    lists: (
      <section key="lists">
        <SectionHeading
          kicker={definition.itemsKicker}
          title={definition.itemsHeading}
          subtitle="Save one to your own, or buy the whole thing in one go."
          action={
            profile ? (
              <button
                onClick={() => navigate('/lists/new')}
                className="flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
              >
                Make a list <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : undefined
          }
        />
        {dataLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <Skeleton className="aspect-[4/3] w-full" />
                <div className="space-y-2 p-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : communityLists.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400">
            <ListChecks className="mx-auto mb-3 h-10 w-10 text-slate-300" strokeWidth={1} />
            <p className="text-sm">No lists published yet — yours could be the first.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {communityLists.map((list, i) => (
              <motion.div
                key={list.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.06 }}
              >
                <ListCard list={list} onOpen={() => navigate(`/list/${list.slug}`)} />
              </motion.div>
            ))}
          </div>
        )}
      </section>
    ),

    experiences:
      experiencesLoading || experiences.length > 0 ? (
        <section key="experiences">
          <SectionHeading
            kicker="Curated by KithLy"
            title="Experiences"
            subtitle="Several shops, one gift, one deadline."
          />
          {experiencesLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <Skeleton className="aspect-[4/3] w-full" />
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              className={
                // The experiences face gives them the room they deserve.
                definition.value === 'experiences'
                  ? 'grid grid-cols-1 gap-6 sm:grid-cols-2'
                  : 'grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3'
              }
            >
              {experiences.map((experience, i) => (
                <motion.div
                  key={experience.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.06 }}
                >
                  <ExperienceCard
                    experience={experience}
                    onOpen={() => navigate(`/experience/${experience.slug}`)}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </section>
      ) : null,

    shops: (
      <section key="shops">
        <SectionHeading
          kicker="Merchant Directory"
          title="Local Shops"
          subtitle="Verified merchants ready to fulfil your gifts in person."
        />
        {dataLoading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ShopCardSkeleton key={i} />
            ))}
          </div>
        ) : (data?.shops ?? []).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400">
            <Store className="mx-auto mb-3 h-10 w-10 text-slate-300" strokeWidth={1} />
            <p className="text-sm">No shops available yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.shops ?? []).map((shop, i) => (
              <motion.div
                key={shop.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.07 }}
              >
                <ShopCard
                  shop={shop}
                  itemCount={shop.itemCount}
                  onClick={() => navigate(profile ? `/shop/${shop.id}` : '/signup')}
                />
              </motion.div>
            ))}
          </div>
        )}
      </section>
    ),

    campaigns: null, // The carousel is chrome, rendered above the sections.
  };

  return (
    <div className="min-h-screen bg-white font-sans">
      <Header onProfileClick={() => navigate('/settings')} onLogoClick={() => navigate('/')} />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      {definition.sections.includes('campaigns') ? (
        <section className="relative h-[420px] w-full overflow-hidden bg-slate-900 sm:h-[520px]">
          {dataLoading ? (
            <div className="h-full w-full animate-pulse bg-slate-100" />
          ) : (
            <>
              <AnimatePresence mode="wait">
                {activeCampaign && (
                  <motion.div
                    key={activeCampaign.id}
                    initial={{ opacity: 0, scale: 1.03 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.65, ease: 'easeInOut' }}
                    className={cn('absolute inset-0', activeCampaign.target_route && activeCampaign.target_route !== '/' && 'cursor-pointer')}
                    onClick={() => {
                      if (activeCampaign.target_route && activeCampaign.target_route !== '/') {
                        navigate(activeCampaign.target_route);
                      }
                    }}
                  >
                    <img
                      src={activeCampaign.image_url}
                      alt={activeCampaign.title}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-br from-slate-900/70 via-slate-900/40 to-slate-900/70" />
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="absolute inset-0 flex flex-col justify-end px-8 pb-12 sm:px-16">
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: 'easeOut' }}
                  className="max-w-2xl"
                >
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/70">
                    KithLy — Zambia Gift Platform
                  </p>
                  {/* The headline is the mode's, not the campaign's — the face
                      the shopper chose outranks whatever is on rotation. */}
                  <h1 className="mb-3 text-3xl font-bold leading-tight text-white sm:text-5xl">
                    {definition.title}
                  </h1>
                  <p className="mb-6 text-sm text-white/80 sm:text-base">{definition.tagline}</p>
                  {!profile && (
                    <button
                      onClick={() => navigate('/signup')}
                      className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow-xl transition-colors hover:bg-slate-50"
                    >
                      Start gifting free
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </motion.div>
              </div>

              <div className="absolute bottom-5 right-8 flex items-center gap-1.5">
                {campaigns.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => goSlide(i)}
                    aria-label={`Slide ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === slide ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
                    }`}
                  />
                ))}
              </div>

              {totalSlides > 1 && (
                <>
                  <button
                    onClick={() => goSlide((slide - 1 + totalSlides) % totalSlides)}
                    aria-label="Previous slide"
                    className="absolute left-4 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => goSlide((slide + 1) % totalSlides)}
                    aria-label="Next slide"
                    className="absolute right-4 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </>
          )}
        </section>
      ) : (
        // Modes without the carousel still need a header block, tinted to match.
        <section className="kl-gradient-mode">
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
                {definition.title}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-white/85 sm:text-base">
                {definition.tagline}
              </p>
            </motion.div>
          </div>
        </section>
      )}

      {/* ── Mode switcher ─────────────────────────────────────────────────── */}
      <div className="sticky top-14 z-40 border-b border-slate-100 bg-white/90 backdrop-blur-md md:top-16">
        <div className="mx-auto max-w-7xl px-5 py-3 sm:px-8">
          <ModeSwitcher />
        </div>
      </div>

      {/* ── Trust bar ─────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-100 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-6 px-5 py-4 sm:gap-12 sm:px-8">
          {[
            { icon: Shield, label: '100% Escrow Protected' },
            { icon: Package, label: 'In-Store Collection' },
            { icon: Store, label: 'Verified Local Merchants' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-slate-500">
              <Icon className="h-4 w-4 shrink-0 text-mode-accent" strokeWidth={1.5} />
              <span className="text-xs font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sections, in this mode's order ────────────────────────────────── */}
      <div className="mx-auto max-w-7xl space-y-20 px-5 py-14 sm:px-8">
        {definition.sections.map((key) => sections[key]).filter(Boolean)}

        {!profile && (
          <section className="kl-gradient-mode rounded-3xl p-10 text-center sm:p-14">
            <Shield className="mx-auto mb-5 h-10 w-10 text-white/70" strokeWidth={1.5} />
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-white sm:text-4xl">
              100% Escrow Protected
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
              Every kwacha stays locked until your recipient collects their gift in person. Zero
              risk. Full transparency.
            </p>
            <button
              onClick={() => navigate('/signup')}
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-slate-900 shadow-xl transition-colors hover:bg-slate-50"
            >
              Create free account
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
