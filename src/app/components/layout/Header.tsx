// KithLy Header - Global Navigation (Mobile-First Responsive)

import { useState, useEffect } from 'react';
import { ShoppingCart, User, Menu, Gift, MessageSquare, HelpCircle, Home, LayoutDashboard, Settings, LogOut, Store } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart } from '../../hooks/useCart';
import { supabase } from '../../../lib/supabaseClient';
import { Badge } from '../ui/badge';
import { SearchBar } from '../shared/SearchBar';
import { NotificationBell } from '../shared/NotificationBell';
import { formatCurrency } from '../../../utils/currency';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { modeCartIcon, modeLexicon } from '../../types/storefrontModes';
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
  /**
   * Slides the bar out of the way.
   *
   * Owned by the page rather than measured here, so that whatever takes the
   * header's place — the storefront's mode rail, say — moves on exactly the
   * same signal instead of running a second scroll listener that could
   * disagree with this one. Pages that never pass it are unaffected.
   */
  collapsed?: boolean;
}

export function Header({
  onMenuClick: _onMenuClick,
  onProfileClick: _onProfileClick,
  onLogoClick: _onLogoClick,
  collapsed = false,
}: HeaderProps) {
  const { user, profile, signOut } = useAuth();
  const isAuthenticated = !!user;
  const { getTotalItems, setCartSliderOpen } = useCart();
  const cartItemCount = getTotalItems();
  const location = useLocation();
  const isHomePage = location.pathname === '/';

  // The mode's dressing reaches the storefront and stops there. Everywhere
  // else the cart is a cart, because a control that renames itself as you move
  // between pages is worse than one that never changes at all.
  const { mode } = useStorefrontMode();
  const CartGlyph = isHomePage ? modeCartIcon(mode) : ShoppingCart;
  const cartWord = isHomePage ? modeLexicon(mode).cart : 'Cart';

  // ── Role-based hub link ──────────────────────────────────────
  //
  // A merchant's hub is now their *buyer* dashboard: running a shop does not
  // stop them being a customer, and they reach the shop console through the
  // explicit "Enter Shop" switch below rather than by having it be the only
  // place the header can take them.
  const isMerchant = profile?.role === 'merchant';
  const hubHref = profile?.role === 'admin' ? '/admin' : '/dashboard';
  const hubLabel = profile?.role === 'admin' ? 'Admin Hub' : 'Dashboard';

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
    <header
      className={`sticky top-0 z-50 w-full bg-white/60 backdrop-blur-md border-b border-white/20
                  transition-transform duration-300 ease-out
                  ${collapsed ? '-translate-y-full' : 'translate-y-0'}`}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
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

          {/* Right: three clusters, not one queue ─────────────────────────
              Where you can go, then the tools, then you. On a wide screen the
              old flat run of nine mixed links and icons had no reading order;
              grouping them with a hairline between each cluster means the eye
              can skip to the right third instead of scanning the lot. */}
          <div className="flex items-center gap-1 md:gap-2">
            {/* ── Cluster 1: destinations ── */}
            <nav className="hidden items-center gap-0.5 md:flex">
              {isAuthenticated && <HeaderLink to={hubHref}>{hubLabel}</HeaderLink>}
              {!isHomePage && <HeaderLink to="/">Home</HeaderLink>}

              {/* Merchants switch into their shop deliberately — accented, so
                  it does not read as one more place to browse. */}
              {isMerchant && (
                <Link
                  to="/merchant"
                  className="kl-rim ml-1 inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-pill)]
                             bg-primary-tint px-3.5 text-sm font-medium text-primary
                             transition-colors hover:bg-primary/10"
                >
                  <Store className="h-3.5 w-3.5" strokeWidth={2} />
                  Enter Shop
                </Link>
              )}
            </nav>

            <HeaderDivider />

            {/* ── Cluster 2: tools ── */}
            <div className="hidden items-center gap-0.5 md:flex">
              {isAuthenticated && (
                <HeaderIcon to="/messages" label="Messages">
                  <MessageSquare className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
                </HeaderIcon>
              )}
              {isAuthenticated && <NotificationBell />}
              <HeaderIcon to="/support" label="Support">
                <HelpCircle className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
              </HeaderIcon>
            </div>

            {/* Cart — always present, at every width.
                It used to appear only once something was in it, which meant the
                one control people look for was missing exactly when they went
                looking. Adding an item no longer opens anything: the badge is
                the confirmation, and this is the way in. */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setCartSliderOpen(true)}
              className="relative grid size-9 place-items-center rounded-[var(--radius-pill)]
                         text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              // Announced literally whatever it is wearing.
              aria-label={cartItemCount > 0 ? `Cart, ${cartItemCount} items` : 'Cart, empty'}
              title={cartWord}
            >
              <CartGlyph className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
              {cartItemCount > 0 && (
                <Badge className="absolute -top-0.5 -right-0.5 h-5 min-w-5 flex items-center justify-center p-0 kl-gradient-brand text-white text-xs">
                  {cartItemCount}
                </Badge>
              )}
            </motion.button>

            {/* Mobile keeps its own short run of the same tools. */}
            {isAuthenticated && (
              <Link
                to="/messages"
                className="grid size-9 place-items-center rounded-[var(--radius-pill)] text-muted-foreground transition-colors hover:bg-accent md:hidden"
                aria-label="Messages"
              >
                <MessageSquare className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
              </Link>
            )}
            {isAuthenticated && (
              <div className="flex md:hidden">
                <NotificationBell />
              </div>
            )}

            <HeaderDivider />

            {/* ── Cluster 3: you ── */}
            {isAuthenticated && balance !== null && (
              <div
                className="kl-rim hidden h-9 select-none items-center rounded-[var(--radius-pill)]
                           bg-secondary px-3.5 text-xs tracking-wide text-secondary-foreground md:inline-flex"
              >
                <span className="mr-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  Credits
                </span>
                <span className="font-semibold">{formatCurrency(balance, 'ZMW')}</span>
              </div>
            )}

            {isAuthenticated ? (
              <Link
                to="/settings"
                className="hidden h-9 items-center gap-2 rounded-[var(--radius-pill)] pl-0.5 pr-3
                           transition-colors hover:bg-accent md:flex"
              >
                <div className="kl-gradient-brand-br grid size-8 place-items-center rounded-[var(--radius-pill)]">
                  <span className="text-sm font-light text-white">
                    {(user?.user_metadata?.full_name || profile?.name)?.charAt(0) || 'U'}
                  </span>
                </div>
                <span className="hidden text-sm font-light lg:inline">
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

              {isMerchant && (
                <MobileNavLink to="/merchant" icon={Store} label="Enter Shop" onClick={() => setIsMobileMenuOpen(false)} />
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

// ── Desktop header building blocks ──────────────────────────────────────────
//
// Three shapes, defined once. Before this the bar carried five different
// paddings and four hover treatments across nine controls, which is what made
// it read as a pile: every control has to agree on height and radius before any
// grouping can be seen.

/** A text destination. */
function HeaderLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex h-9 items-center rounded-[var(--radius-pill)] px-3 text-sm
                 font-light tracking-wide text-muted-foreground transition-colors
                 hover:bg-accent hover:text-foreground"
    >
      {children}
    </Link>
  );
}

/** A tool: one glyph, square footprint, round hover. */
function HeaderIcon({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-[var(--radius-pill)] text-muted-foreground
                 transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </Link>
  );
}

/** The hairline that makes the clusters legible as clusters. */
function HeaderDivider() {
  return <span aria-hidden className="mx-1 hidden h-5 w-px bg-border-dark md:block" />;
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
