// KithLy Header - Global Navigation (Mobile-First Responsive)

import { useState, useEffect } from 'react';
import { ShoppingCart, User, Menu, Gift, MessageSquare, HelpCircle, Home, LayoutDashboard, Settings, LogOut } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart } from '../../hooks/useCart';
import { supabase } from '../../../lib/supabaseClient';
import { Badge } from '../ui/badge';
import { SearchBar } from '../shared/SearchBar';
import { NotificationBell } from '../shared/NotificationBell';
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

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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
              {/* The mark carries the active mode's tint on the storefront, and
                  the fixed brand gradient everywhere else. */}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isHomePage ? 'kl-gradient-mode-br' : 'kl-gradient-brand-br'}`}>
                <Gift className="w-5 h-5 text-white" strokeWidth={1.5} />
              </div>
              <span className="text-xl font-light tracking-tight text-black group-hover:kl-gradient-brand-text transition-all">
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

            {/* Messages — desktop only */}
            {isAuthenticated && (
              <Link
                to="/messages"
                className="hidden md:flex p-2 text-gray-500 hover:text-gray-700 transition-colors"
                aria-label="Messages"
              >
                <MessageSquare className="w-5 h-5" strokeWidth={1.5} />
              </Link>
            )}

            {/* Notifications — desktop only */}
            {isAuthenticated && (
              <div className="hidden md:flex">
                <NotificationBell />
              </div>
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
                <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 kl-gradient-brand text-white text-xs">
                  {cartItemCount}
                </Badge>
              </motion.button>
            )}

            {/* Mobile: messages and notifications */}
            {isAuthenticated && (
              <Link
                to="/messages"
                className="flex md:hidden p-2 text-gray-500 hover:text-gray-700 transition-colors"
                aria-label="Messages"
              >
                <MessageSquare className="w-5 h-5" strokeWidth={1.5} />
              </Link>
            )}
            {isAuthenticated && (
              <div className="flex md:hidden">
                <NotificationBell />
              </div>
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
                <div className="w-8 h-8 rounded-full kl-gradient-brand-br flex items-center justify-center">
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
                className="flex items-center gap-2 px-4 py-2 kl-gradient-brand text-white rounded-full font-light transition-transform hover:scale-105 active:scale-95 text-sm"
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
                <div className="w-10 h-10 rounded-full kl-gradient-brand-br flex items-center justify-center shrink-0">
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
                className="flex items-center gap-2 px-4 py-2.5 kl-gradient-brand text-white rounded-xl font-medium text-sm w-full justify-center"
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
