// The floating way between the product's two front doors.
//
// There are two now, and they answer different questions:
//
//   /        the welcome. What are you sending, who are you sending to, and
//            what happens to your money. The question.
//   /browse  the catalogue, in whichever mode you left it. The answer.
//
// A single Home button could only ever point at one of them, and which one it
// should point at depends on where you already are — so it asks instead. One
// press opens a small pane above the button carrying both, with the one you
// are already on marked and inert.
//
// WHY IT NO LONGER HIDES ON THE STOREFRONT
// It used to disappear on '/', which was the catalogue — so the storefront was
// the one screen in the product with a floating cart and no floating way out.
// Now it hides only where there is other navigation to use: the shop console
// and the admin console, both of which have their own.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Home, Compass, Sparkles, Check } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

/** How long the button waits after the last interaction before fading out. */
const IDLE_MS = 2000;

const DESTINATIONS = [
  {
    to: '/',
    icon: Sparkles,
    label: 'Welcome page',
    hint: 'Occasions, and what we promise about your money',
  },
  {
    to: '/browse',
    icon: Compass,
    label: 'Discovery page',
    // Deliberately NOT 'discover' the mode. This returns you to the
    // catalogue wearing whatever face you left it in -- gifting, services,
    // lists -- because the mode is a statement about who you are and
    // resetting it every time somebody navigated home would quietly undo
    // the answer the welcome page went to the trouble of asking for.
    hint: 'The full catalogue, in the mode you left it',
  },
] as const;

export function FloatingHomeButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [isVisible, setIsVisible] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Hidden by *path* for merchants rather than by role: a merchant browsing the
  // storefront as a customer needs the way back as much as anyone, and only the
  // consoles have navigation of their own to return to.
  const isAdminRole = profile?.role === 'admin';
  const isMerchantPath = location.pathname.startsWith('/merchant');
  const isAdminPath = location.pathname.startsWith('/admin');
  const shouldHideButton = isAdminRole || isMerchantPath || isAdminPath;

  // The pane must not fade out from under a finger that is choosing, so an
  // open menu pins the button visible until it closes.
  useEffect(() => {
    if (shouldHideButton) return;

    const handleActivity = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsVisible(true);
      timeoutRef.current = setTimeout(() => setIsVisible(false), IDLE_MS);
    };

    if (isOpen) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsVisible(true);
      return;
    }

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('scroll', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('keydown', handleActivity);
    handleActivity();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, [shouldHideButton, isOpen]);

  // Escape and a press outside both close it. A menu you can only dismiss by
  // choosing something is a trap on a phone, where there is no cursor to move
  // away with.
  useEffect(() => {
    if (!isOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [isOpen]);

  const go = useCallback(
    (to: string) => {
      setIsOpen(false);
      navigate(to);
    },
    [navigate],
  );

  if (shouldHideButton) return null;

  return (
    <div
      ref={rootRef}
      className={`fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2 transition-all
                  duration-700 ease-in-out ${
                    isVisible
                      ? 'pointer-events-auto scale-100 opacity-100'
                      : 'pointer-events-none scale-95 opacity-0'
                  }`}
    >
      {isOpen && (
        /* kl-glass is deliberately NOT a general-purpose utility -- theme.css
           reserves it for the header, because every backdrop-filter re-filters
           the pixels behind it on each scroll frame and this ships to low-end
           Android. This spends a second pane knowingly: it exists only while
           the menu is open, it is small, and nothing scrolls behind it for
           more than the moment it takes to choose. */
        <div
          role="menu"
          aria-label="Where to"
          className="kl-glass kl-rim w-64 overflow-hidden rounded-[var(--radius-panel)] p-1.5"
        >
          {DESTINATIONS.map(({ to, icon: Icon, label, hint }) => {
            const current = location.pathname === to;
            return (
              <button
                key={to}
                type="button"
                role="menuitem"
                onClick={() => !current && go(to)}
                aria-current={current ? 'page' : undefined}
                disabled={current}
                className={`relative z-10 flex w-full items-start gap-3 rounded-[var(--radius-tile)]
                            p-3 text-left transition-colors
                            focus-visible:outline-none focus-visible:ring-2
                            focus-visible:ring-ring ${
                              current
                                ? 'cursor-default opacity-60'
                                : 'hover:bg-foreground/[0.06] active:bg-foreground/[0.1]'
                            }`}
              >
                <Icon
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  strokeWidth={2.75}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    {label}
                    {current && <Check className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden />}
                  </span>
                  <span className="mt-0.5 block text-xs font-light leading-snug text-muted-foreground">
                    {hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Where to"
        className="rounded-full border border-white/20 bg-gradient-to-br from-brand-500/60
                   to-danger-600/60 p-4 text-white shadow-lg backdrop-blur-md
                   transition-transform active:scale-95
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                   focus-visible:ring-offset-2"
      >
        <Home className="h-6 w-6" />
      </button>
    </div>
  );
}
