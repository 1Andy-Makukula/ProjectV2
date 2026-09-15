import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';

/**
 * The escrow operator's view: the master invariant, the reconciliation history,
 * and the two actions that move money outside the automated paths.
 *
 * WHY THE RECONCILIATION RUN IS NOT TRIGGERED FROM HERE
 * -----------------------------------------------------
 * A reconciliation needs the segregated account's real balance, which comes
 * from a bank statement a person reads. Offering a "reconcile now" button in
 * the browser would either invent that number or reconcile against nothing --
 * and a control that reconciles the ledger against itself always passes and
 * proves nothing. The scheduled job owns it; this screen reads the results.
 *
 * The fee sweep IS actionable here, because its second phase is exactly a
 * human confirming a transfer they just made and typing its reference.
 */

export interface EscrowPosition {
  client_funds_ngwee: number;
  sender_liabilities_ngwee: number;
  merchant_payables_ngwee: number;
  fees_accrued_ngwee: number;
  operating_ngwee: number;
  drift_ngwee: number;
  balanced: boolean;
  unswept_fee_ngwee: number;
  payouts_awaiting: number;
  payouts_stuck: number;
  refunds_pending: number;
  last_reconciliation: ReconciliationRun | null;
}

export interface ReconciliationRun {
  id: string;
  as_of: string;
  run_date: string;
  status: 'BALANCED' | 'DRIFT' | 'INTERNAL_IMBALANCE' | 'BANK_UNAVAILABLE';
  bank_balance_ngwee: number | null;
  drift_ngwee: number | null;
  internal_imbalance_ngwee: number;
  sender_liabilities_ngwee: number;
  merchant_payables_ngwee: number;
  fees_accrued_ngwee: number;
}

export interface OpenSweep {
  id: string;
  sweep_date: string;
  amount_ngwee: number;
  status: string;
  proposed_at: string;
}

export function useEscrowAdmin() {
  const { profile } = useAuth();
  const [position, setPosition] = useState<EscrowPosition | null>(null);
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [openSweep, setOpenSweep] = useState<OpenSweep | null>(null);
  const [escrowMode, setEscrowMode] = useState<string>('dual_write');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [positionRes, runsRes, sweepRes, settingsRes] = await Promise.all([
        supabase.rpc('escrow_position'),
        supabase
          .from('reconciliation_runs')
          .select(
            'id, as_of, run_date, status, bank_balance_ngwee, drift_ngwee, internal_imbalance_ngwee, sender_liabilities_ngwee, merchant_payables_ngwee, fees_accrued_ngwee',
          )
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('fee_sweeps')
          .select('id, sweep_date, amount_ngwee, status, proposed_at')
          .eq('status', 'PROPOSED')
          .maybeSingle(),
        supabase.from('platform_settings').select('escrow_mode').eq('id', 1).single(),
      ]);

      if (positionRes.error) throw positionRes.error;
      setPosition(positionRes.data as unknown as EscrowPosition);
      if (!runsRes.error) setRuns((runsRes.data ?? []) as unknown as ReconciliationRun[]);
      if (!sweepRes.error) setOpenSweep((sweepRes.data as unknown as OpenSweep) ?? null);
      if (!settingsRes.error && settingsRes.data?.escrow_mode) {
        setEscrowMode(settingsRes.data.escrow_mode);
      }
      setError(null);
    } catch (err) {
      console.error('[useEscrowAdmin] load failed:', err);
      setError('Could not read the escrow position.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const proposeSweep = useCallback(async () => {
    setBusy(true);
    try {
      const { data, error: err } = await supabase.rpc('propose_fee_sweep', {
        p_sweep_date: null,
      });
      await refresh();
      if (err) return { ok: false as const, error: err.message };
      return { ok: true as const, result: data as Record<string, unknown> };
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const confirmSweep = useCallback(
    async (sweepId: string, bankReference: string) => {
      if (!profile?.id) return { ok: false as const, error: 'Not signed in.' };
      setBusy(true);
      try {
        const { error: err } = await supabase.rpc('confirm_fee_sweep', {
          p_sweep_id: sweepId,
          p_bank_reference: bankReference,
          p_admin_id: profile.id,
        });
        await refresh();
        if (err) return { ok: false as const, error: err.message };
        return { ok: true as const };
      } finally {
        setBusy(false);
      }
    },
    [profile?.id, refresh],
  );

  const cancelSweep = useCallback(
    async (sweepId: string, reason: string) => {
      if (!profile?.id) return { ok: false as const, error: 'Not signed in.' };
      setBusy(true);
      try {
        const { error: err } = await supabase.rpc('cancel_fee_sweep', {
          p_sweep_id: sweepId,
          p_reason: reason,
          p_admin_id: profile.id,
        });
        await refresh();
        if (err) return { ok: false as const, error: err.message };
        return { ok: true as const };
      } finally {
        setBusy(false);
      }
    },
    [profile?.id, refresh],
  );

  return {
    position,
    runs,
    openSweep,
    escrowMode,
    loading,
    busy,
    error,
    refresh,
    proposeSweep,
    confirmSweep,
    cancelSweep,
  };
}
