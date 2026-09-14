// Signal capture — batched, fire-and-forget, and never in the way.
//
// kithly_reco.signals has existed since Stage 1d and nothing has been writing
// to it. That was the plan -- land the log early so it fills during V3 -- but a
// log nothing writes to is the same as no log, and Stage 6's ranker opens
// against whatever is in here.
//
// THREE RULES, ALL OF THEM ABOUT NOT HARMING THE PAGE
// ---------------------------------------------------
// 1. Never awaited. A tap that waits on analytics is a slow tap. Every call
//    here returns immediately and the write happens later, off the critical
//    path.
// 2. Never throws. A failed insert must be invisible: the shopper is trying to
//    buy something, and instrumentation that can break that is worse than no
//    instrumentation.
// 3. Never chatty. Impressions arrive by the dozen as a grid scrolls, so they
//    are batched and flushed on a timer, on page hide, and when the batch is
//    full -- not one request per tile.
//
// WHAT IS NOT RECORDED
// --------------------
// No page URLs, no free text, no query strings beyond a search term the person
// typed themselves. `session_id` is a random id generated in this tab and kept
// in sessionStorage: it dies with the tab, is never sent anywhere else, and
// exists so an anonymous run of the storefront is one sequence rather than
// twenty orphans.

import { supabase } from '../../lib/supabaseClient';

export type SignalAction =
  | 'impression'
  | 'view'
  | 'tap'
  | 'save'
  | 'add_to_cart'
  | 'purchase'
  | 'dismiss'
  | 'search';

export type SignalSubject = 'item' | 'shop' | 'post' | 'list' | 'collection' | 'experience' | 'query';

export interface Signal {
  surface: string;
  action: SignalAction;
  subject_type: SignalSubject;
  subject_id?: string | null;
  slate_id?: string | null;
  position?: number | null;
  context?: Record<string, unknown>;
}

/** Flush when the batch reaches this, so a fast scroll does not hoard. */
const BATCH_SIZE = 20;
/** Or when this long has passed, so a quiet page still reports. */
const FLUSH_MS = 5000;
const SESSION_KEY = 'kithly_reco_session';

let queue: Array<Signal & { session_id: string | null; user_id: string | null }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let userId: string | null = null;
let enabled = true;

/**
 * A per-tab id, so anonymous browsing is one coherent sequence.
 *
 * sessionStorage rather than localStorage deliberately: this should not follow
 * anybody between visits. It is for stitching one run together, not for
 * recognising a person later.
 */
function sessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Private mode, or storage disabled. Signals still record; they simply are
    // not stitched into a session, which is a smaller loss than failing.
    return null;
  }
}

/** Called once the signed-in user is known, and again on sign-out with null. */
export function identify(id: string | null) {
  userId = id;
}

/**
 * Stop recording entirely.
 *
 * Here so that switching it off is a one-line change rather than an archaeology
 * exercise, and so a future consent control has something to call.
 */
export function setTrackingEnabled(value: boolean) {
  enabled = value;
  if (!value) queue = [];
}

async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;

  const batch = queue;
  queue = [];

  try {
    // Through an RPC, not a table insert: kithly_reco is not on the public API
    // (see 20260914040000), and record_signals stamps the user from auth.uid()
    // rather than trusting the payload -- so a batch cannot be attributed to
    // anybody else however it is shaped.
    await supabase.rpc('record_signals', { p_signals: batch });
  } catch {
    // Deliberately silent and deliberately not retried. A retry queue that
    // grows during an outage is a memory leak on a phone, and these are
    // ambient observations -- losing some costs the ranker very little.
  }
}

function schedule() {
  if (timer !== null) return;
  timer = setTimeout(() => void flush(), FLUSH_MS);
}

/** Record one signal. Returns immediately; the write happens later. */
export function track(signal: Signal): void {
  if (!enabled || typeof window === 'undefined') return;

  queue.push({
    ...signal,
    subject_id: signal.subject_id ?? null,
    slate_id: signal.slate_id ?? null,
    position: signal.position ?? null,
    context: signal.context ?? {},
    session_id: sessionId(),
    user_id: userId,
  });

  if (queue.length >= BATCH_SIZE) void flush();
  else schedule();
}

/**
 * Impressions, which arrive in bulk.
 *
 * Separate because a grid reports twelve at once and pushing them one at a time
 * through `track` would schedule twelve times.
 */
export function trackImpressions(
  surface: string,
  subjects: Array<{ id: string; type?: SignalSubject; position?: number }>,
  slateId?: string | null,
): void {
  for (const subject of subjects) {
    track({
      surface,
      action: 'impression',
      subject_type: subject.type ?? 'item',
      subject_id: subject.id,
      position: subject.position ?? null,
      slate_id: slateId ?? null,
    });
  }
}

// A page being hidden is the last chance to report what happened on it, and
// visibilitychange is the only event phones reliably deliver -- unload is not
// fired when an app is swiped away.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

/** Exposed for tests. */
export const TRACK_INTERNALS = { BATCH_SIZE, FLUSH_MS };
