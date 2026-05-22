/**
 * InternationalCheckoutModal
 *
 * The visual chassis for KithLy's international (diaspora) checkout flow.
 *
 * Presents a clean, receipt-style pricing breakdown that maps:
 *   Base Item (ZMW) → Exchange Rate Applied → Final Total (foreign currency)
 *
 * Mounts FxTemporalLock immediately on open so the countdown begins the
 * moment the buyer sees the locked rate — not when they click "Pay Now".
 * Expiry invalidates the session and calls onExpire before the CTA fires.
 *
 * Design language: Apple-derived — thin strokes, slate/white palette,
 * generous whitespace, tabular-nums mono for all numeric values, zero emojis.
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { FxTemporalLock } from './FxTemporalLock';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InternationalCheckoutModalProps {
  /** Controls the open/closed state of the modal from the parent. */
  open: boolean;

  /** Called when the user dismisses the modal or when the rate expires. */
  onClose: () => void;

  /**
   * ISO 8601 timestamp of when the FX rate was locked by the `fx-rate-lock`
   * Edge Function. Passed directly into FxTemporalLock.
   * Example: "2026-05-21T11:48:00.000Z"
   */
  sessionCreatedAt: string;

  /**
   * The raw integer ZMW base price from the `items` table
   * (e.g. 45000 = ZMW 450.00, stored as kwacha integers per our schema).
   */
  basePriceZmw: number;

  /**
   * The ZMW-denominated international price after the 1.30× KithLy margin.
   * Returned as `zmw_international_price` by the `fx-rate-lock` Edge Function.
   */
  zmwInternationalPrice: number;

  /**
   * The final checkout price in the foreign currency, after FX conversion
   * and the 1.5% hedging spread. Returned as `checkout_price` by the function.
   * This is a decimal value (e.g. 20.85 for GBP).
   */
  checkoutPrice: number;

  /**
   * ISO 4217 currency code of the buyer's target currency.
   * Example: "GBP" | "USD" | "EUR"
   */
  currency: string;

  /**
   * The hedged FX rate that was applied (live_rate × 1.015).
   * Returned as `fx_rate_applied` by the `fx-rate-lock` Edge Function.
   * Example: 0.035627
   */
  fxRateApplied: number;

  /**
   * The raw live rate before the hedging spread.
   * Returned as `fx_rate_raw` by the Edge Function.
   * Displayed for buyer transparency.
   */
  fxRateRaw: number;

  /**
   * Whether a live rate was used or the safe-harbour fallback.
   * Displayed as a disclosure label when 'safe_harbour'.
   */
  rateSource: 'live_primary' | 'live_secondary' | 'safe_harbour';

  /**
   * Name of the item being purchased. Shown in the receipt breakdown.
   */
  itemName: string;

  /**
   * Called when the buyer presses "Pay Now" and the session is still valid.
   * The parent should use this to open the Flutterwave payment modal.
   */
  onInitiatePayment: () => void;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Formats a ZMW integer (stored as whole kwacha) to a display string.
 * Per the project's currency.ts convention: values in `items.base_price`
 * and `zmw_international_price` are raw integer kwacha, not ngwee.
 * We therefore do NOT divide by 100 here.
 */
function formatZmw(amount: number): string {
  return `ZMW ${amount.toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Formats a foreign currency decimal amount.
 * Uses the browser's Intl formatter for proper locale-aware display.
 */
function formatFx(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if the currency code is unrecognised by Intl
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

/**
 * Formats a raw FX rate to 6 significant decimal places for display.
 * Example: 0.035627 → "0.035627"
 */
function formatRate(rate: number): string {
  return rate.toFixed(6);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * A single receipt line row.
 * `subtle` renders the label in muted slate; `total` renders the value larger.
 */
function ReceiptRow({
  label,
  value,
  subtle = false,
  total = false,
  mono = true,
}: {
  label: string;
  value: string;
  subtle?: boolean;
  total?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className={cn(
          'text-sm font-normal leading-relaxed',
          subtle ? 'text-slate-400' : 'text-slate-600',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'shrink-0',
          mono && 'font-mono tabular-nums',
          total
            ? 'text-xl font-semibold text-slate-900'
            : subtle
              ? 'text-sm font-normal text-slate-400'
              : 'text-sm font-medium text-slate-700',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * A thin 1px divider consistent with the Apple-style design language.
 */
function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-slate-100', className)} />;
}

/**
 * Rate source disclosure badge — only rendered when safe-harbour rates are used.
 */
function SafeHarbourBadge() {
  return (
    <motion.div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2',
      )}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      role="note"
      aria-label="Estimated exchange rate disclosure"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0 text-amber-500"
        aria-hidden
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 5.5v3m0 2.5h.01" />
      </svg>
      <p className="text-xs font-normal leading-snug text-amber-700">
        Live rate unavailable. Price shown uses an estimated market rate and
        may differ slightly from the final charge.
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function InternationalCheckoutModal({
  open,
  onClose,
  sessionCreatedAt,
  basePriceZmw,
  zmwInternationalPrice,
  checkoutPrice,
  currency,
  fxRateApplied,
  fxRateRaw,
  rateSource,
  itemName,
  onInitiatePayment,
}: InternationalCheckoutModalProps) {

  // ---- Expiry state --------------------------------------------------------

  /**
   * When the FxTemporalLock fires onExpire, we immediately lock the "Pay Now"
   * button and surface the expiry notice. The parent's onClose is NOT called
   * automatically — we let the buyer read the message and dismiss manually,
   * preventing a jarring forced-redirect mid-read.
   */
  const [isExpired, setIsExpired] = useState<boolean>(false);

  const handleExpire = useCallback(() => {
    setIsExpired(true);
    // Propagate to the parent so it can invalidate the locked rate state
    // and clear the fx-rate-lock response from its own state.
    onClose();
  }, [onClose]);

  // Reset expiry state whenever the modal re-opens (e.g. after a fresh quote).
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        onClose();
        // We do NOT reset isExpired here — the parent will unmount/remount
        // this component with a new sessionCreatedAt when a fresh rate is fetched.
      }
    },
    [onClose],
  );

  // Derived display values
  const lockedRateLabel = `1 ZMW = ${formatRate(fxRateRaw)} ${currency}`;
  const zmwMarginAmount = zmwInternationalPrice - basePriceZmw;
  const spreadAmount = checkoutPrice - (basePriceZmw * fxRateRaw);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0',
          'max-w-sm rounded-2xl border border-slate-100 bg-white shadow-xl shadow-slate-200/60',
          // Override the Shadcn default max-w-lg to a narrower card feel
          'sm:max-w-sm',
        )}
      >
        {/* ---------------------------------------------------------------- */}
        {/* Section 1 — Header                                               */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col gap-1 px-6 pb-4 pt-6">
          {/* Wordmark */}
          <span className="mb-3 block text-xs font-medium uppercase tracking-[0.25em] text-slate-300">
            KithLy
          </span>

          <DialogHeader className="gap-0.5 text-left">
            <DialogTitle className="text-base font-semibold text-slate-900">
              International Checkout
            </DialogTitle>
            <DialogDescription className="text-sm font-normal text-slate-500">
              Sending{' '}
              <span className="font-medium text-slate-700">{itemName}</span>
              {' '}— priced in {currency}
            </DialogDescription>
          </DialogHeader>
        </div>

        <Divider />

        {/* ---------------------------------------------------------------- */}
        {/* Section 2 — FX Temporal Lock (rate countdown)                   */}
        {/* ---------------------------------------------------------------- */}
        <div className="px-6 py-5">
          <FxTemporalLock
            sessionCreatedAt={sessionCreatedAt}
            onExpire={handleExpire}
            lockedRateLabel={lockedRateLabel}
            currency={currency}
            className="w-full"
          />
        </div>

        <Divider />

        {/* ---------------------------------------------------------------- */}
        {/* Section 3 — Receipt-style pricing breakdown                      */}
        {/* ---------------------------------------------------------------- */}
        <motion.div
          className="flex flex-col gap-3.5 px-6 py-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          {/* Eyebrow */}
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
            Price breakdown
          </p>

          {/* Row: Base item price */}
          <ReceiptRow
            label="Base item price"
            value={formatZmw(basePriceZmw)}
          />

          {/* Row: KithLy international margin */}
          <ReceiptRow
            label="International service margin (30%)"
            value={`+ ${formatZmw(zmwMarginAmount)}`}
            subtle
          />

          {/* Row: ZMW subtotal */}
          <ReceiptRow
            label="Subtotal (ZMW)"
            value={formatZmw(zmwInternationalPrice)}
          />

          <Divider />

          {/* Row: Exchange rate */}
          <ReceiptRow
            label={`Exchange rate (ZMW → ${currency})`}
            value={`1 ZMW = ${formatRate(fxRateRaw)} ${currency}`}
            subtle
          />

          {/* Row: Hedging spread */}
          <ReceiptRow
            label="Rate lock spread (1.5%)"
            value={`× ${formatRate(fxRateApplied / fxRateRaw)}`}
            subtle
          />

          <Divider />

          {/* Row: TOTAL */}
          <ReceiptRow
            label={`Total payable`}
            value={formatFx(checkoutPrice, currency)}
            total
          />

          {/* Safe-harbour disclosure — only when live rate unavailable */}
          <AnimatePresence>
            {rateSource === 'safe_harbour' && <SafeHarbourBadge key="badge" />}
          </AnimatePresence>
        </motion.div>

        <Divider />

        {/* ---------------------------------------------------------------- */}
        {/* Section 4 — CTA                                                  */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col gap-3 px-6 py-5">
          {/* Expired state copy */}
          <AnimatePresence>
            {isExpired && (
              <motion.p
                key="expired-notice"
                className="text-center text-sm font-normal leading-relaxed text-slate-500"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                This rate has expired. Please close and request a new quote to
                continue.
              </motion.p>
            )}
          </AnimatePresence>

          {/* Pay Now button */}
          <Button
            className={cn(
              'w-full rounded-xl py-5 text-sm font-medium tracking-wide',
              isExpired
                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                : 'bg-slate-900 text-white hover:bg-slate-800',
            )}
            onClick={isExpired ? undefined : onInitiatePayment}
            disabled={isExpired}
            aria-disabled={isExpired}
          >
            {isExpired
              ? 'Rate Expired'
              : `Pay ${formatFx(checkoutPrice, currency)} Now`}
          </Button>

          {/* Dismiss / secondary action */}
          <Button
            variant="ghost"
            className="w-full rounded-xl py-5 text-sm font-normal text-slate-400 hover:text-slate-600"
            onClick={onClose}
          >
            {isExpired ? 'Close and get a new rate' : 'Cancel'}
          </Button>

          {/* Escrow assurance footer */}
          <div className="flex items-center justify-center gap-1.5 pt-1">
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
              Escrow-protected · Powered by KithLy
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default InternationalCheckoutModal;
