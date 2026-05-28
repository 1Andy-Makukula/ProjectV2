// DashboardHub — Private operational command center at '/dashboard'
// Escrow Ledger + Live Activity Feed + Active Claims Cabinet

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { formatCurrency } from '../../../utils/currency';
import { motion, AnimatePresence } from 'motion/react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import { Skeleton } from '../../components/ui/skeleton';
import {
  ArrowRight, Shield, Clock, CheckCircle2,
  TrendingUp, Package, Copy, Check, Activity,
  ClipboardCheck, Wallet, Store
} from 'lucide-react';
import { toast } from 'sonner';
import { Header } from '../../components/layout/Header';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  fulfilled_at: string | null;
  paid_at: string | null;
  item: { name: string; image_url: string | null } | null;
  shop: { name: string; location: string | null } | null;
}

interface ActivityEvent {
  id: string;
  orderId: string;
  code: string;
  message: string;
  timestamp: string;
  type: 'fulfilled' | 'paid' | 'update';
}

// ─── Status config ────────────────────────────────────────────────────────────

type StatusKey = 'pending_payment' | 'payment_submitted' | 'paid' | 'fulfilled' | 'completed' | 'expired' | 'cancelled';

const STATUS_CFG: Record<StatusKey, { label: string; ledger: string; dot: string; pill: string }> = {
  pending_payment:    { label: 'Pending',    ledger: 'Pending',     dot: 'bg-amber-400',  pill: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  payment_submitted:  { label: 'Submitted',  ledger: 'Pending',     dot: 'bg-amber-400',  pill: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  paid:               { label: 'In Escrow',  ledger: 'Locked',      dot: 'bg-blue-400',   pill: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  fulfilled:          { label: 'Fulfilled',  ledger: 'Disbursed',   dot: 'bg-green-400',  pill: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
  completed:          { label: 'Completed',  ledger: 'Disbursed',   dot: 'bg-green-400',  pill: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
  expired:            { label: 'Expired',    ledger: 'Expired',     dot: 'bg-slate-400',  pill: 'bg-slate-50 text-slate-500 ring-1 ring-slate-200' },
  cancelled:          { label: 'Cancelled',  ledger: 'Cancelled',   dot: 'bg-red-400',    pill: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
};

const getStatus = (raw: string) =>
  STATUS_CFG[raw as StatusKey] ?? { label: raw, ledger: raw, dot: 'bg-slate-400', pill: 'bg-slate-50 text-slate-500 ring-1 ring-slate-200' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  const d = ms / 86_400_000;
  if (h < 1) return 'Just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' });
}

function absTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZM', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const cfg = getStatus(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function MetricTile({ icon: Icon, label, value, sub, gradient }: { icon: React.ElementType; label: string; value: string | number; sub?: string; gradient?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50">
          <Icon className="h-4 w-4 text-orange-500" strokeWidth={1.5} />
        </div>
      </div>
      {gradient ? (
        <p className="text-2xl font-bold tracking-tight bg-gradient-to-r from-orange-600 to-blue-700 bg-clip-text text-transparent">{value}</p>
      ) : (
        <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      )}
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function RowSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          <TableCell className="pl-5"><div className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-md shrink-0" /><div className="space-y-1.5"><Skeleton className="h-3 w-28" /><Skeleton className="h-2.5 w-16" /></div></div></TableCell>
          <TableCell><Skeleton className="h-3 w-20" /></TableCell>
          <TableCell><Skeleton className="h-3 w-24" /></TableCell>
          <TableCell><Skeleton className="h-3 w-14" /></TableCell>
          <TableCell><Skeleton className="h-3 w-16" /></TableCell>
          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
          <TableCell><Skeleton className="h-3 w-14" /></TableCell>
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

function ClaimCode({ order, onCopy }: { order: Order; onCopy: (code: string) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="truncate text-xs font-medium text-slate-600">{order.item?.name ?? 'Gift'}</p>
        <StatusPill status={order.status} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
        <span className="font-mono text-lg font-bold tracking-[0.25em] text-slate-900">{order.code}</span>
        <button
          onClick={() => onCopy(order.code)}
          className="ml-3 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          title="Copy claim code"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1 text-slate-400">
        <Store className="h-3 w-3 shrink-0" strokeWidth={1.5} />
        <p className="truncate text-xs">{order.shop?.name ?? '—'}{order.shop?.location ? ` · ${order.shop.location}` : ''}</p>
      </div>
      <p className="text-[10px] text-slate-400">{relativeTime(order.created_at)}</p>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function DashboardHub() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // ── Guard ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && (!user || !profile)) navigate('/login', { replace: true });
  }, [authLoading, user, profile, navigate]);

  // ── Initial data fetch ────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    if (!profile?.id) return;
    setOrdersLoading(true);
    
    // V2 Schema: Query transactions joined with shop_orders
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        transaction_id,
        status,
        total_amount,
        created_at,
        shop_orders!inner (
          shop_order_id,
          claim_code,
          claim_status,
          recipient_name,
          fulfilled_at,
          shop:shop_id (name, location),
          order_items (
            item:item_id (name, image_url)
          )
        )
      `)
      .eq('buyer_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      // Map back to legacy UI Order interface
      const formatted: Order[] = data.flatMap((tx: any) => 
        tx.shop_orders.map((so: any) => {
          let derivedStatus: Order['status'] = 'pending_payment';
          if (tx.status === 'GATEWAY_PROCESSING') derivedStatus = 'pending_payment';
          else if (tx.status === 'FAILED' || tx.status === 'CANCELLED') derivedStatus = 'expired';
          else if (['REDEEMED', 'FULFILLED', 'PARTIAL_FULFILLMENT'].includes(so.claim_status)) derivedStatus = 'fulfilled';
          else if (so.claim_status === 'PENDING') derivedStatus = 'paid';

          return {
            id: so.shop_order_id,
            code: so.claim_code,
            recipient_name: so.recipient_name,
            amount: so.subtotal || tx.total_amount,
            currency: 'ZMW',
            status: derivedStatus,
            created_at: tx.created_at,
            fulfilled_at: so.fulfilled_at,
            paid_at: tx.status === 'SUCCESSFUL' ? tx.created_at : undefined,
            item: so.order_items?.[0]?.item,
            shop: so.shop
          };
        })
      );
      
      setOrders(prev => {
        // Simple heuristic to add feed events on refetch if status changed
        const newFeedEvents: ActivityEvent[] = [];
        formatted.forEach(newOrd => {
          const oldOrd = prev.find(o => o.id === newOrd.id);
          if (oldOrd && oldOrd.status !== newOrd.status) {
            if (newOrd.status === 'fulfilled') {
              newFeedEvents.push({
                id: `${newOrd.id}-${Date.now()}`, orderId: newOrd.id, code: newOrd.code,
                message: `${newOrd.recipient_name} collected the gift at the shop.`,
                timestamp: new Date().toISOString(), type: 'fulfilled'
              });
              toast.success('Gift collected — escrow disbursed.');
            } else if (newOrd.status === 'paid') {
              newFeedEvents.push({
                id: `${newOrd.id}-${Date.now()}`, orderId: newOrd.id, code: newOrd.code,
                message: `Payment confirmed. Funds locked in escrow for order #${newOrd.code}.`,
                timestamp: new Date().toISOString(), type: 'paid'
              });
            }
          }
        });
        
        if (newFeedEvents.length > 0) {
          setFeed(f => [...newFeedEvents, ...f].slice(0, 20));
        }
        
        return formatted;
      });
    }
    setOrdersLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // ── Realtime subscription (Notify and Re-fetch) ───────────────────────────
  useEffect(() => {
    if (!user?.id && !profile?.id) return;
    const uid = user?.id || profile?.id;

    const channel = supabase
      .channel('dashboard-feed')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `buyer_id=eq.${uid}`,
      }, () => {
        loadOrders();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transaction_events',
        filter: `event_type=eq.CLAIM_VERIFIED`
      }, () => {
        loadOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, profile?.id, loadOrders]);

  // ── Derived memos ─────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const totalSpend = orders.reduce((s, o) => s + o.amount, 0);
    const inEscrow = orders.filter(o => o.status === 'paid').reduce((s, o) => s + o.amount, 0);
    const disbursed = orders.filter(o => ['fulfilled', 'completed'].includes(o.status)).length;
    const pending = orders.filter(o => ['pending_payment', 'payment_submitted'].includes(o.status)).length;
    return { totalSpend, inEscrow, disbursed, pending, total: orders.length };
  }, [orders]);

  const activeClaims = useMemo(
    () => orders.filter(o => o.status === 'paid'),
    [orders],
  );

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
      toast.success(`Code ${code} copied to clipboard`);
    });
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Global Header ─────────────────────────────────────────────── */}
      <Header
        onCartClick={() => navigate('/checkout')}
        onProfileClick={() => navigate('/settings')}
        onLogoClick={() => navigate('/')}
      />

      <div className="mx-auto max-w-7xl px-5 sm:px-8 py-8 space-y-8">

        {/* ── Metric tiles ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricTile
            icon={Wallet}
            label="Total Spent"
            value={ordersLoading ? '—' : formatCurrency(metrics.totalSpend, orders[0]?.currency ?? 'ZMW')}
            sub="All-time gift spend"
            gradient
          />
          <MetricTile
            icon={Shield}
            label="In Escrow"
            value={ordersLoading ? '—' : formatCurrency(metrics.inEscrow, orders[0]?.currency ?? 'ZMW')}
            sub="Funds awaiting collection"
            gradient
          />
          <MetricTile
            icon={CheckCircle2}
            label="Disbursed"
            value={ordersLoading ? '—' : metrics.disbursed}
            sub="Gifts successfully collected"
          />
          <MetricTile
            icon={Clock}
            label="Awaiting Payment"
            value={ordersLoading ? '—' : metrics.pending}
            sub="Orders pending payment"
          />
        </div>

        {/* ── Main grid: Ledger + right column ────────────────────────── */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">

          {/* ── Escrow Ledger (2/3 width) ────────────────────────────── */}
          <div className="xl:col-span-2 rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                <h2 className="text-sm font-semibold text-slate-900">Escrow Ledger</h2>
              </div>
              {!ordersLoading && (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                  {orders.length} orders
                </span>
              )}
            </div>

            {/* Empty state */}
            <AnimatePresence>
              {!ordersLoading && orders.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center py-20 text-center"
                >
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-slate-100 bg-slate-50">
                    <Package className="h-7 w-7 text-slate-300" strokeWidth={1} />
                  </div>
                  <p className="text-sm font-medium text-slate-700">No orders yet</p>
                  <p className="mt-1 text-xs text-slate-400">Your escrow ledger will appear here.</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Table */}
            {(ordersLoading || orders.length > 0) && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      <TableHead className="pl-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Item</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Recipient</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Shop</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">Amount</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ledger State</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Date</TableHead>
                      <TableHead className="w-6" />
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100">
                    {ordersLoading && <RowSkeleton />}
                    {!ordersLoading && orders.map((order, i) => {
                      const cfg = getStatus(order.status);
                      return (
                        <motion.tr
                          key={order.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          onClick={() => navigate(`/orders/${order.id}`)}
                          className="group cursor-pointer hover:bg-slate-50/60 transition-colors"
                        >
                          {/* Item */}
                          <TableCell className="pl-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-slate-100">
                                {order.item?.image_url
                                  ? <img src={order.item.image_url} alt="" className="h-full w-full object-cover" />
                                  : <div className="flex h-full w-full items-center justify-center"><Package className="h-4 w-4 text-slate-300" /></div>
                                }
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">{order.item?.name ?? '—'}</p>
                                <p className="font-mono text-[10px] text-slate-400">#{order.code}</p>
                              </div>
                            </div>
                          </TableCell>

                          {/* Recipient */}
                          <TableCell className="text-sm text-slate-600">{order.recipient_name || '—'}</TableCell>

                          {/* Shop */}
                          <TableCell className="text-sm text-slate-500">{order.shop?.name ?? '—'}</TableCell>

                          {/* Amount */}
                          <TableCell className="text-right">
                            <span className="text-sm font-semibold text-slate-900">
                              {formatCurrency(order.amount, order.currency)}
                            </span>
                          </TableCell>

                          {/* Ledger state */}
                          <TableCell>
                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                              {cfg.ledger}
                            </span>
                          </TableCell>

                          {/* Status pill */}
                          <TableCell><StatusPill status={order.status} /></TableCell>

                          {/* Date */}
                          <TableCell className="whitespace-nowrap text-xs text-slate-400">
                            {relativeTime(order.created_at)}
                          </TableCell>

                          {/* Chevron */}
                          <TableCell className="pr-4">
                            <ArrowRight className="h-3.5 w-3.5 text-slate-200 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400" />
                          </TableCell>
                        </motion.tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* ── Right column ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-6">

            {/* Activity Feed */}
            <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
                <Activity className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                <h2 className="text-sm font-semibold text-slate-900">Live Activity</h2>
                <span className="ml-auto flex h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              </div>

              <div className="divide-y divide-slate-50 max-h-[300px] overflow-y-auto">
                <AnimatePresence initial={false}>
                  {feed.length === 0 ? (
                    <div className="flex flex-col items-center py-10 text-center px-4">
                      <Activity className="h-8 w-8 text-slate-200 mb-2" strokeWidth={1} />
                      <p className="text-xs text-slate-400">Listening for real-time events...</p>
                    </div>
                  ) : (
                    feed.map(ev => (
                      <motion.div
                        key={ev.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="flex items-start gap-3 px-5 py-3.5"
                      >
                        <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                          ev.type === 'fulfilled' ? 'bg-green-400'
                          : ev.type === 'paid'    ? 'bg-blue-400'
                          :                         'bg-slate-300'
                        }`} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-700 leading-snug">{ev.message}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">{absTime(ev.timestamp)}</p>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Active Claims Cabinet */}
            <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
                <ClipboardCheck className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                <h2 className="text-sm font-semibold text-slate-900">Active Claims</h2>
                {activeClaims.length > 0 && (
                  <span className="ml-auto rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600 ring-1 ring-blue-100">
                    {activeClaims.length}
                  </span>
                )}
              </div>

              <div className="p-4 space-y-3 max-h-[360px] overflow-y-auto">
                {ordersLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
                  </div>
                ) : activeClaims.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-center">
                    <ClipboardCheck className="h-8 w-8 text-slate-200 mb-2" strokeWidth={1} />
                    <p className="text-xs text-slate-400">No active claim codes.</p>
                    <p className="text-[10px] text-slate-300 mt-0.5">Paid orders awaiting shop collection appear here.</p>
                  </div>
                ) : (
                  <AnimatePresence>
                    {activeClaims.map((order, i) => (
                      <motion.div
                        key={order.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06 }}
                      >
                        <ClaimCode
                          order={order}
                          onCopy={handleCopy}
                        />
                        {copiedCode === order.code && (
                          <p className="mt-1 flex items-center gap-1 text-[10px] text-green-600 font-medium px-1">
                            <Check className="h-3 w-3" /> Copied to clipboard
                          </p>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* ── Footer quick-nav ──────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-6">
          {[
            { label: 'All Orders', href: '/orders' },
            { label: 'Send a Gift', href: '/' },
            { label: 'Impact Report', href: '/impact' },
            { label: 'Settings', href: '/settings' },
          ].map(link => (
            <button
              key={link.href}
              onClick={() => navigate(link.href)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-900 transition-colors"
            >
              {link.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
