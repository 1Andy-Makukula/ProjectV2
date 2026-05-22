/**
 * SettlementDashboard
 *
 * Module 5.2 — Psychological Settlement Engine
 *
 * Renders an interactive ledger of pending payouts for a merchant.
 * Uses high-precision, active countdowns to provide psychological
 * certainty regarding escrow release.
 *
 * Design Language:
 *   - Apple-derived (sleek, thin strokes, generous whitespace)
 *   - High-contrast typography (slate/dark blue) for ticking text
 *   - Financial ledger grouping
 *   - Zero emojis
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSettlementCountdown } from '../../hooks/useSettlementCountdown';
import { cn } from '../ui/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  voucher_id: string;
  item_name: string;
  base_price: number;
  settlement_target_time: string;
}

export interface SettlementDashboardProps {
  /**
   * The array of pending payouts fetched from the `get-merchant-ledger`
   * Edge Function. Ordered chronologically by target time.
   */
  ledgerData: LedgerEntry[];
  
  /**
   * Optional loading state while fetching from the Edge Function.
   */
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Formats the ZMW amount.
 * The `get-merchant-ledger` Edge Function returns `base_price` as whole integers.
 */
function formatZmw(amount: number): string {
  return `ZMW ${amount.toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Renders an individual line item with its own active countdown hook.
 */
function LedgerRow({ entry, isLast }: { entry: LedgerEntry; isLast: boolean }) {
  const countdownText = useSettlementCountdown(entry.settlement_target_time);
  
  // Distinguish the ticking state visually from the processing state
  const isProcessing = countdownText === 'Processing Batch Clearance...';

  return (
    <div className={cn(
      "flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
      !isLast && "border-b border-slate-100"
    )}>
      {/* Left side: Item and amount */}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-slate-800">
          {entry.item_name}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Amount Due
          </span>
          <span className="text-xs font-mono font-medium tabular-nums text-slate-600">
            {formatZmw(entry.base_price)}
          </span>
        </div>
      </div>

      {/* Right side: Countdown clock */}
      <div className="flex flex-col items-start sm:items-end">
        <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Releases In
        </span>
        <div className={cn(
          "rounded-md border px-2.5 py-1",
          isProcessing 
            ? "border-amber-100 bg-amber-50" 
            : "border-slate-200 bg-slate-50 shadow-sm shadow-slate-100/50"
        )}>
          <span className={cn(
            "font-mono text-sm tracking-tight tabular-nums transition-colors duration-300",
            isProcessing 
              ? "font-medium text-amber-700"
              : "font-semibold text-slate-900"
          )}>
            {countdownText}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SettlementDashboard({ ledgerData, isLoading }: SettlementDashboardProps) {
  // Aggregate total pending ZMW
  const totalPending = ledgerData.reduce((sum, entry) => sum + entry.base_price, 0);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      {/* Header section */}
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">
          Pending Settlements
        </h2>
        <p className="text-sm font-normal text-slate-500">
          Escrow releases are automatically batched and processed according to the countdown schedule below.
        </p>
      </div>

      {/* Summary Card */}
      <motion.div 
        className="flex w-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:flex-row"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex flex-col justify-center px-6 py-5 sm:border-r sm:border-slate-100 sm:w-1/2">
          <span className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Total Pending
          </span>
          <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-slate-900">
            {formatZmw(totalPending)}
          </span>
        </div>
        <div className="flex flex-col justify-center bg-slate-50 px-6 py-5 sm:w-1/2">
          <span className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Active Batches
          </span>
          <span className="text-xl font-medium text-slate-800">
            {ledgerData.length} {ledgerData.length === 1 ? 'Payout' : 'Payouts'}
          </span>
        </div>
      </motion.div>

      {/* Ledger List */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
            Pipeline Ledger
          </h3>
        </div>
        
        <div className="flex flex-col px-6">
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center py-12"
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
                  <span className="text-xs font-medium uppercase tracking-widest text-slate-400">
                    Syncing Ledger
                  </span>
                </div>
              </motion.div>
            ) : ledgerData.length === 0 ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-16 text-center"
              >
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">
                  <svg 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="1.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    className="h-6 w-6 text-slate-300"
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-900">
                  No pending settlements
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Your pipeline is currently empty.
                </p>
              </motion.div>
            ) : (
              <motion.div 
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col"
              >
                {ledgerData.map((entry, index) => (
                  <LedgerRow 
                    key={entry.voucher_id} 
                    entry={entry} 
                    isLast={index === ledgerData.length - 1} 
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default SettlementDashboard;
