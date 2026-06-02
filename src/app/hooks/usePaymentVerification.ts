/**
 * usePaymentVerification
 *
 * Layer B — KithLy Payment Defense Flow
 *
 * Purpose:
 *   Heals dropped webhooks by polling the authoritative `transactions` row on a
 *   fixed interval until `status` becomes `SUCCESSFUL` (set by the webhook).
 *
 * Polling contract:
 *   - Fires every 3 000 ms (POLL_INTERVAL_MS).
 *   - Stops automatically after MAX_ATTEMPTS ticks (~60 s) with a TIMEOUT.
 *   - Stops immediately when the confirmation event is found (SUCCESS).
 *   - Cleans up the interval if the consuming component unmounts at any point,
 *     preventing memory leaks and stale state updates.
 *
 * Usage:
 *   const { status, attemptCount } = usePaymentVerification({
 *     voucherId: '...uuid...',
 *     onSuccess: () => router.push('/confirmation'),
 *   });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds between each poll tick. */
const POLL_INTERVAL_MS = 3_000 as const;

/**
 * Maximum number of poll attempts before the hook gives up and returns TIMEOUT.
 * 100 attempts × 3 000 ms = 300 000 ms (5 minutes).
 */
const MAX_ATTEMPTS = 100 as const;

/** Terminal status written by the Flutterwave webhook handler. */
const PAID_STATUS = 'SUCCESSFUL' as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All possible states the payment verification process can be in.
 *
 *   IDLE     — The hook has been given a null/undefined voucherId and has
 *              not started polling. Safe initial state before checkout-init
 *              returns a voucher.
 *
 *   POLLING  — An interval is active and ticks are being dispatched.
 *
 *   SUCCESS  — The transaction reached status SUCCESSFUL.
 *              The interval has been cleared.
 *
 *   TIMEOUT  — MAX_ATTEMPTS ticks elapsed without finding the event.
 *              The interval has been cleared. The UI should surface a manual
 *              recovery option (e.g. "Check payment status" button).
 *
 *   ERROR    — An unexpected Supabase client error occurred. The interval
 *              has been cleared. Distinct from TIMEOUT so the UI can show
 *              a different message (network/DB error vs. webhook delay).
 */
export type PaymentVerificationStatus =
  | 'IDLE'
  | 'POLLING'
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'ERROR';

interface TransactionStatusRow {
  transaction_id: string;
  status: string;
}

/** Arguments accepted by the hook. */
export interface UsePaymentVerificationOptions {
  /**
   * The voucher UUID returned by the `checkout-init` Edge Function.
   * Pass `null` or `undefined` to keep the hook in IDLE state (e.g. while
   * checkout-init is still in flight).
   */
  voucherId: string | null | undefined;

  /**
   * Called exactly once when a SUCCESS is detected, synchronously before the
   * component re-renders with `status: 'SUCCESS'`. Use this to navigate to a
   * confirmation screen or trigger any post-payment side-effects.
   *
   * The callback is captured in a ref internally, so you are safe to pass an
   * unstable function reference (e.g. an inline arrow) without wrapping it in
   * useCallback at the call site — it will always reflect the latest closure.
   */
  onSuccess?: () => void;

  /**
   * Optional override for the polling interval in milliseconds.
   * Defaults to POLL_INTERVAL_MS (3 000 ms). Exposed primarily for testing.
   */
  intervalMs?: number;

  /**
   * Optional override for the maximum number of polling attempts.
   * Defaults to MAX_ATTEMPTS (20). Exposed primarily for testing.
   */
  maxAttempts?: number;
}

/** Values returned by the hook to the consuming component. */
export interface UsePaymentVerificationResult {
  /** Current lifecycle state of the verification process. */
  status: PaymentVerificationStatus;

  /**
   * How many poll ticks have fired so far. Useful for displaying a progress
   * indicator like "Verifying payment… (attempt 4 of 20)".
   */
  attemptCount: number;

  /**
   * Call this to manually reset the hook back to IDLE and restart polling
   * with the same voucherId. Intended for "Try Again" UI recovery buttons
   * shown when status === 'TIMEOUT' or status === 'ERROR'.
   */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function usePaymentVerification({
  voucherId,
  onSuccess,
  intervalMs = POLL_INTERVAL_MS,
  maxAttempts = MAX_ATTEMPTS,
}: UsePaymentVerificationOptions): UsePaymentVerificationResult {

  const [status, setStatus] = useState<PaymentVerificationStatus>('IDLE');
  const [attemptCount, setAttemptCount] = useState<number>(0);

  /**
   * We store the interval ID in a ref (not state) so that:
   *   a) clearing the interval does not trigger a re-render, and
   *   b) the cleanup function in useEffect always has access to the latest ID
   *      without needing to list it as a dependency.
   */
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Attempt counter in a ref as well — read inside the interval callback
   * where stale closure state would otherwise cause incorrect TIMEOUT logic.
   */
  const attemptCountRef = useRef<number>(0);

  /**
   * Store onSuccess in a ref so the interval callback always calls the latest
   * version of the function, even if the parent component re-renders and passes
   * a new closure. This eliminates the need for the caller to memoize it.
   */
  const onSuccessRef = useRef<(() => void) | undefined>(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  /**
   * A ref that tracks whether the component that owns this hook is still
   * mounted. We set it to false in the cleanup function so that async
   * Supabase query callbacks never call setState on an unmounted component.
   */
  const isMountedRef = useRef<boolean>(true);

  /** Tears down the active interval and resets the ref to null. */
  const clearActiveInterval = useCallback(() => {
    if (intervalIdRef.current !== null) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
  }, []);

  /**
   * Core poll function — executed on every interval tick.
   *
   * Queries `transactions` for payment confirmation:
   *   transaction_id = voucherId (checkout-init UUID)
   *   status         = 'SUCCESSFUL'
   *
   * We use `.maybeSingle()` rather than `.single()` so that "no rows found"
   * is returned as `{ data: null, error: null }` instead of throwing an
   * error — the distinction between "not yet present" and a real DB error
   * is semantically significant here.
   */
  const poll = useCallback(async (currentVoucherId: string): Promise<void> => {
    // Increment the attempt counter ref atomically before the async call so
    // that even if two ticks somehow overlap (shouldn't happen with sync
    // setInterval, but defensive), the count stays accurate.
    attemptCountRef.current += 1;
    const thisAttempt = attemptCountRef.current;

    // Sync state for the progress display. This is fire-and-forget from the
    // poll's perspective; we don't await the setState.
    if (isMountedRef.current) {
      setAttemptCount(thisAttempt);
    }

    // --- TIMEOUT CHECK (before the async query) ---
    // If we've already hit the max, stop now instead of firing one more query.
    if (thisAttempt > maxAttempts) {
      clearActiveInterval();
      if (isMountedRef.current) {
        setStatus('TIMEOUT');
      }
      console.warn(
        `[usePaymentVerification] TIMEOUT: transaction '${currentVoucherId}' not SUCCESSFUL after ${maxAttempts} attempts (~${(maxAttempts * intervalMs) / 1_000}s).`,
      );
      return;
    }

    console.log(
      `[usePaymentVerification] Poll tick ${thisAttempt}/${maxAttempts} for voucher '${currentVoucherId}'`,
    );

    // --- DATABASE QUERY ---
    try {
      const { data: txnRow, error: queryError } = await supabase
        .from('transactions')
        .select('transaction_id, status')
        .eq('transaction_id', currentVoucherId)
        .eq('status', PAID_STATUS)
        .maybeSingle<TransactionStatusRow>();

      // Guard: the component may have unmounted while the query was in flight.
      if (!isMountedRef.current) {
        return;
      }

      // --- ERROR BRANCH ---
      if (queryError) {
        clearActiveInterval();
        setStatus('ERROR');
        console.error(
          `[usePaymentVerification] Supabase query error on attempt ${thisAttempt}:`,
          queryError.code,
          queryError.message,
        );
        return;
      }

      // --- SUCCESS BRANCH ---
      if (txnRow !== null) {
        clearActiveInterval();
        console.log(
          `[usePaymentVerification] SUCCESS: transaction ${txnRow.transaction_id} is SUCCESSFUL on attempt ${thisAttempt}.`,
        );
        // Fire the callback before updating state so the parent can start its
        // own transition logic (e.g. navigation) before this component re-renders.
        onSuccessRef.current?.();
        setStatus('SUCCESS');
        return;
      }

      // --- NOT YET FOUND — check if this was the final allowed attempt ---
      if (thisAttempt >= maxAttempts) {
        clearActiveInterval();
        setStatus('TIMEOUT');
        console.warn(
          `[usePaymentVerification] TIMEOUT: final attempt ${thisAttempt} exhausted for voucher '${currentVoucherId}'.`,
        );
      }
      // Otherwise: interval continues; next tick will call poll() again.
    } catch (err) {
      clearActiveInterval();
      if (isMountedRef.current) {
        setStatus('ERROR');
      }
      console.error(
        `[usePaymentVerification] Unexpected exception on attempt ${thisAttempt}:`,
        err,
      );
    }
  }, [clearActiveInterval, intervalMs, maxAttempts]);

  /**
   * reset — allows the consuming component to restart the polling cycle
   * without unmounting, for "Try Again" recovery flows.
   */
  const reset = useCallback(() => {
    clearActiveInterval();
    attemptCountRef.current = 0;
    setAttemptCount(0);
    setStatus(voucherId ? 'POLLING' : 'IDLE');
    // The main useEffect below will re-arm the interval when status becomes
    // POLLING — we don't start it here directly to keep a single source of
    // truth for interval management.
  }, [clearActiveInterval, voucherId]);

  // ---------------------------------------------------------------------------
  // Main effect — arms and cleans up the polling interval
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Mark component as mounted on every effect run.
    isMountedRef.current = true;

    // If no voucherId has been provided yet, stay in IDLE — nothing to poll.
    if (!voucherId) {
      setStatus('IDLE');
      return;
    }

    // If a terminal state was reached (SUCCESS / TIMEOUT / ERROR) do not re-arm.
    // The reset() function is the only way to re-enter POLLING from those states.
    if (status === 'SUCCESS' || status === 'TIMEOUT' || status === 'ERROR') {
      return;
    }

    // Reset counters when a fresh voucherId is provided (e.g. user starts a
    // new checkout without unmounting the parent screen).
    attemptCountRef.current = 0;
    setAttemptCount(0);
    setStatus('POLLING');

    // Fire the first tick immediately so the user doesn't wait a full 3s for
    // the first check — especially useful when the webhook is fast.
    poll(voucherId);

    // Arm the recurring interval for subsequent ticks.
    intervalIdRef.current = setInterval(() => {
      poll(voucherId);
    }, intervalMs);

    // Cleanup: runs when voucherId changes, component unmounts, or status
    // enters a terminal state (via the dependency array below).
    return () => {
      isMountedRef.current = false;
      clearActiveInterval();
    };

  // We intentionally exclude `status` from the dependency array here.
  // Including it would cause the effect to re-run and re-arm the interval
  // every time `poll()` updates status (e.g. on each POLLING→POLLING tick),
  // creating an infinite re-arm loop. The terminal-state guard above handles
  // the SUCCESS/TIMEOUT/ERROR cases correctly without needing status in deps.
  //
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherId, poll, clearActiveInterval, intervalMs]);

  return { status, attemptCount, reset };
}
