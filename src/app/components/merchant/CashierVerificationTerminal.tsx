/**
 * CashierVerificationTerminal
 *
 * The merchant-facing POS component for gift voucher redemption.
 *
 * Product-Bound Liability Shield:
 *   This screen intentionally and permanently conceals all financial data —
 *   no prices, no ZMW amounts, no account balances. The cashier sees only
 *   the physical item to hand over and the recipient's name.
 *
 * States:
 *   IDLE      → Code input + "Verify" CTA
 *   SCANNING  → Loading indicator while Edge Function is in flight
 *   APPROVED  → Full-bleed, high-contrast confirmation; item name in display type
 *   REJECTED  → Structured rejection screen with reason and reset action
 *
 * Design language: Apple-derived — thin strokes, slate/white palette,
 * bold display typography for at-a-distance legibility, zero emojis.
 */

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '../ui/input-otp';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { supabase } from '../../../lib/supabaseClient';
import { projectId } from '../../../utils/supabase/info';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FULFILL_VOUCHER_URL =
  `https://${projectId}.supabase.co/functions/v1/fulfill-voucher` as const;

const CLAIM_CODE_LENGTH = 8 as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TerminalStatus = 'IDLE' | 'SCANNING' | 'APPROVED' | 'REJECTED';

interface ApprovedResult {
  voucher_id: string;
  item_name: string;
  recipient_name: string;
  claim_code: string;
}

interface RejectedResult {
  rejection_reason: string;
  raw_error: string;
}

export interface CashierVerificationTerminalProps {
  /**
   * The UUID of the shop this terminal belongs to.
   * Passed as `shop_id` in the fulfill-voucher payload and used by the
   * Edge Function to enforce shop-boundary isolation.
   */
  shopId: string;

  /**
   * Optional callback fired after a successful redemption.
   * Use this to trigger any post-redemption side-effects (e.g. increment
   * a session counter, play a confirmation sound, etc.).
   */
  onApproved?: (result: ApprovedResult) => void;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

/**
 * Calls the `fulfill-voucher` Edge Function with the merchant's JWT and
 * the scanned claim code. Returns a typed discriminated union result.
 */
async function callFulfillVoucher(
  claimCode: string,
  shopId: string,
  accessToken: string,
): Promise<
  | { ok: true; data: ApprovedResult }
  | { ok: false; rejection_reason: string; raw_error: string }
> {
  const response = await fetch(FULFILL_VOUCHER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ claim_code: claimCode, shop_id: shopId }),
  });

  let payload: Record<string, unknown>;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      rejection_reason: 'The server returned an unreadable response.',
      raw_error: `HTTP ${response.status} with non-JSON body`,
    };
  }

  if (response.ok && payload.success === true) {
    return { ok: true, data: payload as unknown as ApprovedResult };
  }

  // Distinguish a FRAUD_REJECTION from a generic server error for display.
  const rejectionReason =
    typeof payload.rejection_reason === 'string'
      ? payload.rejection_reason
      : typeof payload.error === 'string'
        ? payload.error
        : 'Verification failed. Please try again.';

  return {
    ok: false,
    rejection_reason: rejectionReason,
    raw_error: `HTTP ${response.status}`,
  };
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const panelVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit:   { opacity: 0, y: -12, transition: { duration: 0.2, ease: 'easeIn' } },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---- Scanning state --------------------------------------------------------

function ScanningView() {
  return (
    <motion.div
      key="scanning"
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex flex-col items-center gap-8"
    >
      <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden>
        <motion.span
          className="absolute h-20 w-20 rounded-full border border-slate-200"
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.1, 0.5] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.span
          className="absolute h-12 w-12 rounded-full border border-slate-300"
          animate={{ scale: [1, 1.1, 1], opacity: [0.7, 0.2, 0.7] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
        />
        <span className="h-5 w-5 rounded-full bg-slate-800" />
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-lg font-medium text-slate-900">Verifying code</p>
        <p className="text-sm font-normal text-slate-500">
          Checking the secure ledger...
        </p>
      </div>
    </motion.div>
  );
}

// ---- Approved state --------------------------------------------------------

function ApprovedView({
  result,
  onReset,
}: {
  result: ApprovedResult;
  onReset: () => void;
}) {
  return (
    <motion.div
      key="approved"
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex w-full flex-col items-center gap-8"
    >
      {/* ------------------------------------------------------------------ */}
      {/* STATUS BADGE — large, readable from distance                        */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        className="flex w-full flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 py-8"
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Animated check ring */}
        <motion.div
          className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-200 bg-white"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 text-slate-900"
          >
            <motion.path
              d="M4.5 12.75l6 6 9-13.5"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.55, ease: 'easeOut', delay: 0.25 }}
            />
          </svg>
        </motion.div>

        {/* APPROVED label */}
        <motion.span
          className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          Approved
        </motion.span>

        {/* Item name — maximum legibility, display-size type */}
        <motion.p
          className={cn(
            'text-center text-4xl font-bold leading-tight tracking-tight text-slate-900',
            'max-w-xs px-4',
          )}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          aria-label={`Approved item: ${result.item_name}`}
        >
          {result.item_name}
        </motion.p>
      </motion.div>

      {/* ------------------------------------------------------------------ */}
      {/* RECIPIENT STRIP — thin, restrained                                  */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        className="flex w-full flex-col gap-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
      >
        <span className="text-xs font-medium uppercase tracking-widest text-slate-400">
          Hand over to
        </span>
        <p className="text-2xl font-medium text-slate-800">
          {result.recipient_name}
        </p>
      </motion.div>

      {/* ------------------------------------------------------------------ */}
      {/* Code echo — small, for receipt purposes only                        */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <span className="text-xs font-normal text-slate-400">Claim code</span>
        <span className="font-mono text-sm font-medium tabular-nums text-slate-600">
          {result.claim_code}
        </span>
      </motion.div>

      {/* ------------------------------------------------------------------ */}
      {/* Divider                                                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="h-px w-full bg-slate-100" />

      {/* ------------------------------------------------------------------ */}
      {/* Reset CTA                                                           */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        className="w-full"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <Button
          className="w-full rounded-xl bg-slate-900 py-5 text-sm font-medium tracking-wide text-white hover:bg-slate-800"
          onClick={onReset}
        >
          Verify next code
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ---- Rejected state --------------------------------------------------------

function RejectedView({
  result,
  onReset,
}: {
  result: RejectedResult;
  onReset: () => void;
}) {
  return (
    <motion.div
      key="rejected"
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex w-full flex-col items-center gap-8"
    >
      {/* Status block */}
      <motion.div
        className="flex w-full flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 py-8"
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* X mark */}
        <motion.div
          className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-200 bg-white"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 text-slate-400"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </motion.div>

        {/* REJECTED label */}
        <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
          Rejected
        </span>

        {/* Large status text */}
        <p className="text-4xl font-bold tracking-tight text-slate-900">
          Do Not Redeem
        </p>
      </motion.div>

      {/* Reason card */}
      <motion.div
        className="w-full rounded-xl border border-slate-100 bg-slate-50 p-5"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Reason
        </p>
        <p className="text-sm font-normal leading-relaxed text-slate-600">
          {result.rejection_reason}
        </p>
      </motion.div>

      {/* Instructions */}
      <motion.div
        className="w-full rounded-xl border border-slate-100 p-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Next steps
        </p>
        <ol className="space-y-2 text-sm font-normal leading-relaxed text-slate-600">
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs font-medium text-slate-500">
              1
            </span>
            <span>Do not hand over any item — this code is invalid for this terminal.</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs font-medium text-slate-500">
              2
            </span>
            <span>Ask the customer to show their WhatsApp confirmation for the correct code.</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs font-medium text-slate-500">
              3
            </span>
            <span>If you believe this is an error, contact KithLy merchant support.</span>
          </li>
        </ol>
      </motion.div>

      <div className="h-px w-full bg-slate-100" />

      {/* Reset CTA */}
      <motion.div
        className="flex w-full flex-col gap-3"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Button
          className="w-full rounded-xl bg-slate-900 py-5 text-sm font-medium tracking-wide text-white hover:bg-slate-800"
          onClick={onReset}
        >
          Try another code
        </Button>
        <Button
          variant="ghost"
          className="w-full rounded-xl py-5 text-sm font-normal text-slate-400 hover:text-slate-600"
          onClick={() => window.open('mailto:merchants@kithly.com', '_blank')}
        >
          Contact merchant support
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ---- Idle state (code entry) -----------------------------------------------

function IdleView({
  code,
  onCodeChange,
  onSubmit,
  isDisabled,
}: {
  code: string;
  onCodeChange: (v: string) => void;
  onSubmit: () => void;
  isDisabled: boolean;
}) {
  const isComplete = code.length === CLAIM_CODE_LENGTH;

  return (
    <motion.div
      key="idle"
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex w-full flex-col items-center gap-8"
    >
      {/* Header */}
      <div className="flex w-full flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-slate-900">Scan gift code</h1>
        <p className="text-sm font-normal text-slate-500">
          Enter the 8-character code from the customer's WhatsApp message.
        </p>
      </div>

      {/* OTP input — 4+4 segmented, consistent with existing HandshakeTerminal */}
      <div
        className="flex w-full flex-col items-center gap-6"
        role="group"
        aria-label="8-character gift code entry"
      >
        <InputOTP
          maxLength={CLAIM_CODE_LENGTH}
          value={code}
          onChange={onCodeChange}
          onComplete={onSubmit}
          aria-label="Gift claim code"
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} className="h-14 w-11 text-lg font-mono uppercase" />
            <InputOTPSlot index={1} className="h-14 w-11 text-lg font-mono uppercase" />
            <InputOTPSlot index={2} className="h-14 w-11 text-lg font-mono uppercase" />
            <InputOTPSlot index={3} className="h-14 w-11 text-lg font-mono uppercase" />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={4} className="h-14 w-11 text-lg font-mono uppercase" />
            <InputOTPSlot index={5} className="h-14 w-11 text-lg font-mono uppercase" />
            <InputOTPSlot index={6} className="h-14 w-11 text-lg font-mono uppercase" />
            <InputOTPSlot index={7} className="h-14 w-11 text-lg font-mono uppercase" />
          </InputOTPGroup>
        </InputOTP>

        <p className="text-xs font-normal text-slate-400">
          The code auto-submits when all 8 characters are entered.
        </p>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-slate-100" />

      {/* Verify button */}
      <Button
        className={cn(
          'w-full rounded-xl py-5 text-sm font-medium tracking-wide',
          isComplete && !isDisabled
            ? 'bg-slate-900 text-white hover:bg-slate-800'
            : 'cursor-not-allowed bg-slate-100 text-slate-400',
        )}
        disabled={!isComplete || isDisabled}
        aria-disabled={!isComplete || isDisabled}
        onClick={onSubmit}
        id="verify-button"
      >
        Verify Code
      </Button>

      {/* Shield notice — explicit financial data exclusion label */}
      <div className="flex w-full items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
          aria-hidden
        >
          <path d="M10 2L3 5v5c0 4.4 3 8.5 7 9.5C14 18.5 17 14.4 17 10V5L10 2z" />
        </svg>
        <p className="text-xs font-normal leading-relaxed text-slate-500">
          This terminal displays{' '}
          <span className="font-medium text-slate-700">item information only</span>.
          No pricing or account data is shown on this screen. Liability for item
          fulfillment is governed by the KithLy Merchant Agreement.
        </p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function CashierVerificationTerminal({
  shopId,
  onApproved,
}: CashierVerificationTerminalProps) {

  // ---- State ---------------------------------------------------------------

  const [status, setStatus] = useState<TerminalStatus>('IDLE');
  const [code, setCode] = useState<string>('');
  const [approvedResult, setApprovedResult] = useState<ApprovedResult | null>(null);
  const [rejectedResult, setRejectedResult] = useState<RejectedResult | null>(null);

  /**
   * Guard ref to prevent double-submissions from rapid taps or the OTP
   * `onComplete` + button `onClick` firing simultaneously.
   */
  const isSubmittingRef = useRef<boolean>(false);

  // ---- Handlers ------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (isSubmittingRef.current || code.length !== CLAIM_CODE_LENGTH) return;
    isSubmittingRef.current = true;
    setStatus('SCANNING');

    try {
      // Retrieve the merchant's active session JWT.
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        toast.error('Session expired', {
          description: 'Please log in again and retry.',
        });
        setStatus('IDLE');
        return;
      }

      const result = await callFulfillVoucher(code, shopId, session.access_token);

      if (result.ok) {
        setApprovedResult(result.data);
        setStatus('APPROVED');
        onApproved?.(result.data);
        // Tactile feedback on devices that support it
        if ('vibrate' in navigator) {
          navigator.vibrate([80, 40, 80]);
        }
        toast.success('Code approved', {
          description: `${result.data.item_name} — for ${result.data.recipient_name}`,
        });
      } else {
        setRejectedResult({
          rejection_reason: result.rejection_reason,
          raw_error: result.raw_error,
        });
        setStatus('REJECTED');
        if ('vibrate' in navigator) {
          navigator.vibrate([300]);
        }
        toast.error('Code rejected', {
          description: result.rejection_reason,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      console.error('[CashierVerificationTerminal] Unhandled error:', message);
      toast.error('Verification failed', {
        description: 'A connection error occurred. Please check your network and try again.',
      });
      setStatus('IDLE');
    } finally {
      isSubmittingRef.current = false;
    }
  }, [code, shopId, onApproved]);

  const handleReset = useCallback(() => {
    setCode('');
    setApprovedResult(null);
    setRejectedResult(null);
    setStatus('IDLE');
  }, []);

  // ---- ARIA live region message -------------------------------------------

  const liveMessage =
    status === 'SCANNING'
      ? 'Verifying code. Please wait.'
      : status === 'APPROVED'
        ? `Code approved. Hand over ${approvedResult?.item_name} to ${approvedResult?.recipient_name}.`
        : status === 'REJECTED'
          ? `Code rejected. ${rejectedResult?.rejection_reason}`
          : '';

  // ---- Render --------------------------------------------------------------

  return (
    <div
      className={cn(
        'flex min-h-screen w-full flex-col items-center justify-start',
        'bg-white px-6 py-10',
      )}
    >
      {/* ARIA live region */}
      <span
        role="status"
        aria-live={status === 'REJECTED' ? 'assertive' : 'polite'}
        aria-atomic="true"
        className="sr-only"
      >
        {liveMessage}
      </span>

      {/* Centred card */}
      <div className="w-full max-w-sm">

        {/* Wordmark */}
        <motion.div
          className="mb-10 flex items-center justify-between"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <span className="text-xs font-medium uppercase tracking-[0.25em] text-slate-300">
            KithLy
          </span>
          <span className="text-xs font-normal text-slate-300">
            Merchant Terminal
          </span>
        </motion.div>

        {/* State panel — AnimatePresence handles cross-fade between views */}
        <AnimatePresence mode="wait">
          {status === 'IDLE' && (
            <IdleView
              key="idle"
              code={code}
              onCodeChange={setCode}
              onSubmit={handleSubmit}
              isDisabled={false}
            />
          )}

          {status === 'SCANNING' && (
            <ScanningView key="scanning" />
          )}

          {status === 'APPROVED' && approvedResult && (
            <ApprovedView
              key="approved"
              result={approvedResult}
              onReset={handleReset}
            />
          )}

          {status === 'REJECTED' && rejectedResult && (
            <RejectedView
              key="rejected"
              result={rejectedResult}
              onReset={handleReset}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default CashierVerificationTerminal;
