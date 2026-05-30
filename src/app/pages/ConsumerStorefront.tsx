// ConsumerStorefront — Public entry point at '/'
// Single Supabase round-trip via Promise.all. No auth required.
// Authenticated users are redirected to their role-appropriate hub.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../utils/auth/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Shield,
  Store,
  ArrowRight,
  Package,
} from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton';
import { formatCurrency } from '../../utils/currency';
import { ShopCard } from '../components/shared/ShopCard';
import { StorefrontProductCard } from '../components/shared/StorefrontProductCard';
import { Header } from '../components/layout/Header';
import { useCart, toProduct } from '../hooks/useCart';
import { toast } from 'sonner';

// ─────────────────────────────────────────────
// Types — mirrors actual DB columns exactly
// ─────────────────────────────────────────────

interface Campaign {
  id: string;
  image_url: string;
  title: string;
  sort_order: number;
}

interface StorefrontShop {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  image_url: string | null;
  logo_url: string | null;       // aspirational — null-safe
  cover_image_url: string | null; // aspirational — null-safe
  itemCount: number;
}

interface WeeklyItem {
  id: string;
  name: string;
  description: string | null;
  price_zmw: number;
  image_url: string | null;
  shop: { id: string; name: string } | null;
}

interface StorefrontData {
  campaigns: Campaign[];
  shops: StorefrontShop[];
  weeklyPicks: WeeklyItem[];
}

// ─────────────────────────────────────────────
// Static fallbacks
// ─────────────────────────────────────────────

const FALLBACK_CAMPAIGNS: Campaign[] = [
  {
    id: 'f1',
    image_url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&w=1400&q=80',
    title: 'Send a gift that actually means something.',
    sort_order: 0,
  },
  {
    id: 'f2',
    image_url: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&w=1400&q=80',
    title: 'Discover local shops crafting unforgettable moments.',
    sort_order: 1,
  },
  {
    id: 'f3',
    image_url: 'https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&w=1400&q=80',
    title: 'Every order tells a story worth sharing.',
    sort_order: 2,
  },
];

const SLIDE_MS = 5000;

const ROLE_MAP: Record<string, string> = {
  admin: '/admin',
  merchant: '/merchant',
};

// ─────────────────────────────────────────────
// Skeleton sub-components
// ─────────────────────────────────────────────

function CampaignSkeleton() {
  return <div className="w-full h-[420px] sm:h-[520px] bg-slate-100 animate-pulse" />;
}

function ShopCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      <Skeleton className="w-full h-44" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function ItemCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      <Skeleton className="w-full aspect-square" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function shopInitial(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export function ConsumerStorefront() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();

  const [data, setData] = useState<StorefrontData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [slide, setSlide] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auth redirect ──────────────────────────
  useEffect(() => {
    if (authLoading || !user || !profile) return;
    if (ROLE_MAP[profile.role]) {
      navigate(ROLE_MAP[profile.role], { replace: true });
    }
  }, [authLoading, user, profile, navigate]);

  // ── Single round-trip fetch ────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setDataLoading(true);
      try {
        const [bannersRes, shopsRes, itemsRes] = await Promise.all([
          // Campaign banners — V2 table is `marketing_campaigns`
          supabase
            .from('marketing_campaigns')
            .select('id, image_url, title, sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .limit(6),

          // Active shops
          supabase
            .from('shops')
            .select('id, name, description, location, image_url, logo_url, cover_image_url')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(12),

          // "Weekly picks" — most recent available items across all shops
          supabase
            .from('items')
            .select('id, name, description, price_zmw, image_url, shop:shops(id, name)')
            .eq('is_available', true)
            .order('created_at', { ascending: false })
            .limit(8),
        ]);

        if (cancelled) return;

        const campaigns: Campaign[] =
          bannersRes.data && bannersRes.data.length > 0
            ? (bannersRes.data as Campaign[])
            : FALLBACK_CAMPAIGNS;

        // Fetch item counts separately to avoid PostgREST 400 error
        const shopsWithCounts = await Promise.all(
          (shopsRes.data ?? []).map(async (s: any) => {
            const { count } = await supabase
              .from('items')
              .select('*', { count: 'exact', head: true })
              .eq('shop_id', s.id)
              .eq('is_available', true);
            
            return {
              id: s.id,
              name: s.name,
              description: s.description,
              location: s.location,
              image_url: s.image_url ?? null,
              logo_url: s.logo_url ?? null,
              cover_image_url: s.cover_image_url ?? null,
              itemCount: count ?? 0,
            };
          })
        );

        const shops: StorefrontShop[] = shopsWithCounts;

        const weeklyPicks: WeeklyItem[] = (itemsRes.data ?? []).map((i: any) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          price_zmw: i.price_zmw,
          image_url: i.image_url ?? null,
          shop: i.shop ?? null,
          is_weekly_pick: false,
        }));

        setData({ campaigns, shops, weeklyPicks });
      } catch (err) {
        console.error('[ConsumerStorefront] load error:', err);
        setData({ campaigns: FALLBACK_CAMPAIGNS, shops: [], weeklyPicks: [] });
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Auto-advance carousel ──────────────────
  const totalSlides = data?.campaigns.length ?? 0;

  useEffect(() => {
    if (totalSlides === 0) return;
    timerRef.current = setInterval(
      () => setSlide(prev => (prev + 1) % totalSlides),
      SLIDE_MS,
    );
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [totalSlides]);

  const goSlide = useCallback((index: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setSlide(index);
    timerRef.current = setInterval(
      () => setSlide(prev => (prev + 1) % totalSlides),
      SLIDE_MS,
    );
  }, [totalSlides]);

  // ── Memoised derived values ────────────────
  const activeCampaign = useMemo(
    () => data?.campaigns[slide] ?? null,
    [data?.campaigns, slide],
  );

  const featuredShops = useMemo(
    () => data?.shops ?? [],
    [data?.shops],
  );

  const weeklyPicks = useMemo(
    () => data?.weeklyPicks ?? [],
    [data?.weeklyPicks],
  );

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white font-sans">

      {/* ── Global Header ─────────────────────── */}
      <Header
        onCartClick={() => navigate('/checkout')}
        onProfileClick={() => navigate('/settings')}
        onLogoClick={() => navigate('/')}
      />

      {/* ── Ad Carousel ─────────────────────── */}
      <section className="relative w-full h-[420px] sm:h-[520px] overflow-hidden bg-slate-900">
        {dataLoading ? (
          <CampaignSkeleton />
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
                  className="absolute inset-0"
                >
                  <img
                    src={activeCampaign.image_url}
                    alt={activeCampaign.title}
                    className="w-full h-full object-cover"
                  />
                  {/* Gradient overlay — orange-to-dark-blue brand palette */}
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-900/60 via-slate-900/40 to-blue-900/70" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Headline */}
            <div className="absolute inset-0 flex flex-col justify-end px-8 pb-12 sm:px-16">
              <AnimatePresence mode="wait">
                {activeCampaign && (
                  <motion.div
                    key={activeCampaign.id + '-text'}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    className="max-w-2xl"
                  >
                    <p className="text-xs font-semibold tracking-widest uppercase text-orange-300 mb-3">
                      KithLy — Zambia Gift Platform
                    </p>
                    <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-6">
                      {activeCampaign.title}
                    </h1>
                    <button
                      onClick={() => navigate('/signup')}
                      className="inline-flex items-center gap-2 bg-white text-slate-900 font-semibold text-sm px-6 py-3 rounded-full hover:bg-orange-50 transition-colors shadow-xl"
                    >
                      Start gifting free
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Dot indicators */}
            <div className="absolute bottom-5 right-8 flex items-center gap-1.5">
              {data?.campaigns.map((c, i) => (
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

            {/* Prev / Next arrows */}
            {totalSlides > 1 && (
              <>
                <button
                  onClick={() => goSlide((slide - 1 + totalSlides) % totalSlides)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => goSlide((slide + 1) % totalSlides)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </>
        )}
      </section>

      {/* ── Trust bar ───────────────────────── */}
      <div className="bg-slate-50 border-b border-slate-100">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-4 flex flex-wrap items-center justify-center gap-6 sm:gap-12">
          {[
            { icon: Shield, label: '100% Escrow Protected' },
            { icon: Package, label: 'In-Store Collection' },
            { icon: Store, label: 'Verified Local Merchants' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-slate-500">
              <Icon className="w-4 h-4 text-orange-500 shrink-0" strokeWidth={1.5} />
              <span className="text-xs font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8 py-14 space-y-20">

        {/* ── Weekly Picks ──────────────────── */}
        <section>
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-orange-500 mb-1">
                Curated Selection
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                Featured Picks
              </h2>
            </div>
            <button
              onClick={() => navigate('/signup')}
              className="text-sm font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {dataLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {Array.from({ length: 8 }).map((_, i) => <ItemCardSkeleton key={i} />)}
            </div>
          ) : weeklyPicks.length === 0 ? (
            <div className="py-16 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
              <Package className="w-10 h-10 mx-auto mb-3 text-slate-300" strokeWidth={1} />
              <p className="text-sm">Items coming soon</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {weeklyPicks.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.06 }}
                >
                  <StorefrontProductCard
                    item={item}
                    onGift={() => navigate(profile ? `/send/${item.id}` : '/signup')}
                    onAddToCart={profile ? () => {
                      const { addToCart, setCartSliderOpen } = useCart.getState();
                      addToCart(toProduct({ ...item, shop_id: item.shop?.id ?? '' }));
                      toast.success(`${item.name} added to cart`);
                      setCartSliderOpen(true);
                    } : undefined}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* ── Merchant Directory ────────────── */}
        <section>
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-blue-600 mb-1">
                Merchant Directory
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                Local Shops
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Verified merchants ready to fulfil your gifts in person.
              </p>
            </div>
          </div>

          {dataLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => <ShopCardSkeleton key={i} />)}
            </div>
          ) : featuredShops.length === 0 ? (
            <div className="py-16 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl">
              <Store className="w-10 h-10 mx-auto mb-3 text-slate-300" strokeWidth={1} />
              <p className="text-sm">No shops available yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {featuredShops.map((shop, i) => (
                <motion.div
                  key={shop.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: i * 0.07 }}
                >
                  <ShopCard
                    shop={shop}
                    itemCount={shop.itemCount}
                    onClick={() => navigate('/signup')}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* ── Bottom CTA ───────────────────── */}
        <section className="rounded-3xl bg-gradient-to-br from-orange-500 via-orange-600 to-blue-800 p-10 sm:p-14 text-center">
          <Shield className="w-10 h-10 text-orange-200 mx-auto mb-5" strokeWidth={1.5} />
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-3 tracking-tight">
            100% Escrow Protected
          </h2>
          <p className="text-orange-100 text-base sm:text-lg max-w-xl mx-auto mb-8 leading-relaxed">
            Every kwacha stays locked in the KithLy vault until your recipient collects their gift in person. Zero risk. Full transparency.
          </p>
          <button
            onClick={() => navigate('/signup')}
            className="inline-flex items-center gap-2 bg-white text-slate-900 font-bold text-sm px-8 py-3.5 rounded-full hover:bg-orange-50 transition-colors shadow-xl"
          >
            Create free account
            <ArrowRight className="w-4 h-4" />
          </button>
        </section>
      </div>
    </div>
  );
}
