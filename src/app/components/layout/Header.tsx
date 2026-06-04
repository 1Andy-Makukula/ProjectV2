// KithLy Header - Global Navigation (Mobile-First Responsive)

import { useState, useEffect } from 'react';
import { ShoppingCart, User, Menu, Gift, Bell, HelpCircle, Home, LayoutDashboard, Settings, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart } from '../../hooks/useCart';
import { supabase } from '../../../lib/supabaseClient';
import { Badge } from '../ui/badge';
import { SearchBar } from '../shared/SearchBar';
import { formatCurrency } from '../../../utils/currency';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';

interface HeaderProps {
  onMenuClick?: () => void;
  onProfileClick?: () => void;
  onLogoClick?: () => void;
}

export function Header({
  onMenuClick,
  onProfileClick,
  onLogoClick,
}: HeaderProps) {
  const { user, profile, signOut } = useAuth();
  const isAuthenticated = !!user;
  const { getTotalItems, setCartSliderOpen } = useCart();
  const cartItemCount = getTotalItems();
  const location = useLocation();
  const isHomePage = location.pathname === '/';

  // ── Role-based hub link ──────────────────────────────────────
  const hubHref =
    profile?.role === 'admin' ? '/admin'
    : profile?.role === 'merchant' ? '/merchant'
    : '/dashboard';
  const hubLabel =
    profile?.role === 'admin' ? 'Admin Hub'
    : profile?.role === 'merchant' ? 'Merchant Hub'
    : 'Dashboard';

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);

  const fetchWalletBalance = async () => {
    if (!isAuthenticated || !user?.id) return;
    try {
      const { data, error } = await supabase
        .from('kithly_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      setBalance(data?.balance ?? 0);
    } catch (err) {
      console.error('[Header] Error fetching wallet balance:', err);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setBalance(null);
      return;
    }

    fetchWalletBalance();

    const handleFocus = () => {
      fetchWalletBalance();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('wallet-update', fetchWalletBalance);

    const walletChannel = supabase.channel('header-wallet')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'kithly_wallets',
        filter: `user_id=eq.${user.id}`
      }, () => {
        fetchWalletBalance();
      }).subscribe();

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('wallet-update', fetchWalletBalance);
      supabase.removeChannel(walletChannel);
    };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const fetchNotifications = async () => {
      // V2 Schema: Query transactions joined with shop_orders
      const { data } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          created_at,
          shop_orders!inner (
            shop_order_id,
            claim_code,
            recipient_name,
            fulfilled_at,
            shop:shop_id (name),
            order_items (
              item:item_id (name)
            )
          )
        `)
        .eq('buyer_id', user.id)
        .in('shop_orders.claim_status', ['FULFILLED', 'PARTIAL_FULFILLMENT'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (data) {
        // Flatten to match legacy UI expectation
        const formatted = data.flatMap((tx: any) => 
          tx.shop_orders.map((so: any) => ({
            id: so.shop_order_id,
            code: so.claim_code,
            recipient_name: so.recipient_name,
            fulfilled_at: so.fulfilled_at || tx.created_at,
            item: { name: so.order_items?.[0]?.item?.name || 'Gift' },
            shop: { name: so.shop?.name || 'Shop' }
          }))
        );
        
        // Check if we have new notifications by comparing lengths (simple heuristic)
        if (notifications.length > 0 && formatted.length > notifications.length) {
          toast.success(`🎉 Gift collected! Your recipient just picked up their item.`);
          setUnreadCount(prev => prev + 1);
        }
        
        setNotifications(formatted);
      }
    };

    fetchNotifications();

    // Notify and Re-fetch Pattern (User Approved)
    const channel = supabase.channel('header-notifications')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `buyer_id=eq.${user.id}`
      }, () => {
        fetchNotifications();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transaction_events',
        filter: `event_type=eq.CLAIM_VERIFIED`
      }, () => {
        // Catch fulfillments (no buyer_id filter available on this table, but fetch is safe)
        fetchNotifications();
      }).subscribe();

    return () => { supabase.removeChannel(channel); }
  }, [isAuthenticated, user?.id]);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="sticky top-0 z-50 w-full bg-white/60 backdrop-blur-md border-b border-white/20" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between h-14 md:h-16">
          {/* Left: Hamburger (mobile) + Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="flex md:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" strokeWidth={1.5} />
            </button>

            <Link
              to="/"
              className="flex items-center gap-2 group"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                <Gift className="w-5 h-5 text-white" strokeWidth={1.5} />
              </div>
              <span className="text-xl font-light tracking-tight text-black group-hover:bg-gradient-to-r group-hover:from-[#F97316] group-hover:to-[#FB923C] group-hover:bg-clip-text group-hover:text-transparent transition-all">
                KithLy
              </span>
            </Link>
          </div>

          {/* Center: Search (Desktop only) */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <SearchBar />
          </div>

          {/* Right: Desktop actions (hidden on mobile) + Cart (always visible) */}
          <div className="flex items-center gap-1 md:gap-2">
            {/* Dashboard Link — desktop only */}
            {isAuthenticated && (
              <Link
                to={hubHref}
                className="hidden md:inline-flex items-center px-3 py-1.5 text-sm font-light text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors tracking-wide"
              >
                {hubLabel}
              </Link>
            )}

            {/* Home Link — desktop only */}
            {!isHomePage && (
              <Link
                to="/"
                className="hidden md:inline-flex items-center px-3 py-1.5 text-sm font-light text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors tracking-wide"
              >
                Home
              </Link>
            )}

            {/* Notification Bell — desktop only */}
            {isAuthenticated && (
              <button
                onClick={() => { setIsNotificationsOpen(true); setUnreadCount(0); }}
                className="hidden md:flex relative p-2 text-gray-500 hover:text-gray-700 transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white" />
                )}
              </button>
            )}

            {/* Support — desktop only */}
            <Link
              to="/support"
              className="hidden md:flex p-2 text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Support"
            >
              <HelpCircle className="w-5 h-5" strokeWidth={1.5} />
            </Link>

            {/* Cart — always visible */}
            {cartItemCount > 0 && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setCartSliderOpen(true)}
                className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Shopping cart"
              >
                <ShoppingCart className="w-5 h-5" strokeWidth={1.5} />
                <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white text-xs">
                  {cartItemCount}
                </Badge>
              </motion.button>
            )}

            {/* Mobile: Notification bell with badge */}
            {isAuthenticated && (
              <button
                onClick={() => { setIsNotificationsOpen(true); setUnreadCount(0); }}
                className="flex md:hidden relative p-2 text-gray-500 hover:text-gray-700 transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border border-white" />
                )}
              </button>
            )}

            {/* Wallet Balance Pill — desktop only */}
            {isAuthenticated && balance !== null && (
              <div className="hidden md:inline-flex items-center bg-slate-100 px-3 py-1 rounded-full text-xs font-light text-slate-700 tracking-wide select-none">
                <span className="text-[10px] text-slate-400 mr-1.5 uppercase font-semibold">Credits</span>
                <span className="font-semibold text-slate-900">{formatCurrency(balance, 'ZMW')}</span>
              </div>
            )}

            {/* Profile — desktop only */}
            {isAuthenticated ? (
              <Link
                to="/settings"
                className="hidden md:flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                  <span className="text-white text-sm font-light">
                    {(user?.user_metadata?.full_name || profile?.name)?.charAt(0) || 'U'}
                  </span>
                </div>
                <span className="hidden lg:inline text-sm font-light">
                  {(user?.user_metadata?.full_name || profile?.name)?.split(' ')[0]}
                </span>
              </Link>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light transition-transform hover:scale-105 active:scale-95 text-sm"
              >
                <User className="w-4 h-4" strokeWidth={1.5} />
                <span className="hidden md:inline">Sign In</span>
              </Link>
            )}
          </div>
        </div>

        {/* Mobile Search — below header row */}
        <div className="md:hidden pb-3">
          <SearchBar />
        </div>
      </div>

      {/* ── Mobile Navigation Drawer (Sheet) ──────────────────────── */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetContent side="left" className="w-[280px] p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
            <SheetDescription>Main navigation for KithLy</SheetDescription>
          </SheetHeader>

          {/* Profile Section */}
          <div className="p-5 border-b border-slate-100" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)' }}>
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center shrink-0">
                  <span className="text-white text-base font-medium">
                    {(user?.user_metadata?.full_name || profile?.name)?.charAt(0) || 'U'}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {user?.user_metadata?.full_name || profile?.name || 'User'}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                </div>
              </div>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-xl font-medium text-sm w-full justify-center"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <User className="w-4 h-4" strokeWidth={1.5} />
                Sign In
              </Link>
            )}

            {/* Wallet Balance */}
            {isAuthenticated && balance !== null && (
              <div className="mt-3 flex items-center bg-slate-50 px-3 py-2 rounded-xl">
                <span className="text-[10px] text-slate-400 mr-1.5 uppercase font-semibold">Credits</span>
                <span className="font-semibold text-sm text-slate-900">{formatCurrency(balance, 'ZMW')}</span>
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 overflow-y-auto py-3 px-3">
            <div className="space-y-1">
              <MobileNavLink to="/" icon={Home} label="Home" onClick={() => setIsMobileMenuOpen(false)} />

              {isAuthenticated && (
                <MobileNavLink to={hubHref} icon={LayoutDashboard} label={hubLabel} onClick={() => setIsMobileMenuOpen(false)} />
              )}

              <MobileNavLink to="/shops" icon={Gift} label="Browse Shops" onClick={() => setIsMobileMenuOpen(false)} />
              <MobileNavLink to="/support" icon={HelpCircle} label="Support" onClick={() => setIsMobileMenuOpen(false)} />

              {isAuthenticated && (
                <MobileNavLink to="/settings" icon={Settings} label="Settings" onClick={() => setIsMobileMenuOpen(false)} />
              )}
            </div>
          </nav>

          {/* Footer Actions */}
          {isAuthenticated && (
            <div className="p-4 border-t border-slate-100" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  signOut();
                }}
                className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
                Sign Out
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Notifications Drawer (Sheet) ──────────────────────────── */}
      <Sheet open={isNotificationsOpen} onOpenChange={setIsNotificationsOpen}>
        <SheetContent side="right" className="w-[320px] p-0 flex flex-col">
          <SheetHeader className="p-4 border-b bg-gray-50/80">
            <SheetTitle className="text-base">Notifications</SheetTitle>
            <SheetDescription className="sr-only">Recent gift collection activity</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {notifications.length === 0 ? (
              <p className="text-sm text-gray-500 text-center mt-10">No recent activity.</p>
            ) : (
              notifications.map(notif => (
                <div key={notif.id} className="p-3 bg-green-50 border border-green-100 rounded-xl">
                  <p className="text-sm text-green-800">
                    <strong>{notif.recipient_name}</strong> collected <strong>{notif.item?.name}</strong> from <strong>{notif.shop?.name}</strong>.
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    {new Date(notif.fulfilled_at).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

// ── Mobile Navigation Link ──────────────────────────────────────────────────
function MobileNavLink({
  to, icon: Icon, label, onClick,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        isActive
          ? 'bg-orange-50 text-orange-700'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
      {label}
    </Link>
  );
}
