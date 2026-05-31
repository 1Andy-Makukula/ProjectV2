/**
 * PaymentProcessingScreen
 *
 * Layer B UI — KithLy Payment Defense Flow
 *
 * Consumes `usePaymentVerification` and renders one of three distinct states:
 *
 *   POLLING  → Minimalist pulsing indicator with ledger-verification copy
 *   SUCCESS  → Full-bleed confirmation with the claim code in display type + confetti
 *   TIMEOUT  → Graceful degradation with recovery instructions
 *
 * Design language: Apple-derived — thin strokes, generous whitespace,
 * high-contrast slate/white palette, Inter typeface, no decorative icons
 * or emojis anywhere in the component tree.
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { cn } from '../ui/utils';
import { Button } from '../ui/button';
import {
  usePaymentVerification,
  type PaymentVerificationStatus,
} from '../../hooks/usePaymentVerification';
import { WhatsAppShareButton } from '../shared/WhatsAppShareButton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentProcessingScreenProps {
  /**
   * The transaction UUID returned by the `checkout-init` Edge Function.
   * Passed directly into `usePaymentVerification` to begin polling.
   */
  transactionId: string;

  /**
   * The array of shop orders returned by `checkout-init`, containing
   * the shop IDs and their respective claim codes.
   */
  shopOrders: { shop_order_id: string; claim_code: string; shop_id: string }[];

  /**
   * Called when the user explicitly acknowledges the SUCCESS state by
   * pressing the "Continue" button. Typically used to navigate the caller
   * to a confirmation or order-detail screen.
   */
  onComplete: () => void;

  /** Recipient name for the share message. */
  recipientName?: string;

  /** Sender name for the share message. */
  senderName?: string;
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
  exit:    { opacity: 0, y: -8,  transition: { duration: 0.25, ease: 'easeIn' as const } },
};

const fadeIn = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: 'easeOut' as const } },
  exit:    { opacity: 0, transition: { duration: 0.2 } },
};

// ---------------------------------------------------------------------------
// Confetti launcher
// ---------------------------------------------------------------------------

/**
 * Fires a two-burst confetti celebration using canvas-confetti.
 * Colours use the KithLy brand palette (orange/amber gradient).
 * The two origin points simulate a stereo pop from the bottom corners.
 */
function launchConfetti(): void {
  const brandColors = ['#F97316', '#FB923C', '#FDBA74', '#FED7AA', '#ffffff'];

  const sharedOptions: confetti.Options = {
    particleCount: 80,
    spread: 80,
    startVelocity: 45,
    decay: 0.92,
    gravity: 1.1,
    ticks: 200,
    colors: brandColors,
    shapes: ['circle', 'square'] as confetti.Shape[],
    scalar: 1.1,
  };

  // Left burst
  confetti({ ...sharedOptions, origin: { x: 0.2, y: 0.75 }, angle: 60 });

  // Right burst (slight delay for a staggered feel)
  setTimeout(() => {
    confetti({ ...sharedOptions, origin: { x: 0.8, y: 0.75 }, angle: 120 });
  }, 120);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---- Polling state ---------------------------------------------------------

function PollingView({ attemptCount, maxAttempts }: { attemptCount: number; maxAttempts: number }) {
  const progress = Math.min((attemptCount / maxAttempts) * 100, 100);

  return (
    <motion.div
      key="polling"
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex flex-col items-center gap-10"
    >
      {/* Animated ring — pure CSS, no third-party icon */}
      <div className="relative flex items-center justify-center" aria-hidden>
        {/* Outer breathing ring */}
        <motion.span
          className="absolute h-24 w-24 rounded-full border border-slate-200"
          animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.15, 0.5] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Middle breathing ring */}
        <motion.span
          className="absolute h-16 w-16 rounded-full border border-slate-300"
          animate={{ scale: [1, 1.08, 1], opacity: [0.7, 0.25, 0.7] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
        />
        {/* Core dot */}
        <motion.span
          className="h-8 w-8 rounded-full bg-slate-900"
          animate={{ scale: [1, 0.92, 1] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }}
        />
      </div>

      {/* Copy */}
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-xl font-medium tracking-tight text-slate-900">
          Verifying transaction on the secure ledger
        </h1>
        <p className="max-w-xs text-sm font-normal leading-relaxed text-slate-500">
          Your payment is being confirmed by our payment network.
          This typically completes within a few seconds.
        </p>
      </div>

      {/* Progress track */}
      <div className="w-full max-w-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-normal tabular-nums text-slate-400">
            Check {attemptCount} of {maxAttempts}
          </span>
          <span className="text-xs font-normal tabular-nums text-slate-400">
            {Math.round(progress)}%
          </span>
        </div>
        <div className="h-px w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="h-full bg-slate-900"
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      </div>
    </motion.div>
  );
}

// ---- Success state ---------------------------------------------------------

/**
 * Renders each character of the claim code in its own cell to produce the
 * distinctive segmented-display look, ensuring the code is scannable at a
 * glance on mobile and desktop.
 */
function ClaimCodeDisplay({ code }: { code: string }) {
  const characters = code.toUpperCase().split('');

  return (
    <div
      className="flex items-center gap-1.5"
      role="text"
      aria-label={`Claim code: ${code.split('').join(' ')}`}
    >
      {characters.map((char, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.35,
            ease: [0.22, 1, 0.36, 1],
            delay: 0.35 + index * 0.055,
          }}
          className={cn(
            'flex h-14 w-10 items-center justify-center',
            'rounded-lg border border-slate-200 bg-slate-50',
            'text-xl font-semibold tracking-widest text-slate-900',
            'select-all font-mono',
          )}
        >
          {char}
        </motion.span>
      ))}
    </div>
  );
}

function SuccessView({
  shopOrders,
  recipientName,
  senderName,
  onComplete,
}: {
  shopOrders: { shop_order_id: string; claim_code: string; shop_id: string }[];
  recipientName?: string;
  senderName?: string;
  onComplete: () => void;
}) {
  return (
    <motion.div
      key="success"
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex flex-col items-center gap-10"
    >
      {/* Confirmation mark — thin circle with a check stroke */}
      <motion.div
        className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-white"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        aria-hidden
      >
        <motion.svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-9 w-9 text-slate-900"
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' as const, delay: 0.25 }}
        >
          <motion.path
            d="M4.5 12.75l6 6 9-13.5"
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.55, ease: 'easeOut' as const, delay: 0.3 }}
          />
        </motion.svg>
      </motion.div>

      {/* Heading */}
      <div className="flex flex-col items-center gap-2 text-center">
        <motion.h1
          className="text-2xl font-semibold tracking-tight text-slate-900"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          Payment Confirmed
        </motion.h1>
        <motion.p
          className="max-w-xs text-sm font-normal leading-relaxed text-slate-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          Your gift has been secured. Show this code to the shop attendant
          to redeem the gift on behalf of your recipient.
        </motion.p>
      </div>

      {/* Claim code block */}
      <motion.div
        className="flex w-full flex-col items-center gap-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div className="text-center px-4">
          <p className="text-sm font-medium text-slate-700">
            Your funds are secured in escrow. Share the claim codes below with your recipient.
          </p>
        </div>

        <div className="w-full flex flex-col gap-4">
          {shopOrders.map((order, idx) => (
            <motion.div
              key={order.shop_order_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + (idx * 0.1) }}
              className="flex w-full flex-col items-center gap-5 rounded-2xl border border-slate-100 bg-slate-50 p-6"
            >
              <div className="text-center">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Shop ID: {order.shop_id.slice(0, 8)}
                </span>
              </div>

              <ClaimCodeDisplay code={order.claim_code} />

              <div className="w-full pt-2">
                <WhatsAppShareButton
                  claimCode={order.claim_code}
                  shopName={`KithLy Merchant (${order.shop_id.slice(0, 4)})`}
                  recipientName={recipientName}
                  senderName={senderName}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Divider */}
      <div className="w-full max-w-xs border-t border-slate-100" />

      {/* CTA */}
      <motion.div
        className="w-full max-w-xs"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.7 }}
      >
        <Button
          className="w-full rounded-xl bg-slate-900 py-5 text-sm font-medium tracking-wide text-white hover:bg-slate-800"
          onClick={onComplete}
        >
          Continue
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ---- Timeout / Error state -------------------------------------------------

function TimeoutView({
  status,
  onRetry,
}: {
  status: Extract<PaymentVerificationStatus, 'TIMEOUT' | 'ERROR'>;
  onRetry: () => void;
}) {
  const isError = status === 'ERROR';

  return (
    <motion.div
      key="timeout"
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex flex-col items-center gap-10"
    >
      {/* Warning mark */}
      <motion.div
        className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-white"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        aria-hidden
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-9 w-9 text-slate-400"
          aria-hidden
        >
          <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
      </motion.div>

      {/* Copy */}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {isError ? 'Connection Error' : 'Network Delay Detected'}
        </h1>
        <p className="max-w-sm text-sm font-normal leading-relaxed text-slate-500">
          {isError
            ? 'A connection error occurred while verifying your payment. Your funds have not been deducted if no charge appeared. Please try again.'
            : 'Our payment network is taking longer than expected to respond. This is usually a temporary delay.'}
        </p>
      </div>

      {/* Recovery instructions — only shown for TIMEOUT */}
      {!isError && (
        <motion.div
          className="w-full max-w-sm rounded-xl border border-slate-100 bg-slate-50 p-5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
            What to do now
          </p>
          <ol className="space-y-2.5 text-sm font-normal leading-relaxed text-slate-600">
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs font-medium text-slate-500">
                1
              </span>
              <span>
                Check your WhatsApp or SMS. If the payment was processed,
                your claim code will be delivered there automatically.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs font-medium text-slate-500">
                2
              </span>
              <span>
                If no message arrived, use the button below to check again.
                Our system will re-verify with the payment network.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs font-medium text-slate-500">
                3
              </span>
              <span>
                If you were charged but see no code, contact KithLy support
                with your payment reference number.
              </span>
            </li>
          </ol>
        </motion.div>
      )}

      {/* Actions */}
      <motion.div
        className="flex w-full max-w-xs flex-col gap-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Button
          className="w-full rounded-xl bg-slate-900 py-5 text-sm font-medium tracking-wide text-white hover:bg-slate-800"
          onClick={onRetry}
        >
          Check Payment Status
        </Button>
        <Button
          variant="ghost"
          className="w-full rounded-xl py-5 text-sm font-normal text-slate-500 hover:text-slate-700"
          onClick={() => window.open('mailto:support@kithly.com', '_blank')}
        >
          Contact Support
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function PaymentProcessingScreen({
  transactionId,
  shopOrders,
  recipientName,
  senderName,
  onComplete,
}: PaymentProcessingScreenProps) {

  const { status, attemptCount, reset } = usePaymentVerification({ voucherId: transactionId });

  const continueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (status === 'SUCCESS') {
      // Fire confetti immediately when payment is confirmed.
      launchConfetti();

      // Small delay to allow the animation to settle before shifting focus.
      const timer = setTimeout(() => continueButtonRef.current?.focus(), 750);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const liveMessage =
    status === 'SUCCESS'
      ? 'Payment confirmed. Your claim code is ready.'
      : status === 'TIMEOUT'
        ? 'Payment verification timed out. Please check your messages or try again.'
        : status === 'ERROR'
          ? 'A connection error occurred. Please try again.'
          : `Verifying payment. Attempt ${attemptCount} of 20.`;

  return (
    <div
      className={cn(
        'relative flex min-h-screen w-full flex-col items-center justify-center',
        'bg-white px-6 py-12',
      )}
    >
      {/* ARIA live region */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveMessage}
      </span>

      {/* Centred card container */}
      <div className="w-full max-w-md">
        {/* KithLy wordmark */}
        <motion.div
          className="mb-14 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <span className="text-sm font-medium tracking-[0.25em] text-slate-300 uppercase">
            KithLy
          </span>
        </motion.div>

        {/* Animated state panel */}
        <AnimatePresence mode="wait">
          {(status === 'IDLE' || status === 'POLLING') && (
            <PollingView
              key="polling"
              attemptCount={attemptCount}
              maxAttempts={20}
            />
          )}

          {status === 'SUCCESS' && (
            <SuccessView
              key="success"
              shopOrders={shopOrders}
              recipientName={recipientName}
              senderName={senderName}
              onComplete={onComplete}
            />
          )}

          {(status === 'TIMEOUT' || status === 'ERROR') && (
            <TimeoutView
              key="timeout"
              status={status}
              onRetry={reset}
            />
          )}
        </AnimatePresence>

        {/* Footer — persistent across all states */}
        <motion.div
          className="mt-16 flex flex-col items-center gap-1.5"
          variants={fadeIn}
          initial="hidden"
          animate="visible"
        >
          <div className="flex items-center gap-1.5">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5 text-slate-300"
              aria-hidden
            >
              <rect x="3" y="7" width="10" height="8" rx="1.5" />
              <path d="M5 7V5a3 3 0 0 1 6 0v2" />
            </svg>
            <span className="text-xs font-normal text-slate-400">
              Escrow-protected transaction
            </span>
          </div>
          <span className="text-xs font-normal text-slate-300">
            Powered by KithLy secure checkout
          </span>
        </motion.div>
      </div>
    </div>
  );
}

export default PaymentProcessingScreen;
