import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { invokeFunction } from '../../utils/edgeFunction';

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
  // No `useAuth()` here any more. This hook used to read the signed-in admin's
  // id only to pass it to the sweep RPCs as `p_admin_id`, which is exactly the
  // value that should never have come from the browser. `admin-fee-sweep`
  // takes it from the verified token instead.
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

  // A sweep moves the platform's accrued fees out of the segregated account,
  // so all three go through `admin-fee-sweep` rather than calling the RPC from
  // here. 20261013000000 revoked `authenticated` from the three functions: the
  // browser could reach them with the public anon key, and two of them took
  // the acting admin's id as a parameter and only checked that the id NAMED an
  // admin -- not that the caller was that admin. The id is now taken from the
  // verified token inside the function, so it is no longer ours to send.
  const sweepAction = useCallback(
    async (body: Record<string, unknown>): Promise<
      { ok: true; result: Record<string, unknown> | null } | { ok: false; error: string }
    > => {
      // invokeFunction, not functions.invoke directly: a non-2xx reply carries
      // the reason in the body and supabase-js hides it behind a generic
      // "non-2xx status code" message. The screen needs the real one -- "A bank
      // reference is required", "Nothing accrued to sweep" -- which is what
      // this used to get for free when it called the RPC.
      try {
        const data = await invokeFunction<{ result?: Record<string, unknown> | null }>(
          'admin-fee-sweep',
          body,
        );
        return { ok: true, result: data?.result ?? null };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'We could not reach the fee sweep service.',
        };
      }
    },
    [],
  );

  const proposeSweep = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await sweepAction({ action: 'propose', sweep_date: null });
      await refresh();
      return outcome;
    } finally {
      setBusy(false);
    }
  }, [refresh, sweepAction]);

  const confirmSweep = useCallback(
    async (sweepId: string, bankReference: string) => {
      setBusy(true);
      try {
        const outcome = await sweepAction({
          action: 'confirm',
          sweep_id: sweepId,
          bank_reference: bankReference,
        });
        await refresh();
        return outcome;
      } finally {
        setBusy(false);
      }
    },
    [refresh, sweepAction],
  );

  const cancelSweep = useCallback(
    async (sweepId: string, reason: string) => {
      setBusy(true);
      try {
        const outcome = await sweepAction({
          action: 'cancel',
          sweep_id: sweepId,
          reason,
        });
        await refresh();
        return outcome;
      } finally {
        setBusy(false);
      }
    },
    [refresh, sweepAction],
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
