import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Settings,
  Store,
  LogOut,
  ChevronDown,
  LayoutDashboard,
  Loader2,
  CheckCircle,
  Shield,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Banner {
  id: string;
  image_url: string;
  title: string;
}

interface Shop {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  image_url: string | null;
  itemCount: number;
}

const SLIDE_DURATION_MS = 5000;
const FALLBACK_BANNERS: Banner[] = [
  {
    id: 'fallback-1',
    image_url:
      'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&w=1400&q=80',
    title: 'Send a gift that actually means something.',
  },
  {
    id: 'fallback-2',
    image_url:
      'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&w=1400&q=80',
    title: 'Discover local shops crafting unforgettable moments.',
  },
  {
    id: 'fallback-3',
    image_url:
      'https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&w=1400&q=80',
    title: 'Every order tells a story worth sharing.',
  },
];

// ---------------------------------------------------------------------------
// Skeleton sub-components
// ---------------------------------------------------------------------------

function HeroSkeleton() {
  return <div className="relative w-full h-72 sm:h-96 bg-gray-200 animate-pulse" />;
}

function ShopTileSkeleton() {
  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm p-4 flex gap-4">
      <Skeleton className="w-24 aspect-square rounded-xl shrink-0" />
      <div className="flex-1 space-y-2 py-1">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="flex items-start">
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Home() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  const [banners, setBanners] = useState<Banner[]>([]);
  const [bannersLoading, setBannersLoading] = useState(true);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const shopsSectionRef = useRef<HTMLDivElement>(null);

  // Gate all data fetches on authenticated profile
  useEffect(() => {
    if (!profile?.id) return;
    fetchBanners();
    fetchShops();
  }, [profile?.id]);

  useEffect(() => {
    if (currentSlide < banners.length) return;
    setCurrentSlide(0);
  }, [banners.length, currentSlide]);

  // Auto-advance slider — only when banners are loaded
  useEffect(() => {
    if (banners.length === 0) return;
    const timer = setInterval(
      () => setCurrentSlide((prev) => (prev + 1) % banners.length),
      SLIDE_DURATION_MS,
    );
    return () => clearInterval(timer);
  }, [banners.length]);

  const fetchBanners = async () => {
    if (!profile?.id) return;

    setBannersLoading(true);

    try {
      const { data, error } = await supabase
        .from('banners')
        .select('id, image_url, title')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (!error && data && data.length > 0) {
        setBanners(data);
        return;
      }

      setBanners(FALLBACK_BANNERS);
    } catch (err) {
      console.error('[Home] fetchBanners error:', err);
      setBanners(FALLBACK_BANNERS);
    } finally {
      setBannersLoading(false);
    }
  };

  const fetchShops = async () => {
    if (!profile?.id) return;

    setShopsLoading(true);

    try {
      const { data, error } = await supabase
        .from('shops')
        .select(`
          id,
          name,
          description,
          location,
          image_url,
          items:items(count)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const shopsWithCounts = (data ?? []).map((shop: any) => ({
        ...shop,
        itemCount: shop.items?.[0]?.count ?? 0,
      }));

      setShops(shopsWithCounts);
    } catch (err) {
      console.error('[Home] fetchShops error:', err);
      setShops([]);
    } finally {
      setShopsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (isSigningOut) return;

    try {
      setIsSigningOut(true);
      await signOut();
      navigate('/');
    } finally {
      setIsSigningOut(false);
    }
  };

  const scrollToShops = () => {
    shopsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const activeBanner = banners[currentSlide] ?? null;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
              KithLy
            </h1>
            <span className="text-sm text-muted-foreground">
              Hi, {profile?.name?.split(' ')[0] || 'there'}!
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
              title="Impact Dashboard"
              disabled={isSigningOut}
            >
              <LayoutDashboard className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/settings')}
              disabled={isSigningOut}
            >
              <Settings className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              disabled={isSigningOut}
            >
              {isSigningOut
                ? <Loader2 className="w-5 h-5 animate-spin" />
                : <LogOut className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Hero Slider ─────────────────────────────────────────────────── */}
      {bannersLoading ? (
        <HeroSkeleton />
      ) : banners.length === 0 ? null : (
        <div className="relative w-full h-72 sm:h-96 overflow-hidden">
          <AnimatePresence mode="wait">
            {activeBanner && (
              <motion.img
                key={activeBanner.id}
                src={activeBanner.image_url}
                alt={activeBanner.title}
                className="absolute inset-0 w-full h-full object-cover"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.7, ease: 'easeInOut' }}
              />
            )}
          </AnimatePresence>

          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Banner text and CTA */}
          <div className="absolute inset-0 flex flex-col justify-end px-6 py-8">
            <AnimatePresence mode="wait">
              {activeBanner && (
                <motion.h2
                  key={activeBanner.id + '-title'}
                  className="text-white text-2xl sm:text-3xl font-bold max-w-lg leading-snug mb-4"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  {activeBanner.title}
                </motion.h2>
              )}
            </AnimatePresence>

            <div>
              <Button
                onClick={scrollToShops}
                className="bg-gradient-to-r from-primary to-primary-light text-white font-semibold px-6 py-2 rounded-full shadow-lg hover:opacity-90 transition-opacity flex items-center gap-2"
              >
                Start Gifting
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Dot indicators */}
          <div className="absolute bottom-4 right-6 flex items-center gap-1.5">
            {banners.map((banner, index) => (
              <button
                key={banner.id}
                onClick={() => setCurrentSlide(index)}
                aria-label={`Go to slide ${index + 1}`}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentSlide
                    ? 'bg-primary w-4'
                    : 'bg-white/60 hover:bg-white/90 w-2'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Quick Access */}
        <div className="mb-8 flex gap-4">
          <Button
            variant="outline"
            onClick={() => navigate('/orders')}
            className="flex-1 h-auto py-3"
            disabled={isSigningOut}
          >
            <div className="text-center">
              <p className="font-medium">My Orders</p>
              <p className="text-xs text-muted-foreground">View order history</p>
            </div>
          </Button>
        </div>

        {/* Shop Discovery Section */}
        <div ref={shopsSectionRef} className="mb-6 scroll-mt-20">
          <h2 className="text-2xl font-semibold mb-2">Popular Shops</h2>
          <p className="text-muted-foreground">
            Choose from our curated local shops and send memorable experiences
          </p>
        </div>

        {/* Shops List */}
        {shopsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <ShopTileSkeleton key={i} />
            ))}
          </div>
        ) : shops.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border">
            <Store className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No Shops Available</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              There are currently no active shops. Check back soon for amazing gift options!
            </p>
          </div>
        ) : (
          <motion.div 
            initial="hidden"
            animate="visible"
            variants={{
              visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
              hidden: { opacity: 0 }
            }}
            className="space-y-4"
          >
            {shops.map((shop, index) => (
              <motion.div
                key={shop.id}
                variants={{
                  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
                  hidden: { opacity: 0, y: 30 }
                }}
                onClick={() => navigate(`/shop/${shop.id}`)}
                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex gap-4 p-4">
                  {/* Shop Image — enforced 1:1 square */}
                  <div className="w-24 aspect-square rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    {shop.image_url ? (
                      <img
                        src={shop.image_url}
                        alt={shop.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Store className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                  </div>

                  {/* Shop Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-lg">{shop.name}</h3>
                      <CheckCircle className="w-4 h-4 text-blue-500 fill-blue-50" />
                    </div>
                    {shop.location && (
                      <p className="text-sm text-muted-foreground mb-2">
                        {shop.location}
                      </p>
                    )}
                    {shop.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {shop.description}
                      </p>
                    )}
                  </div>

                  {/* Item Count Badge */}
                  <div className="flex items-start">
                    <div className="bg-orange-100 text-primary px-3 py-1 rounded-full text-sm font-medium">
                      {shop.itemCount} {shop.itemCount === 1 ? 'item' : 'items'}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* ── Escrow Trust Banner ─────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 pb-16">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl shadow-2xl p-10 my-12 flex flex-col md:flex-row items-center justify-center gap-8">
          <div className="flex-shrink-0 bg-white/10 p-5 rounded-full backdrop-blur-sm border border-white/20 shadow-inner">
            <Shield className="w-16 h-16 text-yellow-400 fill-yellow-400" />
          </div>
          <div className="text-center md:text-left max-w-3xl">
            <h2 className="text-3xl md:text-5xl font-black text-white mb-4 tracking-tight">
              100% Escrow Protected
            </h2>
            <p className="text-blue-100 text-lg md:text-xl leading-relaxed font-medium">
              Every Kwacha is safely locked in the KithLy vault until the gift is physically collected at the shop. Zero risk. Full transparency.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
