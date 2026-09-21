// KithLy Header - Global Navigation (Mobile-First Responsive)

import { useState, useEffect } from 'react';
import { ShoppingCart, User, Menu, Gift, MessageSquare, HelpCircle, Home, LayoutDashboard, Settings, LogOut, Store, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
   * Fold the page's own top chrome into the bar.
   *
   * The bar used to slide away on this signal and let whatever was beneath it
   * take the top. It stays put now and absorbs instead: the page's chrome
   * leaves, and the one thing worth keeping from it arrives in `foldedSlot`.
   * That is the trade — you give up a bar's worth of height and keep the
   * navigation, rather than the other way round.
   *
   * Owned by the page rather than measured here, so the bar and whatever is
   * folding into it move on exactly the same signal instead of running two
   * scroll listeners that could disagree. Pages that never pass it are
   * unaffected and render the bar expanded, forever.
   */
  condensed?: boolean;
  /**
   * What the page wants kept once its chrome has folded away — the storefront
   * sends the mode it is currently wearing. Rides beside the search, inside
   * the same capsule, so the two read as one control rather than as a pill
   * that appeared next to the search box.
   */
  foldedSlot?: React.ReactNode;
}

export function Header({
  onMenuClick: _onMenuClick,
  onProfileClick: _onProfileClick,
  onLogoClick: _onLogoClick,
  condensed = false,
  foldedSlot,
}: HeaderProps) {
  const { user, profile, signOut } = useAuth();
  const isAuthenticated = !!user;
  const { getTotalItems, setCartSliderOpen } = useCart();
  const cartItemCount = getTotalItems();
  const location = useLocation();
  // Two different questions that used to be one.
  //
  // `isStorefront` gates the mode's dressing -- its cart glyph, its lexicon,
  // the tinted wordmark. That has always meant "am I on the catalogue", and
  // the catalogue moved to /browse when '/' became the welcome.
  //
  // `isHome` is just "am I already there", and only decides whether to offer
  // a Home link. Collapsing these two into one `pathname === '/'` is what
  // would have silently dropped the mode tint off the storefront.
  const isStorefront = location.pathname === '/browse';
  const isHome = location.pathname === '/';

  // The mode's dressing reaches the storefront and stops there. Everywhere
  // else the cart is a cart, because a control that renames itself as you move
  // between pages is worse than one that never changes at all.
  const { mode } = useStorefrontMode();
  const CartGlyph = isStorefront ? modeCartIcon(mode) : ShoppingCart;
  const cartWord = isStorefront ? modeLexicon(mode).cart : 'Cart';

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

  /**
   * What this person has HELD IN ESCROW, in the chrome, always.
   *
   * Replaces the Credits chip, which was removed on 2026-09-18 ("not
   * necessary anymore"). The two are opposites and that is the point of the
   * swap: credits were money you could spend, and this is money you cannot --
   * it is committed to specific gifts and is released to the shop only when
   * the recipient collects. It is drawn in BRASS, which in this design
   * language means held money and nothing else, so it can never be misread
   * as a spendable balance. That was the objection the old comment here
   * raised against putting a figure in this slot, and the colour is what
   * answers it.
   *
   * WHAT IS NOT AFFECTED. Spending credit at checkout is a different feature
   * and is untouched: CartSlider's KithLy Credits switch and Checkout's
   * "Credits applied" line keep their own reads, their walletBalance > 0
   * gating and their storedValueRetired gating. Only the header chip is gone.
   *
   * `sender_escrow_summary` is the same RPC SenderEscrowPanel uses, so this
   * is not a new source of truth -- and it is read directly here rather than
   * through useSenderEscrow because that hook also fetches expiring gifts,
   * which the bar has no use for and would pay for on every page.
   */
  const [heldInEscrow, setHeldInEscrow] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !profile?.id) {
      setHeldInEscrow(null);
      return;
    }

    let cancelled = false;

    const fetchHeld = async () => {
      try {
        const { data, error } = await supabase.rpc('sender_escrow_summary', {
          p_user_id: profile.id,
        });
        if (error) throw error;
        if (cancelled) return;
        const total = (data as { total_in_escrow_ngwee?: number } | null)
          ?.total_in_escrow_ngwee;
        setHeldInEscrow(typeof total === 'number' ? total : null);
      } catch (err) {
        console.error('[Header] Error fetching escrow position:', err);
      }
    };

    fetchHeld();

    const handleFocus = () => {
      fetchHeld();
    };

    window.addEventListener('focus', handleFocus);
    // Still listened for: a checkout that moves money changes what is held,
    // and this is the event the rest of the app already fires when it does.
    window.addEventListener('wallet-update', fetchHeld);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('wallet-update', fetchHeld);
    };
  }, [isAuthenticated, profile?.id]);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Cluster 1 is conditional the whole way down, and an empty glass capsule
  // is a visible blob rather than nothing, so the capsule asks first.
  const hasDestinations = isAuthenticated || !isHome || isMerchant;

  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* ── The gutter the bar floats in ──────────────────────────────────
          Transparent, and the bar keeps `sticky` rather than going `fixed`.
          Sticky holds its place in the flow, so no page that mounts this
          header needed a compensating top padding — and once it is stuck,
          following content scrolls underneath it and shows through the glass,
          which is the whole reason to float it. Going fixed would have bought
          the same look plus a top-padding edit in every consumer.

          The heights here are load-bearing: --kl-header-h in theme.css is
          their sum, and the storefront's mode rail sticks to it. */}
      {/* Every step in here is `md`, deliberately. The row height, the search
          row and --kl-header-h all change at 768px, so the gutter has to as
          well — stepping it at `sm` put 8px of extra bar above a rail that
          was still measuring the short one, between 640px and 768px only.

          `pb-2` does NOT step, though. That gutter is the distance from the
          bar's visible edge down to --kl-header-h, which is where the mode
          rail and its chains measure from; holding it constant is what lets
          the chains be one length rather than a responsive pair. */}
      <div className="px-3 pb-2 pt-2 md:px-4 md:pt-3">
        <div
          className="kl-rim kl-glass mx-auto flex w-full max-w-7xl flex-col gap-1.5
                     rounded-[1.75rem] p-1.5 md:rounded-[var(--radius-pill)]"
        >
          {/* `relative z-10` on both rows: .kl-glass paints its sheen in a
              positioned ::after, which would otherwise sit on top of the
              controls rather than behind them. */}
          <div className="relative z-10 flex h-11 items-center justify-between gap-2 md:h-12">
            {/* ── Left: hamburger (mobile) + the mark ── */}
            <div className="flex min-w-0 items-center gap-1.5 pl-0.5">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-pill)]
                           text-muted-foreground transition-colors
                           hover:bg-primary-tint hover:text-primary md:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
              </button>

              <Link to="/" className="group flex shrink-0 items-center gap-2 pr-1">
                {/* The mark carries the active mode's tint on the storefront, and
                    the fixed brand gradient everywhere else. */}
                <div
                  className={`grid size-8 place-items-center rounded-[var(--radius-pill)] ${
                    isStorefront ? 'kl-wordmark-mode' : 'kl-wordmark'
                  }`}
                >
                  <Gift className="h-[1.1rem] w-[1.1rem] text-white" strokeWidth={1.5} />
                </div>
                <span className="kl-display text-lg text-foreground md:text-xl">
                  KithLy
                </span>
              </Link>
            </div>

            {/* ── Centre: search, plus whatever folded in (desktop) ── */}
            <div className="mx-4 hidden min-w-0 flex-1 justify-center md:flex lg:mx-8">
              <BarSearch folded={condensed ? foldedSlot : null} />
            </div>

            {/* ── Right: three capsules, not one queue ─────────────────────
                Where you can go, then the tools, then you. The hairlines that
                used to mark these boundaries were doing the job by
                implication; on a glass bar a group can simply be an object
                resting on it, which is the same reading without asking anyone
                to infer it from a 1px line. */}
            <div className="flex shrink-0 items-center gap-1.5">
              {/* ── Capsule 1: destinations ── */}
              {hasDestinations && (
                <nav className="kl-glass-group hidden items-center gap-0.5 p-1 md:flex">
                  {isAuthenticated && <HeaderLink to={hubHref}>{hubLabel}</HeaderLink>}
                  {!isHome && <HeaderLink to="/">Home</HeaderLink>}

                  {/* Merchants switch into their shop deliberately — accented, so
                      it does not read as one more place to browse. */}
                  {isMerchant && (
                    <Link
                      to="/merchant"
                      className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-pill)]
                                 bg-primary-tint px-3.5 text-sm font-medium text-primary
                                 transition-colors hover:bg-primary hover:text-primary-foreground"
                    >
                      <Store className="h-3.5 w-3.5" strokeWidth={2} />
                      Enter Shop
                    </Link>
                  )}
                </nav>
              )}

              {/* ── Capsule 2: tools ──
                  One capsule at every width. The desktop and mobile runs of
                  these used to be two separate blocks rendering the same two
                  links, which is two places to forget. */}
              <div className="kl-glass-group flex items-center gap-0.5 p-1">
                {isAuthenticated && (
                  <HeaderIcon to="/messages" label="Messages">
                    <MessageSquare className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
                  </HeaderIcon>
                )}
                {isAuthenticated && <NotificationBell tone="brand" />}

                {/* Support is a desktop affordance; on a phone it is in the drawer. */}
                <div className="hidden md:flex">
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
                             text-muted-foreground transition-colors
                             hover:bg-primary-tint hover:text-primary"
                  // Announced literally whatever it is wearing.
                  aria-label={cartItemCount > 0 ? `Cart, ${cartItemCount} items` : 'Cart, empty'}
                  title={cartWord}
                >
                  <CartGlyph className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
                  {cartItemCount > 0 && (
                    <Badge className="kl-money absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center bg-primary p-0 text-xs text-white">
                      {cartItemCount}
                    </Badge>
                  )}
                </motion.button>
              </div>

              {/* ── Capsule 3: you ── */}
              {isAuthenticated ? (
                <div className="kl-glass-group hidden items-center gap-1 p-1 md:flex">
                  {heldInEscrow !== null && heldInEscrow > 0 && (
                    /* Brass, and only ever brass: in this language brass is
                       money being held and nothing else. Hidden at zero
                       rather than shown as K0.00 -- an empty vault is not a
                       fact worth a slot in the chrome.

                       The accessible name says "held in escrow" in full,
                       because the visible label is abbreviated and a screen
                       reader should not have to infer what HELD means. */
                    <div
                      className="hidden h-9 select-none items-center gap-1.5 rounded-[var(--radius-pill)]
                                 bg-brass px-3.5 text-xs tracking-wide text-ink lg:inline-flex"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2.75} aria-hidden />
                      <span className="sr-only">Held in escrow:</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.06em]" aria-hidden>
                        Held
                      </span>
                      <span className="kl-money">{formatCurrency(heldInEscrow, 'ZMW')}</span>
                    </div>
                  )}

                  <Link
                    to="/settings"
                    className="flex h-9 items-center gap-2 rounded-[var(--radius-pill)] pl-0.5 pr-3
                               transition-colors hover:bg-primary-tint"
                  >
                    <div className="grid size-8 place-items-center rounded-[var(--radius-pill)] bg-primary">
                      <span className="text-sm font-semibold text-white">
                        {(user?.user_metadata?.full_name || profile?.name)?.charAt(0) || 'U'}
                      </span>
                    </div>
                    <span className="hidden text-sm font-light lg:inline">
                      {(user?.user_metadata?.full_name || profile?.name)?.split(' ')[0]}
                    </span>
                  </Link>
                </div>
              ) : (
                <Link
                  to="/login"
                  className="flex h-10 items-center gap-2 rounded-[var(--radius-pill)] kl-gradient-brand px-4
                             text-sm font-light text-white shadow-[var(--shadow-glow)]
                             transition-transform hover:scale-105 active:scale-95"
                >
                  <User className="h-4 w-4" strokeWidth={1.5} />
                  <span className="hidden md:inline">Sign In</span>
                </Link>
              )}
            </div>
          </div>

          {/* Mobile search — the bar's second row, inside the same pane so the
              header stays one floating object rather than two stacked ones.
              The folded slot lands here on a phone, where there is no centre
              to put it in; the search gives up the width for it. */}
          <div className="relative z-10 px-1 md:hidden">
            <BarSearch folded={condensed ? foldedSlot : null} />
          </div>
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
          <div className="p-5 border-b border-ink-100" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)' }}>
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full kl-gradient-brand-br flex items-center justify-center shrink-0">
                  <span className="text-white text-base font-medium">
                    {(user?.user_metadata?.full_name || profile?.name)?.charAt(0) || 'U'}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900 truncate">
                    {user?.user_metadata?.full_name || profile?.name || 'User'}
                  </p>
                  <p className="text-xs text-ink-400 truncate">{user?.email}</p>
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

            {/* Held in escrow — the same brass fact as the desktop chip. */}
            {isAuthenticated && heldInEscrow !== null && heldInEscrow > 0 && (
              <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-brass px-3 py-2 text-ink">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2.75} aria-hidden />
                <span className="sr-only">Held in escrow:</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.06em]" aria-hidden>Held</span>
                <span className="kl-money text-sm">{formatCurrency(heldInEscrow, 'ZMW')}</span>
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
            <div className="p-4 border-t border-ink-100" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  signOut();
                }}
                className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-danger-600 hover:bg-danger-50 rounded-xl transition-colors"
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

/**
 * The curve the fold runs on.
 *
 * A fold made of separate animations that merely happen at the same time
 * reads as separate animations. What makes this one read as a single thing
 * settling is that every part of it — the pill arriving here, the capsule
 * filling in behind it, and the storefront's rail sliding up out of the way —
 * runs 300ms on this exact easing.
 *
 * It is stated twice and there is no way around that: the rail leaves on a
 * Tailwind class, and a class cannot read a constant. The other copy is the
 * `duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]` on the mode rail in
 * ConsumerStorefront. Change one and change the other, or the fold comes
 * apart into two movements.
 *
 * Decelerating hard, no overshoot: this is chrome getting out of the way, and
 * a bounce would ask to be watched.
 */
const FOLD = { duration: 0.3, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * The search, and whatever the page has folded in beside it.
 *
 * Written once and mounted twice — the bar's centre at md and up, its second
 * row below that — because the two live in different flex parents and no
 * amount of CSS moves a node between them. Only ever one of them is displayed.
 *
 * The search does not animate at all, and does not need to: it is `flex-1`
 * next to a pill whose width is animating, so it yields its width by being
 * laid out every frame rather than by running an animation of its own.
 */
function BarSearch({ folded }: { folded?: React.ReactNode }) {
  return (
    <div
      // The capsule's padding is here in BOTH states and only its fill is
      // toggled, so the arriving pill has its 4px of room already reserved.
      // Adding the padding along with the background would snap the search
      // 8px narrower on the first frame of a 300ms fade.
      className={`flex w-full min-w-0 max-w-md items-center gap-1 rounded-[var(--radius-pill)] p-1
                  transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
                  ${folded ? 'kl-glass-group' : ''}`}
    >
      <AnimatePresence initial={false}>
        {folded && (
          <motion.div
            key="folded"
            // Width, not `layout`. A layout animation resizes by applying a
            // transform, and a transform on this box scales the search input
            // sitting next to it — for the whole 300ms the placeholder would
            // be visibly squashed and then spring back, which is the exact
            // cheapness this fold is trying to avoid. Animating the width
            // property instead costs a reflow per frame on one small element
            // and moves the search by laying it out, not by distorting it.
            initial={{ width: 0, opacity: 0, scale: 0.8 }}
            animate={{ width: 'auto', opacity: 1, scale: 1 }}
            exit={{ width: 0, opacity: 0, scale: 0.8 }}
            transition={FOLD}
            className="shrink-0 overflow-hidden"
          >
            {folded}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="min-w-0 flex-1">
        <SearchBar />
      </div>
    </div>
  );
}

// ── The bar's building blocks ───────────────────────────────────────────────
//
// Three shapes, defined once. Before this the bar carried five different
// paddings and four hover treatments across nine controls, which is what made
// it read as a pile: every control has to agree on height and radius before any
// grouping can be seen.
//
// All of them light up the same way, and that is the point of the pair below.
// Hover warms the pill to the brand tint; the page you are actually on wears
// the brand outright. One light source, two intensities — which is the same
// rule the heat ramp states for area, applied to state instead.

/**
 * Whether a destination is the page you are on.
 *
 * Exact for "/", or the route plus a path boundary for everything else, so
 * /messages stays lit on /messages/42 while /me is not lit by /messages. A
 * bare startsWith would do the latter.
 */
function useIsActive(to: string) {
  const { pathname } = useLocation();
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** The lit state, shared so a text pill and an icon pill cannot drift apart. */
const ACTIVE_PILL = 'kl-gradient-brand text-white shadow-[var(--shadow-glow)]';
const RESTING_PILL = 'text-muted-foreground hover:bg-primary-tint hover:text-primary';

/** A text destination. */
function HeaderLink({ to, children }: { to: string; children: React.ReactNode }) {
  const active = useIsActive(to);

  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex h-9 items-center rounded-[var(--radius-pill)] px-3.5 text-sm
                  tracking-wide transition-colors ${
                    active ? `font-medium ${ACTIVE_PILL}` : `font-light ${RESTING_PILL}`
                  }`}
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
  const active = useIsActive(to);

  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={`grid size-9 place-items-center rounded-[var(--radius-pill)] transition-colors ${
        active ? ACTIVE_PILL : RESTING_PILL
      }`}
    >
      {children}
    </Link>
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
          ? 'bg-brand-50 text-brand-700'
          : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
      {label}
    </Link>
  );
}
