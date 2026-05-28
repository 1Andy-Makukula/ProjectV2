/**
 * CashierVerificationTerminal
 *
 * Merchant-facing POS for gift voucher redemption.
 * Input modes: Live QR scan (camera) or Manual OTP entry.
 *
 * Financial data is intentionally concealed — cashier sees
 * item name and recipient name only.
 */

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { Scanner } from '@yudiel/react-qr-scanner';
import { QrCode, Keyboard, Camera, CameraOff } from 'lucide-react';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '../ui/input-otp';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { supabase, projectId } from '../../../lib/supabaseClient';

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
type InputMode = 'qr' | 'manual';

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
  shopId: string;
  onApproved?: (result: ApprovedResult) => void;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

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

  const rejectionReason =
    typeof payload.rejection_reason === 'string'
      ? payload.rejection_reason
      : typeof payload.error === 'string'
        ? payload.error
        : 'Verification failed. Please try again.';

  return { ok: false, rejection_reason: rejectionReason, raw_error: `HTTP ${response.status}` };
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const panelVariants = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -12, transition: { duration: 0.2, ease: 'easeIn' } },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScanningView() {
  return (
    <motion.div key="scanning" variants={panelVariants} initial="hidden" animate="visible" exit="exit"
      className="flex flex-col items-center gap-8"
    >
      <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden>
        <motion.span
          className="absolute h-20 w-20 rounded-full border border-orange-200"
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.1, 0.5] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.span
          className="absolute h-12 w-12 rounded-full border border-orange-300"
          animate={{ scale: [1, 1.1, 1], opacity: [0.7, 0.2, 0.7] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
        />
        <span className="h-5 w-5 rounded-full bg-gradient-to-br from-orange-500 to-blue-800" />
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-lg font-medium text-slate-900">Verifying code</p>
        <p className="text-sm text-slate-500">Checking the secure ledger...</p>
      </div>
    </motion.div>
  );
}

function ApprovedView({ result, onReset }: { result: ApprovedResult; onReset: () => void }) {
  return (
    <motion.div key="approved" variants={panelVariants} initial="hidden" animate="visible" exit="exit"
      className="flex w-full flex-col items-center gap-8"
    >
      <motion.div
        className="flex w-full flex-col items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50/60 backdrop-blur-xl py-8"
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-blue-800"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-white"
          >
            <motion.path d="M4.5 12.75l6 6 9-13.5"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.55, ease: 'easeOut', delay: 0.25 }}
            />
          </svg>
        </motion.div>
        <motion.span className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-500"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        >
          Approved
        </motion.span>
        <motion.p
          className="text-center text-4xl font-bold leading-tight tracking-tight text-slate-900 max-w-xs px-4"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
        >
          {result.item_name}
        </motion.p>
      </motion.div>

      <motion.div className="flex w-full flex-col gap-1"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
      >
        <span className="text-xs font-medium uppercase tracking-widest text-slate-400">Hand over to</span>
        <p className="text-2xl font-medium text-slate-800">{result.recipient_name}</p>
      </motion.div>

      <motion.div
        className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-white/80 backdrop-blur-xl px-4 py-3"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
      >
        <span className="text-xs text-slate-400">Claim code</span>
        <span className="font-mono text-sm font-medium text-slate-600">{result.claim_code}</span>
      </motion.div>

      <div className="h-px w-full bg-slate-100" />

      <motion.div className="w-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <Button
          className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-blue-800 py-5 text-sm font-medium tracking-wide text-white hover:opacity-90"
          onClick={onReset}
        >
          Verify next code
        </Button>
      </motion.div>
    </motion.div>
  );
}

function RejectedView({ result, onReset }: { result: RejectedResult; onReset: () => void }) {
  return (
    <motion.div key="rejected" variants={panelVariants} initial="hidden" animate="visible" exit="exit"
      className="flex w-full flex-col items-center gap-8"
    >
      <motion.div
        className="flex w-full flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white/80 backdrop-blur-xl py-8"
        initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-200 bg-white"
          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.1 }} aria-hidden
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-slate-400"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </motion.div>
        <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Rejected</span>
        <p className="text-4xl font-bold tracking-tight text-slate-900">Do Not Redeem</p>
      </motion.div>

      <motion.div className="w-full rounded-xl border border-slate-100 bg-white/80 backdrop-blur-xl p-5"
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Reason</p>
        <p className="text-sm leading-relaxed text-slate-600">{result.rejection_reason}</p>
      </motion.div>

      <div className="h-px w-full bg-slate-100" />

      <motion.div className="flex w-full flex-col gap-3"
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
      >
        <Button
          className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-blue-800 py-5 text-sm font-medium tracking-wide text-white hover:opacity-90"
          onClick={onReset}
        >
          Try another code
        </Button>
        <Button variant="ghost"
          className="w-full rounded-xl py-5 text-sm font-normal text-slate-400 hover:text-slate-600"
          onClick={() => window.open('mailto:merchants@kithly.com', '_blank')}
        >
          Contact merchant support
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ---- Input mode toggle ------------------------------------------------------

function ModeToggle({ mode, onChange }: { mode: InputMode; onChange: (m: InputMode) => void }) {
  return (
    <div className="flex w-full items-center rounded-xl border border-slate-100 bg-white/60 backdrop-blur-md p-1 gap-1">
      {(['qr', 'manual'] as InputMode[]).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all',
              active
                ? 'bg-gradient-to-r from-orange-500 to-blue-800 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {m === 'qr'
              ? <QrCode className="h-4 w-4" strokeWidth={1.5} />
              : <Keyboard className="h-4 w-4" strokeWidth={1.5} />
            }
            {m === 'qr' ? 'Scan QR' : 'Manual Entry'}
          </button>
        );
      })}
    </div>
  );
}

// ---- QR scanner viewport ----------------------------------------------------

function QRScanView({ onDetected }: { onDetected: (code: string) => void }) {
  const [camDenied, setCamDenied] = useState(false);

  if (camDenied) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-orange-100 bg-orange-50/60 backdrop-blur-xl p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-100">
          <CameraOff className="h-6 w-6 text-orange-500" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-slate-700">Camera access denied</p>
        <p className="text-xs text-slate-500 leading-relaxed max-w-[220px]">
          Allow camera access in your browser settings, or switch to Manual Entry below.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-orange-200 shadow-lg shadow-orange-100/60">
      {/* Active indicator strip */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-blue-800 px-4 py-2">
        <Camera className="h-3.5 w-3.5 text-white" strokeWidth={1.5} />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white">Camera Active</span>
        <span className="ml-auto flex h-2 w-2 rounded-full bg-white animate-pulse" />
      </div>

      <div className="relative bg-slate-900">
        <Scanner
          onScan={(results) => {
            const raw = results?.[0]?.rawValue;
            if (raw && raw.length >= CLAIM_CODE_LENGTH) {
              const extracted = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, CLAIM_CODE_LENGTH).toUpperCase();
              if (extracted.length === CLAIM_CODE_LENGTH) {
                onDetected(extracted);
              }
            }
          }}
          onError={(err) => {
            const msg = String(err);
            if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('notallowed')) {
              setCamDenied(true);
            }
          }}
          styles={{
            container: { width: '100%', aspectRatio: '1 / 1' },
            video: { objectFit: 'cover', width: '100%', height: '100%' },
          }}
          components={{ finder: false }}
        />
        {/* Corner frame overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-44 w-44">
            {[['top-0 left-0', 'border-t border-l'], ['top-0 right-0', 'border-t border-r'],
              ['bottom-0 left-0', 'border-b border-l'], ['bottom-0 right-0', 'border-b border-r'],
            ].map(([pos, border]) => (
              <span key={pos} className={cn('absolute h-8 w-8 rounded-sm border-orange-400', pos, border)} />
            ))}
          </div>
        </div>
      </div>

      <p className="bg-slate-900 py-2 text-center text-[11px] text-slate-400">
        Point camera at the QR code on the customer's screen
      </p>
    </div>
  );
}

// ---- Idle view (both modes) -------------------------------------------------

function IdleView({
  code, onCodeChange, onSubmit, isDisabled,
  mode, onModeChange, onQRDetected,
}: {
  code: string;
  onCodeChange: (v: string) => void;
  onSubmit: () => void;
  isDisabled: boolean;
  mode: InputMode;
  onModeChange: (m: InputMode) => void;
  onQRDetected: (code: string) => void;
}) {
  const isComplete = code.length === CLAIM_CODE_LENGTH;

  return (
    <motion.div key="idle" variants={panelVariants} initial="hidden" animate="visible" exit="exit"
      className="flex w-full flex-col items-center gap-6"
    >
      {/* Header */}
      <div className="flex w-full flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-slate-900">Verify gift code</h1>
        <p className="text-sm text-slate-500">
          {mode === 'qr'
            ? 'Point the camera at the customer\'s QR code to auto-verify.'
            : 'Enter the 8-character code from the customer\'s WhatsApp message.'}
        </p>
      </div>

      {/* Mode toggle */}
      <ModeToggle mode={mode} onChange={onModeChange} />

      {/* Input area */}
      <AnimatePresence mode="wait">
        {mode === 'qr' ? (
          <motion.div key="qr-view" className="w-full"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <QRScanView onDetected={onQRDetected} />
          </motion.div>
        ) : (
          <motion.div key="manual-view" className="flex w-full flex-col items-center gap-5"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            role="group" aria-label="8-character gift code entry"
          >
            <InputOTP maxLength={CLAIM_CODE_LENGTH} value={code} onChange={onCodeChange}
              onComplete={onSubmit} aria-label="Gift claim code"
            >
              <InputOTPGroup>
                {[0,1,2,3].map(i => <InputOTPSlot key={i} index={i} className="h-14 w-11 text-lg font-mono uppercase" />)}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {[4,5,6,7].map(i => <InputOTPSlot key={i} index={i} className="h-14 w-11 text-lg font-mono uppercase" />)}
              </InputOTPGroup>
            </InputOTP>

            <p className="text-xs text-slate-400">Auto-submits when all 8 characters are entered.</p>

            <div className="h-px w-full bg-slate-100" />

            <Button
              className={cn(
                'w-full rounded-xl py-5 text-sm font-medium tracking-wide',
                isComplete && !isDisabled
                  ? 'bg-gradient-to-r from-orange-500 to-blue-800 text-white hover:opacity-90'
                  : 'cursor-not-allowed bg-slate-100 text-slate-400',
              )}
              disabled={!isComplete || isDisabled}
              onClick={onSubmit}
              id="verify-button"
            >
              Verify Code
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Liability shield notice */}
      <div className="flex w-full items-start gap-3 rounded-xl border border-orange-100 bg-orange-50/60 backdrop-blur-xl p-4">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round"
          className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" aria-hidden
        >
          <path d="M10 2L3 5v5c0 4.4 3 8.5 7 9.5C14 18.5 17 14.4 17 10V5L10 2z" />
        </svg>
        <p className="text-xs leading-relaxed text-slate-500">
          This terminal displays{' '}
          <span className="font-medium text-slate-700">item information only</span>.
          No pricing or account data is shown. Fulfillment is governed by the KithLy Merchant Agreement.
        </p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function CashierVerificationTerminal({ shopId, onApproved }: CashierVerificationTerminalProps) {
  const [status, setStatus] = useState<TerminalStatus>('IDLE');
  const [inputMode, setInputMode] = useState<InputMode>('qr');
  const [code, setCode] = useState<string>('');
  const [approvedResult, setApprovedResult] = useState<ApprovedResult | null>(null);
  const [rejectedResult, setRejectedResult] = useState<RejectedResult | null>(null);
  const isSubmittingRef = useRef<boolean>(false);

  const handleSubmit = useCallback(async (overrideCode?: string) => {
    const codeToUse = overrideCode ?? code;
    if (isSubmittingRef.current || codeToUse.length !== CLAIM_CODE_LENGTH) return;
    isSubmittingRef.current = true;
    setStatus('SCANNING');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired', { description: 'Please log in again and retry.' });
        setStatus('IDLE');
        return;
      }

      const result = await callFulfillVoucher(codeToUse, shopId, session.access_token);

      if (result.ok) {
        setApprovedResult(result.data);
        setStatus('APPROVED');
        onApproved?.(result.data);
        if ('vibrate' in navigator) navigator.vibrate([80, 40, 80]);
        toast.success('Code approved', { description: `${result.data.item_name} — for ${result.data.recipient_name}` });
      } else {
        setRejectedResult({ rejection_reason: result.rejection_reason, raw_error: result.raw_error });
        setStatus('REJECTED');
        if ('vibrate' in navigator) navigator.vibrate([300]);
        toast.error('Code rejected', { description: result.rejection_reason });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      console.error('[CashierVerificationTerminal]', message);
      toast.error('Verification failed', { description: 'A connection error occurred. Please check your network.' });
      setStatus('IDLE');
    } finally {
      isSubmittingRef.current = false;
    }
  }, [code, shopId, onApproved]);

  // QR auto-submit: populate code state then immediately verify
  const handleQRDetected = useCallback((scanned: string) => {
    setCode(scanned);
    handleSubmit(scanned);
  }, [handleSubmit]);

  const handleReset = useCallback(() => {
    setCode('');
    setApprovedResult(null);
    setRejectedResult(null);
    setStatus('IDLE');
  }, []);

  const liveMessage =
    status === 'SCANNING' ? 'Verifying code. Please wait.'
    : status === 'APPROVED' ? `Code approved. Hand over ${approvedResult?.item_name} to ${approvedResult?.recipient_name}.`
    : status === 'REJECTED' ? `Code rejected. ${rejectedResult?.rejection_reason}`
    : '';

  return (
    <div className={cn(
      'flex min-h-screen w-full flex-col items-center justify-start',
      'bg-gradient-to-br from-orange-50/60 via-white to-blue-50/40 px-6 py-10',
    )}>
      <span role="status" aria-live={status === 'REJECTED' ? 'assertive' : 'polite'}
        aria-atomic="true" className="sr-only"
      >
        {liveMessage}
      </span>

      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <motion.div className="mb-10 flex items-center justify-between"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
        >
          <span className="bg-gradient-to-r from-orange-500 to-blue-800 bg-clip-text text-xs font-semibold uppercase tracking-[0.25em] text-transparent">
            KithLy
          </span>
          <span className="text-xs text-slate-300">Merchant Terminal</span>
        </motion.div>

        <AnimatePresence mode="wait">
          {status === 'IDLE' && (
            <IdleView
              key="idle"
              code={code}
              onCodeChange={setCode}
              onSubmit={() => handleSubmit()}
              isDisabled={false}
              mode={inputMode}
              onModeChange={setInputMode}
              onQRDetected={handleQRDetected}
            />
          )}
          {status === 'SCANNING' && <ScanningView key="scanning" />}
          {status === 'APPROVED' && approvedResult && (
            <ApprovedView key="approved" result={approvedResult} onReset={handleReset} />
          )}
          {status === 'REJECTED' && rejectedResult && (
            <RejectedView key="rejected" result={rejectedResult} onReset={handleReset} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default CashierVerificationTerminal;
