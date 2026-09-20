// The Conductor — one clock for everything that moves.
//
// WHY ONE CLOCK
// -------------
// The obvious way to make tiles cycle is a timer per tile. Forty tiles is forty
// timers firing at forty unrelated moments, and the grid reads as popcorn: the
// eye is pulled somewhere new constantly and settles nowhere. It is also forty
// wakeups the browser has to schedule.
//
// One clock fixes both. Every tile derives its position in the cycle from a
// hash of its own id, so the changes spread out deterministically and a *wave*
// crosses the grid instead of noise. The same shop always looks the same way,
// which matters: a page that rearranges itself between visits feels broken
// rather than alive.
//
// WHY NOT requestAnimationFrame
// -----------------------------
// The plan said one rAF clock. Building it that way would be wrong. rAF fires
// ~60 times a second; a tile changes its picture every few seconds. That is
// roughly 240 wakeups per actual change, on phones where the storefront's
// critical path is already 486 KB and scroll smoothness is the thing being
// protected.
//
// So the Conductor ticks slowly and only tells a subscriber when its *slot*
// changes -- an integer, a few seconds apart. Anything continuous (a slow
// Ken Burns drift, a cross-fade) is a CSS transition, which the compositor
// runs off the main thread for free. React re-renders on slot changes, not on
// frames.
//
// WHAT IT REFUSES TO DO
// ---------------------
//   * run when the tab is hidden -- a background tab animating pictures is
//     pure battery cost on a phone
//   * run for anyone who has asked the OS to calm animations down
//   * animate more than a few things at once, however many subscribe
//   * run at all when nothing is subscribed

/**
 * How long one full cycle takes, for a subscriber that does not ask for its
 * own. Slow on purpose: this is ambience.
 *
 * A subscriber MAY pass its own. Nine seconds is right for a product tile in a
 * dense grid, where the picture is merchandise and a shopper is scanning. It
 * is far too quick for a big front-door tile that somebody is reading trust
 * copy next to -- see the Welcome mosaic, which holds each picture 30s.
 */
const CYCLE_MS = 9000;

/**
 * How many subscribers may be animating at any moment.
 *
 * Scarcity is what makes motion read as curated rather than cheap. It is also
 * the frame budget: three cross-fades is nothing, thirty is a dropped scroll.
 */
const MOTION_BUDGET = 3;

type Listener = (slot: number) => void;

interface Subscriber {
  id: string;
  slots: number;
  offset: number;
  /** This subscriber's own full-cycle length. */
  cycleMs: number;
  listener: Listener;
  /** Set by the component when the tile is actually on screen. */
  visible: boolean;
  lastSlot: number;
}

const subscribers = new Map<string, Subscriber>();
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * A stable number in [0, 1) from an id.
 *
 * FNV-1a. Chosen because it is tiny, has no dependencies, and spreads short
 * similar strings -- which uuids from the same insert very much are -- across
 * the range rather than clustering them, so neighbouring tiles do not end up
 * in step.
 */
export function phaseOffset(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ── The decisions, as pure functions ───────────────────────────────────────
//
// Everything above this point needs a browser; none of what follows does. The
// split is deliberate: the behaviour worth guarding is the wave and the budget,
// and both are arithmetic. Keeping them free of `window` means they can be
// tested directly rather than through a simulated DOM -- and a test that has to
// fake `matchMedia` to assert a scheduling rule is testing the fake.

/** Which picture a subscriber should be showing at a given moment. */
export function slotAt(
  now: number,
  offset: number,
  slots: number,
  cycleMs: number = CYCLE_MS,
): number {
  if (slots <= 1) return 0;
  if (!(cycleMs > 0)) return 0;
  const phase = ((now / cycleMs) + offset) % 1;
  return Math.floor(phase * slots) % slots;
}

/**
 * Which subscribers are allowed to move right now.
 *
 * Only what is on screen, capped at the budget, chosen by offset rather than
 * insertion order so the permitted few are spread through the cycle instead of
 * all changing on the same tick.
 */
export function selectBudgeted<T extends { offset: number; visible: boolean }>(
  candidates: Iterable<T>,
  budget: number = MOTION_BUDGET,
): T[] {
  return [...candidates]
    .filter((s) => s.visible)
    .sort((a, b) => a.offset - b.offset)
    .slice(0, budget);
}

function tick() {
  const now = Date.now();
  const allowed = new Set(selectBudgeted(subscribers.values()).map((s) => s.id));

  for (const sub of subscribers.values()) {
    if (!allowed.has(sub.id)) continue;

    const slot = slotAt(now, sub.offset, sub.slots, sub.cycleMs);
    if (slot !== sub.lastSlot) {
      sub.lastSlot = slot;
      sub.listener(slot);
    }
  }
}

function start() {
  if (timer !== null || typeof window === 'undefined') return;
  if (prefersReducedMotion()) return;
  if (document.visibilityState === 'hidden') return;

  // A quarter of a second is far finer than any slot change needs, and is
  // still 1/15th the wakeups of rAF. It exists so a change lands near its
  // true moment rather than up to a second late.
  timer = setInterval(tick, 250);
}

function stop() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function ensureLifecycle() {
  if (started || typeof window === 'undefined') return;
  started = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop();
    else if (subscribers.size > 0) start();
  });

  // Someone turning reduced motion on mid-session should be obeyed at once.
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener?.(
    'change',
    (event) => {
      if (event.matches) {
        stop();
        // Put everything back to its first slot, so nothing is left stranded
        // mid-cycle showing a picture that is not the cover.
        for (const sub of subscribers.values()) {
          sub.lastSlot = 0;
          sub.listener(0);
        }
      } else if (subscribers.size > 0) {
        start();
      }
    },
  );
}

export interface ConductorHandle {
  /** Tell the Conductor whether this tile is on screen. */
  setVisible: (visible: boolean) => void;
  unsubscribe: () => void;
}

/**
 * Join the clock.
 *
 * `slots` is how many pictures this subscriber cycles through; one or fewer
 * means there is nothing to cycle and the subscription is a no-op, which is the
 * common case and should cost nothing.
 *
 * `cycleMs` lets a caller hold its pictures longer than the house default
 * without giving itself a second clock -- the wave, the budget, the tab and
 * reduced-motion rules all still apply, which is the whole point of there
 * being one Conductor.
 */
export function subscribe(
  id: string,
  slots: number,
  listener: Listener,
  cycleMs: number = CYCLE_MS,
): ConductorHandle {
  if (slots <= 1 || prefersReducedMotion()) {
    return { setVisible: () => {}, unsubscribe: () => {} };
  }

  ensureLifecycle();

  const sub: Subscriber = {
    id,
    slots,
    offset: phaseOffset(id),
    cycleMs: cycleMs > 0 ? cycleMs : CYCLE_MS,
    listener,
    visible: false,
    lastSlot: 0,
  };
  subscribers.set(id, sub);
  start();

  return {
    setVisible: (visible: boolean) => {
      sub.visible = visible;
      // A tile leaving the screen goes back to its cover, so scrolling back up
      // does not find it mid-cycle on a detail shot.
      if (!visible && sub.lastSlot !== 0) {
        sub.lastSlot = 0;
        sub.listener(0);
      }
    },
    unsubscribe: () => {
      subscribers.delete(id);
      if (subscribers.size === 0) stop();
    },
  };
}

/** Exposed for tests: the constants the behaviour is defined by. */
export const CONDUCTOR = { CYCLE_MS, MOTION_BUDGET };
