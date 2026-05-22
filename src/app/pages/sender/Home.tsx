import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
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
  Bell,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
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
    <div className="w-full bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm flex flex-col aspect-[4/3] md:aspect-video">
      <Skeleton className="w-full h-[70%] shrink-0" />
      <div className="h-[30%] p-4 flex flex-col justify-center gap-2">
        <Skeleton className="h-5 w-1/2 rounded" />
        <Skeleton className="h-4 w-1/3 rounded" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Promotional Banners & Data
// ---------------------------------------------------------------------------

const KITHLY_PROMOS = [
  {
    title: "100% Escrow Protected",
    subtitle: "Every Kwacha is locked securely in the KithLy vault until you claim your gift at the merchant's physical shop. Zero risk."
  },
  {
    title: "Instant Gift Delivery",
    subtitle: "Share vouchers via SMS or WhatsApp instantly, and track collection progress in real time."
  },
  {
    title: "Support Neighborhood Shops",
    subtitle: "Explore high-quality curated offerings from trusted local merchants and support community business."
  }
];

function PromoBanner({ data }: { data: typeof KITHLY_PROMOS[0] }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className="w-full h-full flex flex-col justify-center items-center text-center"
    >
      <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mb-4 shrink-0">
        <Shield className="w-6 h-6 text-white" strokeWidth={2} />
      </div>
      <h3 className="text-xl md:text-2xl font-bold mb-2 tracking-tight">{data.title}</h3>
      <p className="text-sm md:text-base text-orange-50 max-w-lg font-medium leading-relaxed">
        {data.subtitle}
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Home() {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

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

    const fetchNotifications = async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, code, recipient_name, fulfilled_at, item:items(name), shop:shops(name)')
        .eq('sender_id', user?.id || profile.id)
        .eq('status', 'fulfilled')
        .order('fulfilled_at', { ascending: false })
        .limit(20);
      
      if (data) {
        setNotifications(data);
      }
    };

    fetchNotifications();

    const channel = supabase.channel('realtime-sender-notifications')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `sender_id=eq.${user?.id || profile.id}`
      }, (payload: any) => {
        if (payload.new.status === 'fulfilled' && payload.old.status !== 'fulfilled') {
          toast.success(`🎉 Gift collected! Your recipient just picked up their item.`);
          setUnreadCount(prev => prev + 1);
          fetchNotifications(); // Refresh the list to get joined item/shop data
        }
      }).subscribe();

    return () => { supabase.removeChannel(channel); }
  }, [profile?.id, user?.id]);

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

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault(); // 1. STOPS the annoying page refresh!
    
    try {
      if (typeof setIsSigningOut === 'function') setIsSigningOut(true);
      // 2. Tell the data center to destroy the token
      await supabase.auth.signOut(); 
      
      // 3. Clear any leftover zombie data in the browser
      localStorage.clear(); 
      sessionStorage.clear();
      
      // 4. Safely redirect to the login page
      navigate('/login', { replace: true }); 
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      if (typeof setIsSigningOut === 'function') setIsSigningOut(false);
    }
  };

  const scrollToShops = () => {
    shopsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const activeBanner = banners[currentSlide] ?? null;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
              KithLy
            </h1>
            <span className="text-sm text-muted-foreground">
              Hi, {user?.full_name?.split(' ')[0] || profile?.name?.split(' ')[0] || 'there'}!
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setIsNotificationsOpen(true); setUnreadCount(0); }} className="relative p-2 text-gray-500 hover:text-gray-700 transition-colors">
              <Bell className="w-6 h-6" />
              <span className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full bg-gradient-to-tr from-orange-500 to-red-500 animate-pulse border border-white" />
            </button>
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
      </div>

      {/* ── Shop Discovery Section ── */}
      <div className="w-full max-w-[1400px] mx-auto px-6 py-8">
        <div ref={shopsSectionRef} className="mb-8 scroll-mt-20">
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-2">Popular Shops</h2>
          <p className="text-gray-500">
            Choose from our curated local shops and send memorable experiences
          </p>
        </div>

        {/* Shops List */}
        {shopsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
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
            className="grid grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8"
          >
            {shops.map((shop, index) => (
              <React.Fragment key={shop.id}>
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  onClick={() => navigate(`/shop/${shop.id}`)}
                  className="w-full min-h-[400px] md:h-[450px] bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm flex flex-col cursor-pointer relative"
                >
                  {/* Upper Section (75% height) */}
                  <div className="w-full h-[75%] bg-gray-50 overflow-hidden relative shrink-0">
                    {shop.image_url ? (
                      <img
                        src={shop.image_url}
                        alt={shop.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-orange-500 to-red-500 opacity-90 flex items-center justify-center">
                        <Store className="w-12 h-12 text-white/80" />
                      </div>
                    )}
                    {/* Floating Item Count Badge */}
                    <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm text-primary px-3 py-1 rounded-full text-xs font-semibold shadow-sm">
                      {shop.itemCount} {shop.itemCount === 1 ? 'item' : 'items'}
                    </div>
                  </div>

                  {/* Lower Section (25% height) */}
                  <div className="w-full h-[25%] px-5 flex flex-col justify-center bg-white border-t border-gray-50 min-w-0">
                    <h3 className="text-base md:text-xl font-extrabold text-gray-900 tracking-tight truncate">
                      {shop.name}
                    </h3>
                    {shop.location && (
                      <p className="text-xs md:text-sm text-gray-500 truncate mt-0.5">
                        {shop.location}
                      </p>
                    )}
                  </div>
                </motion.div>

                {(index + 1) % 6 === 0 && (
                  <div className="col-span-2 lg:col-span-3 w-full min-h-[160px] md:h-[220px] my-6 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white p-8 flex flex-col justify-center items-center text-center shadow-md overflow-hidden">
                    <PromoBanner data={KITHLY_PROMOS[Math.floor(index / 6) % KITHLY_PROMOS.length]} />
                  </div>
                )}
              </React.Fragment>
            ))}
          </motion.div>
        )}
      </div>

      {/* ── Escrow Trust Banner ─────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 pb-16">
        <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl shadow-2xl p-10 my-12 flex flex-col md:flex-row items-center justify-center gap-8">
          <div className="flex-shrink-0 bg-white/10 p-5 rounded-full backdrop-blur-sm border border-white/20 shadow-inner">
            <Shield className="w-16 h-16 text-yellow-300 fill-yellow-300" />
          </div>
          <div className="text-center md:text-left max-w-3xl">
            <h2 className="text-3xl md:text-5xl font-black text-white mb-4 tracking-tight">
              100% Escrow Protected
            </h2>
            <p className="text-orange-50 text-lg md:text-xl leading-relaxed font-medium">
              Every Kwacha is safely locked in the KithLy vault until the gift is physically collected at the shop. Zero risk. Full transparency.
            </p>
          </div>
        </div>
      </div>

      {isNotificationsOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-80 bg-white shadow-2xl border-l flex flex-col transform transition-transform duration-300">
          <div className="flex items-center justify-between p-4 border-b bg-gray-50">
            <h3 className="font-semibold text-gray-800">Notifications</h3>
            <button onClick={() => setIsNotificationsOpen(false)}><X className="w-5 h-5 text-gray-500" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {notifications.length === 0 ? (
              <p className="text-sm text-gray-500 text-center mt-10">No recent activity.</p>
            ) : (
              notifications.map(notif => (
                <div key={notif.id} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                  <p className="text-sm text-green-800">
                    <strong>{notif.recipient_name}</strong> collected <strong>{notif.item?.name}</strong> from <strong>{notif.shop?.name}</strong>.
                  </p>
                  <p className="text-xs text-green-600 mt-1 mt-1">
                    {new Date(notif.fulfilled_at).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
