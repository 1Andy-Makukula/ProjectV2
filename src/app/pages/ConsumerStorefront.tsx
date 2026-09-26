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
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Shield, Store, ArrowRight, Package, ListChecks, X } from 'lucide-react';

import { useAuth } from '../../utils/auth/AuthContext';
import { Skeleton } from '../components/ui/skeleton';
import { cn } from '../components/ui/utils';
import { ShopCard } from '../components/shared/ShopCard';
import { ExperienceCard } from '../components/shared/ExperienceCard';
import { ListCard } from '../components/shared/ListCard';
import { Header } from '../components/layout/Header';
import { ModePerch } from '../components/storefront/ModePerch';
import { ModeSwitcher } from '../components/storefront/ModeSwitcher';
import {
  StorefrontRail,
  StorefrontStatusRibbon,
} from '../components/storefront/StorefrontRail';
import { RailDrawer } from '../components/storefront/RailDrawer';
import { IntentStrip } from '../components/storefront/IntentStrip';
import { PulseStrip } from '../components/shared/PulseStrip';
import { applySlate, useSlate } from '../hooks/useSlate';
import { hapticTap, hapticTick } from '../../utils/native';
import { ItemFeed, SectionHeading } from '../components/storefront/ItemFeed';
import { PostCard } from '../components/storefront/PostCard';
import { usePosts } from '../hooks/usePosts';
import { PostBuySheet } from '../components/storefront/PostBuySheet';
import { ItemQuickView } from '../components/storefront/ItemQuickView';
import { WishDialog } from '../components/storefront/WishDialog';
import { useWishes } from '../hooks/useWishes';
import { isPurchasable, postActionLabel, postMatchesFilter } from '../types/posts';
import type { PostSummary } from '../types/posts';
import { useCart, toProduct } from '../hooks/useCart';
import { useExperiences } from '../hooks/useExperiences';
import { useStorefrontData } from '../hooks/useStorefrontData';
import { useCategoryBySlug } from '../hooks/useCategories';
import { useStorefrontMode } from '../hooks/useStorefrontMode';
import { useScrollDirection } from '../hooks/useScrollDirection';
import { useScreenSwipe } from '../hooks/useScreenSwipe';
import {
  STOREFRONT_MODES,
  modeCartIcon,
  modeDefinition,
  modeDensity,
  modeLexicon,
  modePostPresentation,
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
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
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

  // ?category=<slug> — set by the Welcome mosaic's tiles, and by nothing else
  // so far. A URL rather than a store because a category is a view of this
  // page and should be linkable and back-buttonable; the mode, which is a
  // statement about who you are, is the thing that persists.
  const [searchParams, setSearchParams] = useSearchParams();
  const categorySlug = searchParams.get('category');
  const { category: activeCategory, loading: categoryLoading } =
    useCategoryBySlug(categorySlug);

  const clearCategory = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('category');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // The chip rail's one verb. Null clears; anything else narrows. Goes through
  // the URL like everything else here, so a chosen aisle is linkable and the
  // back button undoes it.
  const selectCategory = useCallback(
    (slug: string | null) => {
      if (slug === null) {
        clearCategory();
        return;
      }
      const next = new URLSearchParams(searchParams);
      next.set('category', slug);
      setSearchParams(next, { replace: true });
    },
    [clearCategory, searchParams, setSearchParams],
  );

  // Held in a hook of its own so a like or a save lands immediately rather than
  // waiting on the storefront's next fetch.
  const sourcePosts = useMemo(() => data?.posts ?? [], [data?.posts]);
  const { posts, toggleLike, toggleSave, sharePost } = usePosts(sourcePosts);

  // Which post's Buy sheet is open. The sheet reads prices live when it
  // opens, so holding the post here is enough — there is nothing to prefetch.
  const [buyingPost, setBuyingPost] = useState<PostSummary | null>(null);

  // Wishes: what this person has asked for, and what their contacts have.
  const { mine: myWishes, saveWish, removeWish } = useWishes();
  const [wishingPostId, setWishingPostId] = useState<string | null>(null);
  const { experiences, loading: experiencesLoading } = useExperiences({ limit: 6 });
  const { mode } = useStorefrontMode();
  const definition = modeDefinition(mode);

  // One reading of the scroll, two bars: the header slides away and the mode
  // rail rises into the slot it left.
  // One signal, two halves of the same movement: the page's chrome leaves
  // and the mode it was showing arrives in the bar. Asymmetric by way of the
  // hook — folding takes a deliberate scroll down, unfolding takes barely a
  // nudge back up, because reaching for the chrome is an intent.
  const chromeFolded = useScrollDirection();

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
    const byType = definition.itemFilter
      ? all.filter((i) => (i.item_type ?? 'product') === definition.itemFilter)
      : all;

    // An unresolved slug narrows nothing. A category that has been unfeatured,
    // renamed or removed leaves links in circulation, and the useful answer to
    // one of those is the whole catalogue rather than an empty page blaming
    // the person who followed it.
    if (!activeCategory) return byType;
    return byType.filter((i) => i.category_id === activeCategory.id);
  }, [data?.items, definition.itemFilter, activeCategory]);

  // The Slate reorders what is already here and attaches the reason each thing
  // is where it is. Strictly additive: with the ranker off, absent or slow,
  // `entries` is empty and applySlate returns the list untouched -- so this
  // surface renders exactly what it rendered before. Nothing is ever removed.
  const { entries: slate } = useSlate('storefront', 12);
  const rankedItems = useMemo(
    () => applySlate(visibleItems, slate),
    [visibleItems, slate],
  );

  // Which posts is sliced the same way items are, from the character of what
  // each post attaches. Only Discover renders the section now, but the slice
  // stays here because it costs one pass over an array already in memory, and
  // putting posts back into a mode is then a one-word change.
  const visiblePosts = useMemo(
    () => posts.filter((post) => postMatchesFilter(post, definition.itemFilter)),
    [posts, definition.itemFilter],
  );

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
        {/* Say what is being withheld, and offer the way out in the same
            breath. A narrowed feed that does not admit it is narrowed reads
            as a catalogue that has gone thin. Square block states the fact,
            pill undoes it -- round presses, square informs. */}
        {activeCategory && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="rounded-[var(--radius-block)] bg-ink px-2.5 py-1 text-xs font-semibold text-on-ink">
              {activeCategory.name}
            </span>
            <button
              type="button"
              onClick={clearCategory}
              className="flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-1 text-xs
                         font-medium text-ink-500 transition-colors hover:text-ink-900
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" strokeWidth={2.75} />
              Show everything
            </button>
          </div>
        )}
        <SectionHeading
          kicker={definition.itemsKicker}
          title={definition.itemsHeading}
          action={
            <button
              onClick={() => navigate(profile ? '/shops' : '/signup')}
              className="flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-ink-900"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
        />
        <ItemFeed
          items={rankedItems}
          /* Also waits on the slug resolving, so a category link never shows
             the whole catalogue for a frame before narrowing to one tile's
             worth of it. */
          loading={dataLoading || categoryLoading}
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

    posts:
      visiblePosts.length > 0 ? (
        <section key="posts">
          <SectionHeading accent="coral" kicker="From the shops" title="Posted recently" />
          {modePostPresentation(mode) === 'card' ? (
            <div className="mx-auto grid max-w-2xl grid-cols-1 gap-5">
              {visiblePosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onOpenShop={(shopId) => navigate(profile ? `/shop/${shopId}` : '/signup')}
                  onLike={() => toggleLike(post.id)}
                  onSave={() => toggleSave(post.id)}
                  onShare={() => sharePost(post)}
                  onBuy={isPurchasable(post) ? () => setBuyingPost(post) : undefined}
                  buyLabel={postActionLabel(post.author)}
                  onWish={() => setWishingPostId(post.id)}
                />
              ))}
            </div>
          ) : (
            // Shopping and Services are dense by design — a full-bleed photo
            // card down the middle of either is the wrong instrument. Same
            // cards, moved sideways and out of the way.
            <div className="kl-scroll -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [&>*]:w-[19rem] [&>*]:shrink-0">
              {visiblePosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onOpenShop={(shopId) => navigate(profile ? `/shop/${shopId}` : '/signup')}
                  onLike={() => toggleLike(post.id)}
                  onSave={() => toggleSave(post.id)}
                  onShare={() => sharePost(post)}
                  onBuy={isPurchasable(post) ? () => setBuyingPost(post) : undefined}
                  buyLabel={postActionLabel(post.author)}
                  onWish={() => setWishingPostId(post.id)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null,

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
                className="flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-ink-900"
              >
                Make a list <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : undefined
          }
        />
        {dataLoading ? (
          <div className="kl-row">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
                <Skeleton className="aspect-[4/3] w-full" />
                <div className="space-y-2 p-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : communityLists.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-200 py-16 text-center text-ink-400">
            <ListChecks className="mx-auto mb-3 h-10 w-10 text-ink-300" strokeWidth={1} />
            <p className="text-sm">No lists published yet — yours could be the first.</p>
          </div>
        ) : (
          <div className="kl-row">
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
            accent="berry"
            kicker="Curated by KithLy"
            title="Experiences"
            subtitle="Several shops, one gift, one deadline."
          />
          {experiencesLoading ? (
            <div className="kl-row">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
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
                // The experiences face gives them the room they deserve:
                // two up, wrapping, rather than a row you scroll past.
                definition.value === 'experiences'
                  ? 'grid grid-cols-1 gap-6 sm:grid-cols-2'
                  : 'kl-row'
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
          accent="leaf"
          kicker="Merchant Directory"
          title="Local Shops"
          subtitle="Verified merchants ready to fulfil your gifts in person."
        />
        {dataLoading ? (
          <div className="kl-row">
            {Array.from({ length: 6 }).map((_, i) => (
              <ShopCardSkeleton key={i} />
            ))}
          </div>
        ) : (data?.shops ?? []).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-200 py-16 text-center text-ink-400">
            <Store className="mx-auto mb-3 h-10 w-10 text-ink-300" strokeWidth={1} />
            <p className="text-sm">No shops available yet</p>
          </div>
        ) : (
          <div className="kl-row">
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
    <div className="min-h-screen bg-background font-sans">
      <Header
        condensed={chromeFolded}
        foldedSlot={<ModePerch />}
        onProfileClick={() => navigate('/settings')}
        onLogoClick={() => navigate('/')}
      />

      {/* ── Mode switcher ─────────────────────────────────────────────────────
          No second bar. The pills ARE the rail now — five floating objects on
          the page rather than five chips inside a container, which is one less
          rectangle between the shopper and the thing they came for, and it is
          what lets them fold into the header as objects instead of as the
          contents of a box that has to disappear separately.

          Still sticky, and still sticky in BOTH states: a stuck element
          overlays the content below it rather than reserving viewport space,
          so nothing reflows when the pills leave. Collapsing this wrapper's
          height instead would shorten the document on every change of
          direction and shunt the whole page up and down with it.

          Visibility rides the transition so the row leaves the tab order once
          it is gone — React 18 has no `inert` prop to reach for. It waits out
          the pills' own stagger before it flips, which is what the longer
          duration here is for. */}
      <div
        className={cn(
          // Inert gutter: only the pills are targets, so the empty space either
          // side of them does not swallow clicks meant for the page beneath.
          'pointer-events-none sticky top-[var(--kl-header-h)] z-40 px-4 pt-3 md:px-8',
          'transition-[opacity,visibility] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
          chromeFolded ? 'invisible opacity-0' : 'visible opacity-100',
        )}
      >
        <div className="pointer-events-auto mx-auto w-full max-w-7xl">
          <ModeSwitcher folded={chromeFolded} />
          {/* One true thing at a time, under the modes. Renders nothing at all
              when nothing has happened, so a quiet week looks quiet rather
              than padded. It gets a pill of its own because there is no longer
              a bar behind it and it is small grey text — over a photograph
              scrolling past, that is unreadable. */}
          <PulseStrip className="kl-rim kl-frost mt-2 inline-flex rounded-[var(--radius-pill)] px-3.5 py-1.5" />
        </div>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      {definition.sections.includes('campaigns') ? (
        <section className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-8 sm:pt-6 xl:max-w-[100rem]">
        <div className="kl-stage h-[300px] w-full bg-ink-900 sm:h-[380px]">
          {dataLoading ? (
            <div className="h-full w-full animate-pulse bg-ink-100" />
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
                    <div className="absolute inset-0 bg-gradient-to-br from-ink-900/70 via-ink-900/40 to-ink-900/70" />
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
                      className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink-900 shadow-xl transition-colors hover:bg-ink-50"
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
              {/* Caprasimo for the mode title, and --mode-on-block rather
                  than white for both: the tagline is body-scale text and
                  white clears 4.5:1 on only two of the five mode blocks. */}
              <h1 className="kl-display text-3xl leading-tight text-[var(--mode-on-block)] sm:text-4xl">
                {definition.title}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-[var(--mode-on-block)] opacity-90 sm:text-base">
                {definition.tagline}
              </p>
            </motion.div>
          </div>
        </div>
        </section>
      )}

      {/* ── Trust bar ─────────────────────────────────────────────────────── */}
      <div className="border-b border-ink-100 bg-ink-50/70">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-1 px-5 py-2 sm:gap-x-10 sm:px-8 xl:max-w-[100rem]">
          {[
            { icon: Shield, label: '100% Escrow Protected' },
            { icon: Package, label: 'In-Store Collection' },
            { icon: Store, label: 'Verified Local Merchants' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-ink-500">
              <Icon className="h-3.5 w-3.5 shrink-0 text-mode-accent" strokeWidth={1.5} />
              <span className="text-[0.6875rem] font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sections, in this mode's order ────────────────────────────────── */}
      {/* Two columns: 304 / 1fr at an 85rem ceiling, gutter 20px.
          Was 264 / 1fr / 336 at 1560px. The three-column cockpit asked the eye
          to watch both edges at once, and below 1280px neither rail existed at
          all -- so the layout most people actually saw was never the one being
          designed for. One rail is the honest version of it. */}
      {/* What the mode implies you came for: occasion shelves when sending,
          category chips when browsing. Full width, above both columns --
          where the charter put its category rail. */}
      <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 xl:max-w-[85rem]">
        <IntentStrip activeCategorySlug={categorySlug} onSelectCategory={selectCategory} />
      </div>

      <div className="mx-auto flex max-w-7xl gap-5 px-5 pt-6 pb-10 sm:px-8 xl:max-w-[85rem]">
        {/* One rail, carrying everything: your status first, then the market,
            then your lists. Two columns at every width. */}
        <StorefrontRail
          shops={data?.shops ?? []}
          items={data?.items ?? []}
          lists={communityLists}
        />

        <div className="min-w-0 flex-1 space-y-20">
          {/* What is waiting on you stays in the feed on a phone: it should
              never need a gesture to be discovered. The browse modules moved
              into the drawer. */}
          <StorefrontStatusRibbon />

          {definition.sections.map((key) => sections[key]).filter(Boolean)}

        {!profile && (
          /* Text in --mode-on-block rather than white. White cleared 4.5:1 on
             only two of the five mode blocks, and the paragraph here is body
             copy, not headline scale -- see the measured table in theme.css. */
          <section className="kl-gradient-mode rounded-[var(--radius-modal)] p-10 text-center text-[var(--mode-on-block)] sm:p-14">
            <Shield className="mx-auto mb-5 h-10 w-10 opacity-70" strokeWidth={1.5} />
            <h2 className="kl-display mb-3 text-2xl tracking-tight sm:text-4xl">
              100% Escrow Protected
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed opacity-90 sm:text-lg">
              Every kwacha stays locked until your recipient collects their gift in person. Zero
              risk. Full transparency.
            </p>
            <button
              onClick={() => navigate('/signup')}
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-ink-900 shadow-xl transition-colors hover:bg-ink-50"
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

      {/* Where a post's price finally appears. One sheet for the whole feed:
          it reads the live rows for whichever post opened it. */}
      <WishDialog
        open={wishingPostId !== null}
        onOpenChange={(next) => !next && setWishingPostId(null)}
        postId={wishingPostId}
        existing={wishingPostId ? (myWishes[wishingPostId] ?? null) : null}
        onSave={saveWish}
        onRemove={removeWish}
      />

      {/* A closer look at whatever tile was tapped in the rail. One dialog for
          the whole page; the tiles only say which item. */}
      <ItemQuickView />

      <PostBuySheet
        post={buyingPost}
        open={buyingPost !== null}
        onOpenChange={(next) => !next && setBuyingPost(null)}
        actionLabel={buyingPost ? postActionLabel(buyingPost.author) : 'Buy'}
      />
    </div>
  );
}
