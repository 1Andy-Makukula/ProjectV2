// AdminEscrow — the master invariant, on a screen.
//
// WHY THIS PAGE EXISTS SEPARATELY FROM AdminFinance
// -------------------------------------------------
// AdminFinance reports on withdrawals and the settlement ledger: the old model,
// where merchants banked with KithLy. This page reports on the segregated
// client funds account and whether it holds what the ledger says it should.
//
// They are not the same question and merging them would blur the one thing that
// matters most here: everything on this page is customer money, and the
// difference between what the bank holds and what we owe is the single number
// that says whether this platform is solvent.
//
// WHAT IS DELIBERATELY NOT HERE
// -----------------------------
// There is no "reconcile now" button. Reconciliation needs the real bank
// balance, read from a statement by a person. A button here would either invent
// that number or compare the ledger against itself -- which always passes and
// proves nothing. The scheduled job owns it; this screen reads the verdict.
//
// There is no way to correct drift either. A screen that lets someone "fix" a
// discrepancy destroys the evidence of what caused it.

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { useEscrowAdmin, type ReconciliationRun } from '../../hooks/useEscrowAdmin';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../components/ui/utils';

function zmw(ngwee: number | null | undefined): string {
  if (ngwee == null) return '—';
  return `ZMW ${(ngwee / 100).toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const STATUS_STYLE: Record<ReconciliationRun['status'], { cls: string; label: string }> = {
  BALANCED: { cls: 'text-[var(--success)]', label: 'Balanced' },
  DRIFT: { cls: 'text-[var(--destructive)]', label: 'Drift' },
  INTERNAL_IMBALANCE: { cls: 'text-[var(--destructive)]', label: 'Ledger imbalance' },
  BANK_UNAVAILABLE: { cls: 'text-muted-foreground', label: 'Bank unreachable' },
};

export function AdminEscrow() {
  const {
    position,
    runs,
    openSweep,
    escrowMode,
    loading,
    busy,
    error,
    proposeSweep,
    confirmSweep,
    cancelSweep,
  } = useEscrowAdmin();

  const [bankRef, setBankRef] = useState('');
  const [note, setNote] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Reading the escrow position…</span>
        </div>
      </div>
    );
  }

  const last = position?.last_reconciliation ?? null;
  const healthy = position?.balanced && last?.status === 'BALANCED';

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-light">Client funds</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customer money held in escrow, and whether the bank agrees with the
          ledger. Mode:{' '}
          <span className="font-medium text-foreground">{escrowMode}</span>
        </p>
      </header>

      {error && (
        <p className="rounded-xl bg-[var(--destructive)]/10 p-4 text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------- */}
      {/* The verdict, first and biggest. Everything else is detail.      */}
      {/* ------------------------------------------------------------- */}
      <section
        className={cn(
          'rounded-2xl border p-6',
          healthy
            ? 'border-[var(--success)]/40 bg-[var(--success)]/5'
            : 'border-[var(--destructive)]/40 bg-[var(--destructive)]/5',
        )}
      >
        <div className="flex items-start gap-3">
          {healthy ? (
            <CheckCircle2 className="size-6 shrink-0 text-[var(--success)] mt-0.5" />
          ) : (
            <AlertTriangle className="size-6 shrink-0 text-[var(--destructive)] mt-0.5" />
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-medium">
              {position?.balanced === false
                ? 'The ledger does not balance against itself'
                : last?.status === 'DRIFT'
                ? 'The client funds account is out against the ledger'
                : last?.status === 'BANK_UNAVAILABLE'
                ? 'Today’s bank comparison did not run'
                : last?.status === 'BALANCED'
                ? 'The client funds account matches the ledger'
                : 'No reconciliation has run yet'}
            </h2>

            {position?.balanced === false && (
              <p className="mt-1 text-sm">
                A code path wrote a single-sided entry. This outranks every other
                finding on this page — the ledger’s own numbers cannot be trusted
                against the bank until it is found.
              </p>
            )}

            {last?.status === 'DRIFT' && (
              <p className="mt-1 text-sm">
                Out by <strong>{zmw(last.drift_ngwee)}</strong> as of{' '}
                {new Date(last.as_of).toLocaleString('en-ZM')}.
              </p>
            )}

            {!last && (
              <p className="mt-1 text-sm text-muted-foreground">
                Schedule <code>escrow-reconcile</code> and feed it the segregated
                account balance. Until it runs, nothing here has been checked
                against the bank.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* The invariant, spelled out as the equation it is.               */}
      {/* ------------------------------------------------------------- */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Scale className="size-4 text-muted-foreground" />
          <h2 className="font-medium">What we hold, and what we owe</h2>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Owed to senders', position?.sender_liabilities_ngwee, 'Funded, not yet collected'],
            ['Owed to merchants', position?.merchant_payables_ngwee, 'Collected, not yet paid out'],
            ['Fees accrued', position?.fees_accrued_ngwee, 'Earned, not yet swept'],
            ['Ledger client funds', position?.client_funds_ngwee, 'The sum of the three'],
          ].map(([label, value, sub]) => (
            <div key={label as string} className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">{label as string}</p>
              <p className="mt-1.5 font-medium tabular-nums">{zmw(value as number)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{sub as string}</p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Owed to senders + owed to merchants + fees accrued must equal the
          segregated account balance. Anything else is money missing or money
          unaccounted for.
        </p>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* Things that need a human                                        */}
      {/* ------------------------------------------------------------- */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="size-4 text-muted-foreground" />
          <h2 className="font-medium">Needs attention</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AttentionCard
            label="Payouts awaiting"
            value={position?.payouts_awaiting ?? 0}
            hint="Scheduled or retrying. Normal."
            alarming={false}
          />
          <AttentionCard
            label="Payouts stuck"
            value={position?.payouts_stuck ?? 0}
            hint="Unknown outcome or abandoned. Resolve against the rail — never retry."
            alarming={(position?.payouts_stuck ?? 0) > 0}
          />
          <AttentionCard
            label="Refunds held"
            value={position?.refunds_pending ?? 0}
            hint="Could not return to source. Needs the unclaimed-funds policy."
            alarming={(position?.refunds_pending ?? 0) > 0}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* The fee sweep — two phases, because the ledger records money    */}
      {/* that actually moved.                                            */}
      {/* ------------------------------------------------------------- */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="size-4 text-muted-foreground" />
          <h2 className="font-medium">Fee sweep</h2>
        </div>

        <div className="rounded-xl border border-border p-4">
          {openSweep ? (
            <div className="space-y-3">
              <p className="text-sm">
                A sweep of <strong>{zmw(openSweep.amount_ngwee)}</strong> is
                waiting. Make the transfer from the segregated account to
                operating, then enter the bank reference below.
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                  placeholder="Bank reference"
                  className="max-w-xs"
                />
                <Button
                  disabled={busy || !bankRef.trim()}
                  onClick={async () => {
                    const r = await confirmSweep(openSweep.id, bankRef.trim());
                    setNote(r.ok ? 'Sweep recorded.' : (r.error ?? 'Failed.'));
                    if (r.ok) setBankRef('');
                  }}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : 'Confirm transfer'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    const r = await cancelSweep(openSweep.id, 'Cancelled by admin');
                    setNote(r.ok ? 'Sweep cancelled.' : (r.error ?? 'Failed.'));
                  }}
                >
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Nothing is recorded until you confirm. The ledger only ever
                describes money that has already moved.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm">
                  Unswept fees: <strong>{zmw(position?.unswept_fee_ngwee)}</strong>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One transfer a day means one number to reconcile.
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy || (position?.unswept_fee_ngwee ?? 0) <= 0}
                onClick={async () => {
                  const r = await proposeSweep();
                  setNote(
                    r.ok
                      ? ((r.result?.message as string) ?? 'Sweep proposed.')
                      : (r.error ?? 'Failed.'),
                  );
                }}
              >
                Propose sweep
              </Button>
            </div>
          )}

          {note && <p className="mt-3 text-sm text-muted-foreground">{note}</p>}
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* History. Immutable, so this is the real record.                 */}
      {/* ------------------------------------------------------------- */}
      <section>
        <h2 className="font-medium mb-3">Reconciliation history</h2>

        {runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No reconciliation has run yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Bank</th>
                  <th className="px-4 py-2 font-medium text-right">Drift</th>
                  <th className="px-4 py-2 font-medium text-right">Owed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const style = STATUS_STYLE[r.status];
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-2 whitespace-nowrap">
                        {new Date(r.as_of).toLocaleString('en-ZM')}
                      </td>
                      <td className={cn('px-4 py-2 font-medium', style.cls)}>
                        {style.label}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {zmw(r.bank_balance_ngwee)}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-right tabular-nums',
                          (r.drift_ngwee ?? 0) !== 0 && 'text-[var(--destructive)]',
                        )}
                      >
                        {zmw(r.drift_ngwee)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {zmw(
                          r.sender_liabilities_ngwee +
                            r.merchant_payables_ngwee +
                            r.fees_accrued_ngwee,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <HelpCircle className="size-3.5 shrink-0 mt-0.5" />
          These rows are immutable. A reconciliation result that could be edited
          would not be a control.
        </p>
      </section>
    </div>
  );
}

function AttentionCard({
  label,
  value,
  hint,
  alarming,
}: {
  label: string;
  value: number;
  hint: string;
  alarming: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        alarming ? 'border-[var(--destructive)]/40 bg-[var(--destructive)]/5' : 'border-border',
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1.5 text-2xl font-light tabular-nums',
          alarming && 'text-[var(--destructive)]',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
