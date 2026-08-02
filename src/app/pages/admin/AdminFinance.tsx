// AdminFinance — the admin's view of money leaving the platform.
//
// Withdrawals drain automatically via batch-payout-sweeper (cron, every 15
// minutes) and merchants keep their own settlement tab, so nothing here
// approves or moves money. What was missing was the other half: no admin
// screen read merchant_withdrawals or payout_ledger, so a `failed` payout —
// the one state that needs a human — was invisible to everyone.

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, Search, Wallet, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { formatCurrency } from '../../../utils/currency';
import { formatDate } from '../../../utils/relativeTime';
import { useAdminFinance } from '../../hooks/useAdminFinance';

const WITHDRAWAL_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
};

export function AdminFinance() {
  const navigate = useNavigate();
  const { withdrawals, ledger, totals, loading, exportLedgerToCSV } = useAdminFinance();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = (shopName: string | null, ...extra: (string | null)[]) =>
    !q ||
    (shopName ?? '').toLowerCase().includes(q) ||
    extra.some((v) => (v ?? '').toLowerCase().includes(q));

  const filteredWithdrawals = withdrawals.filter((w) =>
    matches(w.shop_name, w.status, w.provider_reference),
  );
  const filteredLedger = ledger.filter((l) => matches(l.shop_name, l.ledger_type, l.status));

  return (
    <PageShell>
      <AdminPageHeader
        title="Finance"
        subtitle="Withdrawals and settlement ledger across every shop"
        onBack={() => navigate('/admin')}
        actions={
          <Button
            onClick={() => exportLedgerToCSV(filteredLedger)}
            className="bg-white text-primary hover:bg-white/90 h-8"
            disabled={filteredLedger.length === 0}
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
        }
      />

      <PageBody>
        {/* Headline figures */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Owed to Shops"
            value={totals.owedAmount}
            animate
            isCurrency
            icon={Wallet}
            sub="Credited but not yet withdrawn"
          />
          <StatCard
            label="In Flight"
            value={totals.pendingAmount}
            animate
            isCurrency
            icon={Clock}
            sub={`${totals.pendingCount} awaiting the sweeper`}
            live={totals.pendingCount > 0}
          />
          <StatCard
            label="Failed Payouts"
            value={totals.failedAmount}
            animate
            isCurrency
            icon={AlertTriangle}
            sub={
              totals.failedCount > 0
                ? `${totals.failedCount} need attention`
                : 'None outstanding'
            }
          />
          <StatCard
            label="Paid Out"
            value={totals.paidAmount}
            animate
            isCurrency
            icon={CheckCircle2}
            sub="Successfully transferred, all time"
          />
        </div>

        {/* Failed payouts are the reason this page exists — surface them up top. */}
        {totals.failedCount > 0 && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" />
            <p className="text-sm leading-relaxed text-red-800">
              <strong>
                {totals.failedCount} payout{totals.failedCount === 1 ? '' : 's'} failed
              </strong>{' '}
              totalling {formatCurrency(totals.failedAmount)}. The amount has been returned to each
              merchant's wallet, so they can request again — but the underlying transfer problem
              will recur until it is resolved.
            </p>
          </div>
        )}

        <div className="relative mb-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by shop, status or reference…"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            className="h-10 pl-9"
          />
        </div>

        <Tabs defaultValue="withdrawals">
          <TabsList className="mb-6 grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="withdrawals" className="font-light">
              Withdrawals ({filteredWithdrawals.length})
            </TabsTrigger>
            <TabsTrigger value="settlements" className="font-light">
              Settlements ({filteredLedger.length})
            </TabsTrigger>
          </TabsList>

          {/* ── Withdrawals ─────────────────────────────────────────────── */}
          <TabsContent value="withdrawals">
            {loading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Loading withdrawals…</p>
            ) : filteredWithdrawals.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No withdrawal requests yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shop</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Processed</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWithdrawals.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">{w.shop_name ?? '—'}</TableCell>
                        <TableCell>{formatCurrency(w.amount)}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={WITHDRAWAL_STATUS_STYLES[w.status] ?? ''}
                          >
                            {w.status}
                          </Badge>
                          {w.failure_reason && (
                            <p className="mt-1 max-w-xs text-xs text-red-600">{w.failure_reason}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(w.created_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {w.processed_at ? formatDate(w.processed_at) : '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {w.provider_reference ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── Settlement ledger ───────────────────────────────────────── */}
          <TabsContent value="settlements">
            {loading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Loading settlements…</p>
            ) : filteredLedger.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No settlement entries yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Credit</TableHead>
                      <TableHead>Commission</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLedger.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-muted-foreground">
                          {formatDate(l.created_at)}
                        </TableCell>
                        <TableCell className="font-medium">{l.shop_name ?? '—'}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{l.ledger_type}</span>
                        </TableCell>
                        <TableCell>{formatCurrency(l.credit_amount)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {l.commission != null ? formatCurrency(l.commission) : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{l.status ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PageBody>
    </PageShell>
  );
}

export default AdminFinance;
