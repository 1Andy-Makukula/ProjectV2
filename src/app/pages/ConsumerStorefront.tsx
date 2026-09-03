// ConsumerStorefront — the public entry point at '/'.
//
// One data layer, five faces. `useStorefrontData` fetches everything once; the
// active mode decides which sections appear, in what order, how the item feed
// is laid out, and — through `data-mode` on the root element — what the whole
// thing is tinted. Switching mode refetches nothing.
//
// Authenticated admins are redirected to their own console; merchants browse
// here as customers.

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
import {
  StorefrontRail,
  StorefrontStatusRibbon,
} from '../components/storefront/StorefrontRail';
import { RailDrawer } from '../components/storefront/RailDrawer';
import { hapticTap, hapticTick } from '../../utils/native';
import { ItemFeed, SectionHeading } from '../components/storefront/ItemFeed';
import { useCart, toProduct } from '../hooks/useCart';
import { useExperiences } from '../hooks/useExperiences';
import { useStorefrontData } from '../hooks/useStorefrontData';
import { useStorefrontMode } from '../hooks/useStorefrontMode';
import { useScrollDirection } from '../hooks/useScrollDirection';
import { useScreenSwipe } from '../hooks/useScreenSwipe';
import {
  STOREFRONT_MODES,
  modeCartIcon,
  modeDefinition,
  modeDensity,
  modeLexicon,
} from '../types/storefrontModes';
import { isService, requiresConversation, type CatalogItem } from '../types/items';
import { toast } from 'sonner';

const SLIDE_MS = 5000;

/**
 * Who gets sent somewhere else instead of the storefront.
 *
 * Merchants are deliberately absent: they shop here like anyone else, and
 * bouncing them to the console the moment they touched '/' was what made
 * buying as a customer impossible for them. They reach the console through
 * "Enter Shop" in the header.
 */
const ROLE_MAP: Record<string, string> = {
  admin: '/admin',
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

  // One reading of the scroll, two bars: the header slides away and the mode
  // rail rises into the slot it left.
  const headerCollapsed = useScrollDirection();

  // The whole page answers a sideways swipe, not just the rail at the top of
  // it — by the time somebody is deep in the feed, that rail is long gone.
  const { setMode } = useStorefrontMode();
  const stepMode = useCallback(
    (delta: number) => {
      const order = STOREFRONT_MODES.map((definition) => definition.value);
      const index = Math.max(0, order.indexOf(mode));
      hapticTick();
      setMode(order[(index + delta + order.length) % order.length]);
    },
    [mode, setMode],
  );

  useScreenSwipe({
    onNext: () => stepMode(1),
    onPrev: () => stepMode(-1),
    // Touch only, and only where the rail is not permanently on screen.
    enabled: typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches,
  });

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
    hapticTap();
    // The count in the header is the confirmation. Throwing the slider open
    // over the page is an interruption to someone who is still browsing —
    // opening the cart stays a deliberate click on the cart.
    const { addToCart } = useCart.getState();
    addToCart(toProduct({ ...item, shop_id: item.shop?.id ?? '' }));
    toast.success(`${item.name} added to cart`);
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
          density={modeDensity(mode)}
          addLabel={modeLexicon(mode).add}
          addIcon={modeCartIcon(mode)}
          ornament={definition.ornament === 'gift' ? 'gift' : undefined}
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
      <Header
        collapsed={headerCollapsed}
        onProfileClick={() => navigate('/settings')}
        onLogoClick={() => navigate('/')}
      />

      {/* ── Mode switcher ─────────────────────────────────────────────────────
          Above the banner rather than below it: it is how you choose what the
          page is, so it should be the first thing under the header, and it
          stays put while the hero scrolls away beneath it. */}
      <div
        className={cn(
          'sticky z-40 border-b backdrop-blur-md',
          'transition-[top,background-color,border-color] duration-300 ease-out',
          headerCollapsed
            // Holding the header's place, and wearing its glass so the top of
            // the page looks the same whichever bar is up there.
            ? 'top-0 border-white/20 bg-white/60'
            : 'top-14 border-slate-100 bg-white/90 md:top-16',
        )}
      >
        <div className="mx-auto max-w-7xl px-5 py-3 sm:px-8">
          <ModeSwitcher />
        </div>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      {definition.sections.includes('campaigns') ? (
        <section className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-8 sm:pt-6 xl:max-w-[100rem]">
        <div className="kl-stage h-[300px] w-full bg-slate-900 sm:h-[380px]">
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
                      className="kl-drift h-full w-full object-cover"
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
                    className="absolute left-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-[var(--radius-pill)] border border-white/25 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/25"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => goSlide((slide + 1) % totalSlides)}
                    aria-label="Next slide"
                    className="absolute right-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-[var(--radius-pill)] border border-white/25 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/25"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </>
          )}
        </div>
        </section>
      ) : (
        // Modes without the carousel still need a header block, tinted to match.
        <section className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-8 sm:pt-6 xl:max-w-[100rem]">
        <div className="kl-stage kl-gradient-mode">
          <div className="px-6 py-9 sm:px-10 sm:py-12">
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
        </div>
        </section>
      )}

      {/* ── Trust bar ─────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-100 bg-slate-50/70">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-1 px-5 py-2 sm:gap-x-10 sm:px-8 xl:max-w-[100rem]">
          {[
            { icon: Shield, label: '100% Escrow Protected' },
            { icon: Package, label: 'In-Store Collection' },
            { icon: Store, label: 'Verified Local Merchants' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-slate-500">
              <Icon className="h-3.5 w-3.5 shrink-0 text-mode-accent" strokeWidth={1.5} />
              <span className="text-[0.6875rem] font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sections, in this mode's order ────────────────────────────────── */}
      <div className="mx-auto flex max-w-7xl gap-8 px-5 py-10 sm:px-8 xl:max-w-[100rem]">
        <StorefrontRail
          shops={data?.shops ?? []}
          items={data?.items ?? []}
          lists={communityLists}
        />

        <div className="min-w-0 flex-1 space-y-16">
          {/* What is waiting on you stays in the feed on a phone: it should
              never need a gesture to be discovered. The browse modules moved
              into the drawer. */}
          <StorefrontStatusRibbon />

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

      {/* Pulled in from the left edge, below 1280px. */}
      <RailDrawer
        shops={data?.shops ?? []}
        items={data?.items ?? []}
        lists={communityLists}
      />
    </div>
  );
}
