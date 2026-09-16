/**
 * Whether this browser has been shown the welcome.
 *
 * Its own module, and not part of Welcome.tsx, purely for code splitting:
 * ConsumerStorefront is in the eager bundle and needs the flag to decide
 * whether to redirect, and importing it from the page would have dragged the
 * whole welcome screen into the first chunk every visitor downloads.
 */
export const WELCOME_SEEN_KEY = 'kithly-welcome-seen';

export function markWelcomeSeen() {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    // Private windows and blocked site data throw here. Losing the flag means
    // somebody sees the welcome twice, which is a far better failure than an
    // exception on the way into the app.
  }
}

/** Fails closed on purpose: unreadable storage reads as already seen. */
export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}
