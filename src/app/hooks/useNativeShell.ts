import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { App as CapApp } from '@capacitor/app';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative, platform } from '../../utils/native';
import { useStorefrontMode } from './useStorefrontMode';

/**
 * Everything the app owes the shell it is running inside.
 *
 * Mounted once, at the root. On the web every branch below is skipped, so this
 * costs a browser one `isNativePlatform()` call and nothing else.
 *
 * What it handles:
 *
 *   * the splash screen, held until React has actually painted
 *   * the status bar, tinted to whichever storefront face is active
 *   * Android's hardware back button, mapped to the router rather than to
 *     closing the app from three screens deep
 *   * links opened from outside — a gift arriving over WhatsApp lands on the
 *     gift, not on the home screen
 *   * resume, which re-runs the same refresh the web does when a tab regains
 *     focus
 *   * connectivity, said once when it changes rather than on every failure
 */
export function useNativeShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode } = useStorefrontMode();

  // The back handler needs today's path without being torn down and rebuilt on
  // every navigation — re-registering a native listener per route change is how
  // duplicate handlers appear.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (!isNative()) return;

    let disposed = false;
    const teardown: Array<() => void> = [];

    (async () => {
      // ── The splash comes down once there is something behind it ──────────
      try {
        await SplashScreen.hide();
      } catch {
        /* no-op */
      }

      // ── Keyboard: push the layout up rather than covering it ─────────────
      // Checkout and chat both have inputs at the bottom of the screen, and an
      // overlaying keyboard hides the very field being typed into.
      try {
        await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
        if (platform() === 'ios') await Keyboard.setAccessoryBarVisible({ isVisible: false });
      } catch {
        /* no-op */
      }

      // ── Android's back button belongs to the router ──────────────────────
      try {
        const handle = await CapApp.addListener('backButton', ({ canGoBack }) => {
          const atRoot = pathRef.current === '/';
          if (canGoBack && !atRoot) {
            navigate(-1);
            return;
          }
          // At the front door, back means leave — which is what the button
          // means everywhere else on the platform.
          CapApp.exitApp();
        });
        if (disposed) handle.remove();
        else teardown.push(() => handle.remove());
      } catch {
        /* no-op */
      }

      // ── Links from outside the app ───────────────────────────────────────
      try {
        const handle = await CapApp.addListener('appUrlOpen', ({ url }) => {
          const target = internalPath(url);
          if (target) navigate(target);
        });
        if (disposed) handle.remove();
        else teardown.push(() => handle.remove());
      } catch {
        /* no-op */
      }

      // ── Coming back to the app ───────────────────────────────────────────
      // The web already refreshes the wallet and notifications when a tab
      // regains focus. Rather than a second mechanism, resume raises the same
      // event, so anything listening keeps working with no changes.
      try {
        const handle = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) window.dispatchEvent(new Event('focus'));
        });
        if (disposed) handle.remove();
        else teardown.push(() => handle.remove());
      } catch {
        /* no-op */
      }

      // ── Connectivity ─────────────────────────────────────────────────────
      try {
        const handle = await Network.addListener('networkStatusChange', (status) => {
          if (status.connected) {
            toast.success('Back online');
            window.dispatchEvent(new Event('focus'));
          } else {
            toast.error('No connection — you can keep browsing what has loaded');
          }
        });
        if (disposed) handle.remove();
        else teardown.push(() => handle.remove());
      } catch {
        /* no-op */
      }
    })();

    return () => {
      disposed = true;
      teardown.forEach((remove) => {
        try {
          remove();
        } catch {
          /* no-op */
        }
      });
    };
  }, [navigate]);

  // ── The status bar wears the active mode ───────────────────────────────
  //
  // The storefront already retints itself per face through `data-mode`. On a
  // phone the screen does not stop at the top of the page, so the bar above it
  // is part of the same surface and has to agree.
  useEffect(() => {
    if (!isNative()) return;

    (async () => {
      try {
        // Read the mode's own colour rather than keeping a second copy of the
        // palette here: theme.css stays the single source.
        const tint = getComputedStyle(document.documentElement)
          .getPropertyValue('--mode-from')
          .trim();

        await StatusBar.setStyle({ style: Style.Light });
        if (platform() === 'android' && tint) {
          await StatusBar.setBackgroundColor({ color: toHex(tint) });
        }
      } catch {
        /* no-op */
      }
    })();
  }, [mode]);
}

/**
 * The in-app path a deep link points at, or null when it is somewhere else.
 *
 * Only the origin's own paths are followed. A link that arrives claiming to be
 * KithLy but points at another host is ignored rather than navigated to — this
 * is an entry point from outside the app, and outside is where hostile links
 * come from.
 */
function internalPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    const here = new URL(window.location.origin);

    const sameHost = parsed.hostname === here.hostname;
    // The custom scheme (kithly://gift/ABC123) carries its path in the same
    // shape, and has no host worth comparing.
    const customScheme = parsed.protocol === 'kithly:';

    if (!sameHost && !customScheme) return null;

    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return path.startsWith('/') ? path : `/${path}`;
  } catch {
    return null;
  }
}

/** CSS colours reach us as `#RRGGBB` already; anything else is left alone. */
function toHex(value: string): string {
  return value.startsWith('#') ? value : '#FFFFFF';
}
