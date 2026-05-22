/**
 * FxTemporalLock
 *
 * Enforces a strict 10-minute expiration window on FX-locked checkout sessions.
 * Once the FX rate is fetched and locked, this component mounts and begins
 * counting down. When the timer reaches zero it fires `onExpire`, forcing the
 * buyer back to request a fresh rate quote.
 *
 * Design language: Apple-derived — thin strokes, slate/white palette,
 * high-contrast tabular-nums display type, no emojis anywhere.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../ui/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total session duration in milliseconds (10 minutes). */
const SESSION_DURATION_MS = 10 * 60 * 1_000 as const;

/**
 * Interval tick rate in milliseconds.
 *
 * 250 ms gives sub-second visual precision without being CPU-wasteful.
 * The displayed MM:SS only updates when the second changes, so the extra
 * ticks are purely to ensure the countdown never lags a full second behind
 * the real wall clock (which `setInterval` alone cannot guarantee due to
 * timer coalescing and tab-backgrounding throttling).
 */
const TICK_RATE_MS = 250 as const;

/**
 * Urgency threshold in milliseconds. Below this value the component
 * switches to the urgent visual treatment (red accent, faster animation).
 */
const URGENCY_THRESHOLD_MS = 60 * 1_000 as const; // Last 60 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FxTemporalLockProps {
  /**
   * ISO 8601 timestamp of when the FX rate was locked.
   * The session expiry is calculated as: new Date(sessionCreatedAt) + 10 min.
   *
   * Example: "2026-05-21T11:48:00.000Z"
   */
  sessionCreatedAt: string;

  /**
   * Called exactly once when `remainingMs` reaches zero.
   * Use this to invalidate the locked rate and navigate the user back to the
   * rate-quote step so they can request a fresh FX price.
   */
  onExpire: () => void;

  /**
   * Optional: the locked FX rate string to display for buyer confidence.
   * Example: "1 ZMW = 0.03613 GBP"
   * If omitted, the rate row is not rendered.
   */
  lockedRateLabel?: string;

  /**
   * Optional: the target currency code for display labelling.
   * Defaults to "GBP".
   */
  currency?: string;

  /**
   * Optional additional className applied to the outermost container.
   * Use this to control positioning (e.g. absolute/fixed) from the parent.
   */
  className?: string;
}

/** Internal tick result — the authoritative remaining time. */
interface TimerState {
  remainingMs: number;
  expired: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (no React dependency)
// ---------------------------------------------------------------------------

/**
 * Calculates the milliseconds remaining before `sessionCreatedAt + SESSION_DURATION_MS`.
 * Returns 0 if the session has already expired.
 */
function computeRemainingMs(sessionCreatedAt: string): number {
  const createdAt = new Date(sessionCreatedAt).getTime();

  if (Number.isNaN(createdAt)) {
    // Malformed timestamp — treat as already expired so the gate fails safely.
    console.error(
      `[FxTemporalLock] Invalid sessionCreatedAt value: "${sessionCreatedAt}". ` +
      "Treating session as already expired.",
    );
    return 0;
  }

  const expiresAt = createdAt + SESSION_DURATION_MS;
  return Math.max(0, expiresAt - Date.now());
}

/**
 * Formats a millisecond duration as a zero-padded "MM:SS" string.
 *
 * Examples:
 *   600 000 → "10:00"
 *   75 400  → "01:15"
 *   0       → "00:00"
 */
function formatMmSs(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Computes the SVG arc `strokeDashoffset` for the progress ring.
 *
 * @param remainingMs  Current remaining time in ms.
 * @param circumference Full circumference of the SVG circle in px.
 * @returns The dashoffset value — 0 = full ring, circumference = empty ring.
 */
function computeDashOffset(remainingMs: number, circumference: number): number {
  const fraction = Math.max(0, Math.min(1, remainingMs / SESSION_DURATION_MS));
  // We deplete the arc clockwise: full at start, empty at 00:00.
  return circumference * (1 - fraction);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Radius of the SVG progress ring (in SVG user units). */
const RING_RADIUS = 42 as const;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ≈ 263.9 px

/**
 * Circular SVG arc that depletes from full to empty over the session window.
 * Renders in slate for normal time, transitions to a warm red for urgency.
 */
function ProgressRing({
  remainingMs,
  isUrgent,
  isExpired,
}: {
  remainingMs: number;
  isUrgent: boolean;
  isExpired: boolean;
}) {
  const dashOffset = computeDashOffset(remainingMs, RING_CIRCUMFERENCE);

  // Track colour: slate-200 (track), primary arc changes by urgency state.
  const arcColour = isExpired
    ? '#ef4444'   // red-500
    : isUrgent
      ? '#f97316' // orange-500 → KithLy brand colour for maximum salience
      : '#0f172a'; // slate-900

  return (
    <svg
      viewBox="0 0 100 100"
      className="h-full w-full -rotate-90"
      aria-hidden
    >
      {/* Track ring */}
      <circle
        cx="50"
        cy="50"
        r={RING_RADIUS}
        fill="none"
        stroke="#f1f5f9"  // slate-100
        strokeWidth="3"
      />
      {/* Progress arc */}
      <circle
        cx="50"
        cy="50"
        r={RING_RADIUS}
        fill="none"
        stroke={arcColour}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.4s ease' }}
      />
    </svg>
  );
}

/**
 * The large MM:SS display numeral.
 * Uses tabular-nums + font-mono to prevent layout shift as digits change.
 */
function CountdownDisplay({
  formatted,
  isUrgent,
  isExpired,
}: {
  formatted: string;
  isUrgent: boolean;
  isExpired: boolean;
}) {
  const colourClass = isExpired
    ? 'text-red-500'
    : isUrgent
      ? 'text-orange-500'
      : 'text-slate-900';

  return (
    <span
      className={cn(
        'absolute inset-0 flex items-center justify-center',
        'font-mono text-2xl font-light tabular-nums tracking-tight',
        'select-none transition-colors duration-400',
        colourClass,
      )}
      aria-hidden // The live region below provides the accessible label
    >
      {formatted}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function FxTemporalLock({
  sessionCreatedAt,
  onExpire,
  lockedRateLabel,
  currency = 'GBP',
  className,
}: FxTemporalLockProps) {

  // ---- Timer state ---------------------------------------------------------

  const [timerState, setTimerState] = useState<TimerState>(() => {
    const remaining = computeRemainingMs(sessionCreatedAt);
    return { remainingMs: remaining, expired: remaining === 0 };
  });

  /**
   * We store onExpire in a ref so the interval callback always calls the
   * latest version of the function, regardless of re-renders. This avoids
   * stale closure bugs without requiring the caller to memoize the callback.
   */
  const onExpireRef = useRef<() => void>(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  /**
   * A ref that tracks whether onExpire has already been called.
   * Guarantees exactly-once semantics even if the effect runs multiple times
   * (e.g. in React Strict Mode's double-invocation).
   */
  const expiredFiredRef = useRef<boolean>(false);

  // ---- Interval management -------------------------------------------------

  const tick = useCallback(() => {
    const remaining = computeRemainingMs(sessionCreatedAt);
    const expired = remaining === 0;

    setTimerState({ remainingMs: remaining, expired });

    if (expired && !expiredFiredRef.current) {
      expiredFiredRef.current = true;
      // Fire synchronously inside the tick so the callback executes in the
      // same event loop turn that detected expiry — no setTimeout deferral.
      onExpireRef.current();
    }
  }, [sessionCreatedAt]);

  useEffect(() => {
    // If the session was already expired at mount time (e.g. a stale prop),
    // fire immediately without arming an interval.
    const initialRemaining = computeRemainingMs(sessionCreatedAt);
    if (initialRemaining === 0 && !expiredFiredRef.current) {
      expiredFiredRef.current = true;
      onExpireRef.current();
      return;
    }

    // Arm the tick interval.
    const intervalId = setInterval(tick, TICK_RATE_MS);

    // Cleanup on unmount or when sessionCreatedAt changes.
    // This prevents memory leaks and stale ticks when the parent re-mounts.
    return () => {
      clearInterval(intervalId);
    };
  }, [sessionCreatedAt, tick]);

  // ---- Derived display values ----------------------------------------------

  const { remainingMs, expired } = timerState;
  const isUrgent = !expired && remainingMs <= URGENCY_THRESHOLD_MS;
  const formatted = formatMmSs(remainingMs);

  // Progress as a 0–100 integer for the ARIA value attribute.
  const progressPct = Math.round((remainingMs / SESSION_DURATION_MS) * 100);

  // Human-readable label for the ARIA live region.
  const liveLabel = expired
    ? 'Rate quote has expired. Please request a new rate.'
    : `Rate lock expires in ${formatted}.${isUrgent ? ' Act quickly.' : ''}`;

  // ---- Render --------------------------------------------------------------

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-6',
        className,
      )}
    >
      {/* ARIA live region — announces the countdown to screen readers */}
      <span
        role="timer"
        aria-live={isUrgent ? 'assertive' : 'polite'}
        aria-atomic="true"
        aria-label={liveLabel}
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="sr-only"
      >
        {liveLabel}
      </span>

      {/* ------------------------------------------------------------------ */}
      {/* Header label                                                         */}
      {/* ------------------------------------------------------------------ */}
      <motion.p
        className="text-xs font-medium uppercase tracking-widest text-slate-400"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        Rate lock expires in
      </motion.p>

      {/* ------------------------------------------------------------------ */}
      {/* Ring + countdown display                                             */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        className="relative h-28 w-28"
        initial={{ scale: 0.88, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <ProgressRing
          remainingMs={remainingMs}
          isUrgent={isUrgent}
          isExpired={expired}
        />
        <CountdownDisplay
          formatted={formatted}
          isUrgent={isUrgent}
          isExpired={expired}
        />
      </motion.div>

      {/* ------------------------------------------------------------------ */}
      {/* Locked rate label (optional)                                         */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {lockedRateLabel && !expired && (
          <motion.div
            className="flex flex-col items-center gap-1"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <span className="text-xs font-normal text-slate-400">
              Locked rate
            </span>
            <span className="font-mono text-sm font-light tabular-nums text-slate-600">
              {lockedRateLabel}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Urgency warning pill — fades in when ≤ 60 s remain                  */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {isUrgent && !expired && (
          <motion.div
            key="urgency"
            className={cn(
              'flex items-center gap-2 rounded-full px-3.5 py-1.5',
              'border border-orange-100 bg-orange-50',
            )}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            role="alert"
          >
            {/* Pulsing dot — no emoji */}
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-orange-400"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              aria-hidden
            />
            <span className="text-xs font-medium text-orange-600">
              Complete your payment before the rate expires
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Expired state overlay                                                */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {expired && (
          <motion.div
            key="expired"
            className="flex flex-col items-center gap-3 text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            role="alert"
          >
            <p className="text-sm font-normal leading-relaxed text-slate-500">
              Your{' '}
              <span className="font-medium text-slate-700">{currency}</span>
              {' '}rate quote has expired. Currency rates fluctuate continuously
              — request a new quote to get the current price.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Footer note — shown while timer is active                            */}
      {/* ------------------------------------------------------------------ */}
      {!expired && (
        <motion.p
          className="text-center text-xs font-normal leading-relaxed text-slate-400"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          This rate is held for 10 minutes. Prices update after expiry
          to reflect live market conditions.
        </motion.p>
      )}
    </div>
  );
}

export default FxTemporalLock;
