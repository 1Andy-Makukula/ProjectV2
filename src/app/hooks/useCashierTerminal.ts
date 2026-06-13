import { useState, useRef, useCallback } from 'react';
import { supabase, projectId } from '../../lib/supabaseClient';
import { toast } from 'sonner';

export type TerminalStatus = 'IDLE' | 'FETCHING' | 'CHECKLIST' | 'SCANNING' | 'APPROVED' | 'REJECTED';
export type InputMode = 'qr' | 'manual';

export interface BundleData {
  shop_order_id: string;
  transaction_id: string;
  claim_code: string;
  recipient_name: string;
  order_items: Array<{
    order_item_id: string;
    items: { name: string } | null;
  }>;
}

export interface ApprovedResult {
  fulfilled_count: number;
}

export interface RejectedResult {
  rejection_reason: string;
  raw_error: string;
}

const FULFILL_VOUCHER_URL = `https://${projectId}.supabase.co/functions/v1/fulfill-voucher` as const;
const CLAIM_CODE_LENGTH = 8 as const;

async function callFulfillVoucher(
  claimCode: string,
  present_item_ids: string[],
  missing_item_ids: string[],
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
    body: JSON.stringify({ claim_code: claimCode, present_item_ids, missing_item_ids }),
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
    return { ok: true, data: { fulfilled_count: present_item_ids.length } };
  }

  const rejectionReason =
    typeof payload.rejection_reason === 'string'
      ? payload.rejection_reason
      : typeof payload.error === 'string'
        ? payload.error
        : 'Verification failed. Please try again.';

  return { ok: false, rejection_reason: rejectionReason, raw_error: `HTTP ${response.status}` };
}

export function useCashierTerminal(shopId: string, onApproved?: (result: ApprovedResult) => void) {
  const [status, setStatus] = useState<TerminalStatus>('IDLE');
  const [inputMode, setInputMode] = useState<InputMode>('qr');
  const [code, setCode] = useState<string>('');
  const [bundleData, setBundleData] = useState<BundleData | null>(null);
  const [approvedResult, setApprovedResult] = useState<ApprovedResult | null>(null);
  const [rejectedResult, setRejectedResult] = useState<RejectedResult | null>(null);
  const isSubmittingRef = useRef<boolean>(false);

  const handleFetchBundle = useCallback(async (overrideCode?: string) => {
    const codeToUse = overrideCode ?? code;
    if (isSubmittingRef.current || codeToUse.length !== CLAIM_CODE_LENGTH) return;
    isSubmittingRef.current = true;
    setStatus('FETCHING');

    try {
      const { data, error } = await supabase
        .from('shop_orders')
        .select('shop_order_id, transaction_id, claim_code, recipient_name, order_items(order_item_id, items(name))')
        .eq('claim_code', codeToUse.toUpperCase())
        .eq('shop_id', shopId)
        .in('claim_status', ['PENDING', 'PENDING_PAYMENT'])
        .single();

      if (error || !data) {
        setRejectedResult({ rejection_reason: "This code is invalid or does not belong to your shop.", raw_error: error?.message || 'Not found' });
        setStatus('REJECTED');
        if ('vibrate' in navigator) navigator.vibrate([300]);
        toast.error('Code rejected', { description: 'Invalid code or already redeemed.' });
      } else {
        setBundleData(data as unknown as BundleData);
        setStatus('CHECKLIST');
        if ('vibrate' in navigator) navigator.vibrate([80, 40]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      console.error('[CashierVerificationTerminal]', message);
      toast.error('Verification failed', { description: 'A connection error occurred. Please check your network.' });
      setStatus('IDLE');
    } finally {
      isSubmittingRef.current = false;
    }
  }, [code, shopId]);

  const handleProcessBundle = useCallback(async (present_item_ids: string[], missing_item_ids: string[]) => {
    if (isSubmittingRef.current || !bundleData) return;
    isSubmittingRef.current = true;
    setStatus('SCANNING');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired', { description: 'Please log in again and retry.' });
        setStatus('IDLE');
        isSubmittingRef.current = false;
        return;
      }

      const result = await callFulfillVoucher(bundleData.claim_code, present_item_ids, missing_item_ids, session.access_token);

      if (result.ok) {
        setApprovedResult(result.data);
        setStatus('APPROVED');
        onApproved?.(result.data);
        if ('vibrate' in navigator) navigator.vibrate([80, 40, 80]);
        toast.success('Fulfillment Complete', { description: `${result.data.fulfilled_count} items handed over.` });
      } else {
        setRejectedResult({ rejection_reason: result.rejection_reason, raw_error: result.raw_error });
        setStatus('REJECTED');
        if ('vibrate' in navigator) navigator.vibrate([300]);
        toast.error('Fulfillment failed', { description: result.rejection_reason });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      console.error('[CashierVerificationTerminal]', message);
      toast.error('Fulfillment failed', { description: 'A connection error occurred. Please check your network.' });
      setStatus('CHECKLIST');
    } finally {
      isSubmittingRef.current = false;
    }
  }, [bundleData, onApproved]);

  const handleQRDetected = useCallback((scanned: string) => {
    setCode(scanned);
    handleFetchBundle(scanned);
  }, [handleFetchBundle]);

  const handleReset = useCallback(() => {
    setCode('');
    setBundleData(null);
    setApprovedResult(null);
    setRejectedResult(null);
    setStatus('IDLE');
  }, []);

  return {
    status,
    inputMode,
    setInputMode,
    code,
    setCode,
    bundleData,
    approvedResult,
    rejectedResult,
    handleFetchBundle,
    handleProcessBundle,
    handleQRDetected,
    handleReset,
  };
}
