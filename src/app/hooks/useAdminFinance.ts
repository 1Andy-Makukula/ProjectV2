import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { formatDate } from '../../utils/relativeTime';

/**
 * Admin-side read model for money leaving the platform.
 *
 * Withdrawals are drained automatically by batch-payout-sweeper (cron, every
 * 15 minutes), so nothing here approves a payout — the gap this closes is
 * observability. Admin RLS already permits SELECT on both tables; there was
 * simply no screen reading them, which left `failed` payouts invisible.
 */

export interface AdminWithdrawal {
  id: string;
  shop_id: string;
  shop_name: string | null;
  amount: number;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  provider: string | null;
  provider_reference: string | null;
  failure_reason: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface AdminLedgerEntry {
  id: string;
  shop_id: string;
  shop_name: string | null;
  ledger_type: string;
  credit_amount: number;
  amount: number | null;
  commission: number | null;
  status: string | null;
  created_at: string;
}

export interface FinanceTotals {
  pendingCount: number;
  pendingAmount: number;
  failedCount: number;
  failedAmount: number;
  paidAmount: number;
  owedAmount: number;
}

export function useAdminFinance() {
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [ledger, setLedger] = useState<AdminLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [withdrawalRes, ledgerRes] = await Promise.all([
        supabase
          .from('merchant_withdrawals')
          .select('id, shop_id, amount, status, provider, provider_reference, failure_reason, created_at, processed_at, shop:shop_id(name)')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('payout_ledger')
          .select('id, shop_id, ledger_type, credit_amount, amount, commission, status, created_at, shop:shop_id(name)')
          .order('created_at', { ascending: false })
          .limit(500),
      ]);

      if (withdrawalRes.error) throw withdrawalRes.error;
      if (ledgerRes.error) throw ledgerRes.error;

      setWithdrawals(
        (withdrawalRes.data ?? []).map((w: any) => ({
          id: w.id,
          shop_id: w.shop_id,
          shop_name: w.shop?.name ?? null,
          amount: w.amount ?? 0,
          status: w.status,
          provider: w.provider ?? null,
          provider_reference: w.provider_reference ?? null,
          failure_reason: w.failure_reason ?? null,
          created_at: w.created_at,
          processed_at: w.processed_at ?? null,
        })),
      );

      setLedger(
        (ledgerRes.data ?? []).map((l: any) => ({
          id: l.id,
          shop_id: l.shop_id,
          shop_name: l.shop?.name ?? null,
          ledger_type: l.ledger_type,
          credit_amount: l.credit_amount ?? 0,
          amount: l.amount ?? null,
          commission: l.commission ?? null,
          status: l.status ?? null,
          created_at: l.created_at,
        })),
      );
    } catch (error: any) {
      console.error('Error loading finance data:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sum = (list: AdminWithdrawal[]) => list.reduce((acc, w) => acc + w.amount, 0);
  const pending = withdrawals.filter((w) => w.status === 'pending' || w.status === 'processing');
  const failed = withdrawals.filter((w) => w.status === 'failed');
  const paid = withdrawals.filter((w) => w.status === 'paid');

  /** What the platform still owes: credits banked but not yet withdrawn. */
  const owedAmount = ledger
    .filter((l) => l.status === 'pending_withdrawal')
    .reduce((acc, l) => acc + (l.credit_amount || 0), 0);

  const totals: FinanceTotals = {
    pendingCount: pending.length,
    pendingAmount: sum(pending),
    failedCount: failed.length,
    failedAmount: sum(failed),
    paidAmount: sum(paid),
    owedAmount,
  };

  const exportLedgerToCSV = useCallback((rows: AdminLedgerEntry[]) => {
    const headers = ['Date', 'Shop', 'Type', 'Credit', 'Amount', 'Commission', 'Status'];
    const body = rows.map((l) => [
      formatDate(l.created_at),
      l.shop_name ?? '',
      l.ledger_type,
      (l.credit_amount / 100).toFixed(2),
      l.amount != null ? (l.amount / 100).toFixed(2) : '',
      l.commission != null ? (l.commission / 100).toFixed(2) : '',
      l.status ?? '',
    ]);

    const csv = [headers.join(','), ...body.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kithly-settlements-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Settlements exported to CSV');
  }, []);

  return {
    withdrawals,
    ledger,
    totals,
    loading,
    exportLedgerToCSV,
    reload: load,
  };
}
