import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { formatCurrency } from '../../../utils/currency';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Package,
  Store,
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  TrendingUp,
  Clock,
  CheckCircle2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  item: { name: string; image_url: string | null } | null;
  shop: { name: string } | null;
}

// ---------------------------------------------------------------------------
// Status configuration — colour-coded badges
// ---------------------------------------------------------------------------

type StatusKey =
  | 'pending_payment'
  | 'payment_submitted'
  | 'paid'
  | 'fulfilled'
  | 'completed'
  | 'expired'
  | 'cancelled';

const STATUS_CONFIG: Record<
  StatusKey,
  { label: string; dot: string; pill: string }
> = {
  pending_payment: {
    label: 'Pending',
    dot: 'bg-amber-400',
    pill: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  payment_submitted: {
    label: 'Submitted',
    dot: 'bg-amber-400',
    pill: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  paid: {
    label: 'Paid',
    dot: 'bg-blue-400',
    pill: 'bg-blue-50 text-blue-700 ring-blue-200',
  },
  fulfilled: {
    label: 'Fulfilled',
    dot: 'bg-green-400',
    pill: 'bg-green-50 text-green-700 ring-green-200',
  },
  completed: {
    label: 'Completed',
    dot: 'bg-green-400',
    pill: 'bg-green-50 text-green-700 ring-green-200',
  },
  expired: {
    label: 'Expired',
    dot: 'bg-gray-400',
    pill: 'bg-gray-50 text-gray-500 ring-gray-200',
  },
  cancelled: {
    label: 'Cancelled',
    dot: 'bg-red-400',
    pill: 'bg-red-50 text-red-700 ring-red-200',
  },
};

const getStatus = (raw: string) =>
  STATUS_CONFIG[raw as StatusKey] ?? {
    label: raw,
    dot: 'bg-gray-400',
    pill: 'bg-gray-50 text-gray-500 ring-gray-200',
  };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffH = diffMs / 3_600_000;
  const diffD = diffMs / 86_400_000;

  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffD < 7) return `${Math.floor(diffD)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Animated status pill */
function StatusBadge({ status }: { status: string }) {
  const cfg = getStatus(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/** Summary stat card shown above the table */
function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white border border-gray-100 px-5 py-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

/** 5-row skeleton shown while loading */
function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          {/* Item */}
          <TableCell>
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
          </TableCell>
          {/* Recipient */}
          <TableCell><Skeleton className="h-3 w-24" /></TableCell>
          {/* Shop */}
          <TableCell><Skeleton className="h-3 w-28" /></TableCell>
          {/* Amount */}
          <TableCell><Skeleton className="h-3 w-16" /></TableCell>
          {/* Status */}
          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
          {/* Date */}
          <TableCell><Skeleton className="h-3 w-16" /></TableCell>
          {/* Arrow */}
          <TableCell><Skeleton className="h-4 w-4 rounded" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OrderDashboard() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.id) return;

    const fetch = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(`
          id,
          code,
          recipient_name,
          amount,
          currency,
          status,
          created_at,
          item:item_id (name, image_url),
          shop:shop_id (name)
        `)
        .eq('sender_id', profile.id)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('[OrderDashboard] fetch error:', fetchError);
        setError(fetchError.message);
      } else {
        setOrders((data as unknown as Order[]) ?? []);
      }

      setLoading(false);
    };

    fetch();
  }, [profile?.id]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const totalSpend = orders.reduce((sum, o) => sum + o.amount, 0);
  const completedCount = orders.filter(
    (o) => o.status === 'fulfilled' || o.status === 'completed',
  ).length;
  const pendingCount = orders.filter((o) =>
    ['pending_payment', 'payment_submitted', 'paid'].includes(o.status),
  ).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              id="order-dashboard-back"
              variant="ghost"
              size="icon"
              onClick={() => navigate('/home')}
              className="shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Order History
              </h1>
              <p className="text-xs text-muted-foreground">
                {loading ? 'Loading…' : `${orders.length} order${orders.length !== 1 ? 's' : ''} found`}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">

        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            icon={ClipboardList}
            label="Total Orders"
            value={loading ? '—' : orders.length}
            accent="bg-primary/10 text-primary"
          />
          <StatCard
            icon={TrendingUp}
            label="Total Spent"
            value={loading ? '—' : formatCurrency(totalSpend, orders[0]?.currency ?? 'ZMW')}
            accent="bg-orange-100 text-orange-600"
          />
          <StatCard
            icon={CheckCircle2}
            label="Completed"
            value={loading ? '—' : completedCount}
            accent="bg-green-100 text-green-600"
          />
          <StatCard
            icon={Clock}
            label="In Progress"
            value={loading ? '—' : pendingCount}
            accent="bg-amber-100 text-amber-600"
          />
        </div>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Failed to load orders: {error}
          </div>
        )}

        {/* ── Table card ──────────────────────────────────────────────────── */}
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">

          {/* Card header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">All Orders</h2>
            {!loading && orders.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {orders.length}
              </span>
            )}
          </div>

          {/* ── Empty state ─────────────────────────────────────────────── */}
          <AnimatePresence>
            {!loading && orders.length === 0 && !error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 text-center px-6"
              >
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50">
                  <Package className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-1 text-base font-semibold text-gray-900">No orders yet</h3>
                <p className="mb-6 max-w-xs text-sm text-muted-foreground">
                  You haven't sent any gifts yet. Browse our shops and send your first gift!
                </p>
                <Button
                  id="order-dashboard-browse"
                  onClick={() => navigate('/home')}
                  className="bg-gradient-to-r from-primary to-primary-light shadow-md"
                >
                  <Store className="mr-2 h-4 w-4" />
                  Browse Shops
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Table ───────────────────────────────────────────────────── */}
          {(loading || orders.length > 0) && (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                  <TableHead className="pl-6 w-[260px]">Gift Item</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead>Shop</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {/* Skeleton rows while loading */}
                {loading && <TableSkeleton />}

                {/* Real rows */}
                {!loading &&
                  orders.map((order, idx) => (
                    <motion.tr
                      key={order.id}
                      id={`order-row-${order.id}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      onClick={() => navigate(`/orders/${order.id}`)}
                      className="group cursor-pointer border-b border-gray-100 transition-colors hover:bg-orange-50/40"
                    >
                      {/* Item */}
                      <TableCell className="pl-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                            {order.item?.image_url ? (
                              <img
                                src={order.item.image_url}
                                alt={order.item.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Package className="h-5 w-5 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-900">
                              {order.item?.name ?? '—'}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              #{order.code}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      {/* Recipient */}
                      <TableCell className="text-sm text-gray-700">
                        {order.recipient_name || '—'}
                      </TableCell>

                      {/* Shop */}
                      <TableCell className="text-sm text-gray-600">
                        {order.shop?.name ?? '—'}
                      </TableCell>

                      {/* Amount */}
                      <TableCell className="text-right">
                        <span className="text-sm font-semibold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                          {formatCurrency(order.amount, order.currency)}
                        </span>
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <StatusBadge status={order.status} />
                      </TableCell>

                      {/* Date */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(order.created_at)}
                      </TableCell>

                      {/* Chevron */}
                      <TableCell className="pr-4">
                        <ArrowRight className="h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </TableCell>
                    </motion.tr>
                  ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
