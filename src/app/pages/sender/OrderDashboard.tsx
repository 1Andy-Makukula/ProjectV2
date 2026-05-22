import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
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
import { toast } from 'sonner';

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  recipient_phone: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  flutterwave_tx_ref: string | null;
  items: { name: string; image_url: string | null } | null;
  shops: { name: string } | null;
}

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

function formatDate(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffH = diffMs / 3_600_000;
  const diffD = diffMs / 86_400_000;

  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffD < 7) return `${Math.floor(diffD)}d ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

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
    <div className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
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

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          <TableCell>
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-md shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
          </TableCell>
          <TableCell><Skeleton className="h-3 w-24" /></TableCell>
          <TableCell><Skeleton className="h-3 w-28" /></TableCell>
          <TableCell><Skeleton className="h-3 w-16" /></TableCell>
          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
          <TableCell><Skeleton className="h-3 w-16" /></TableCell>
          <TableCell><Skeleton className="h-4 w-4 rounded" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function OrderDashboard() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumingPayment, setResumingPayment] = useState<string | null>(null);

  const handleResumePayment = async (order: Order) => {
    if (!order.flutterwave_tx_ref) {
      toast.error('No payment reference found. Please contact support.');
      return;
    }

    setResumingPayment(order.id);

    try {
      const { data, error } = await supabase.functions.invoke('server', {
        body: {
          action: 'initialize_payment',
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          email: profile?.email || '',
          name: profile?.name || 'Customer',
          phone: order.recipient_phone || '',
          txRef: order.flutterwave_tx_ref,
        },
      });

      if (error) throw error;
      if (!data?.paymentLink) throw new Error('No payment link returned');

      window.location.assign(data.paymentLink);
    } catch (err: any) {
      console.error('Error resuming payment:', err);
      toast.error(err.message || 'Failed to resume payment');
    } finally {
      setResumingPayment(null);
    }
  };

  useEffect(() => {
    if (!profile?.id) return;

    const fetchOrders = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('orders')
        .select('*, items(name, image_url), shops(name)')
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

    fetchOrders();
  }, [profile?.id]);

  const totalSpend = orders.reduce((sum, order) => sum + order.amount, 0);
  const completedCount = orders.filter(
    (order) => order.status === 'fulfilled' || order.status === 'completed',
  ).length;
  const pendingCount = orders.filter((order) =>
    ['pending_payment', 'payment_submitted', 'paid'].includes(order.status),
  ).length;

  return (
    <div className="min-h-screen bg-gray-50">
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
              <h1 className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-xl font-bold text-transparent">
                Order History
              </h1>
              <p className="text-xs text-muted-foreground">
                {loading
                  ? 'Loading...'
                  : `${orders.length} order${orders.length !== 1 ? 's' : ''} found`}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
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

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load orders: {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">All Orders</h2>
            {!loading && orders.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {orders.length}
              </span>
            )}
          </div>

          <AnimatePresence>
            {!loading && orders.length === 0 && !error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center px-6 py-20 text-center"
              >
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50">
                  <Package className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-1 text-base font-semibold text-gray-900">No orders yet</h3>
                <p className="mb-6 max-w-xs text-sm text-muted-foreground">
                  You haven&apos;t sent any gifts yet. Browse our shops and send your first gift!
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

          {(loading || orders.length > 0) && (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                  <TableHead className="w-[260px] pl-6">Product</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead>Shop</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading && <TableSkeleton />}

                {!loading &&
                  orders.map((order, index) => (
                    <motion.tr
                      key={order.id}
                      id={`order-row-${order.id}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                      onClick={() => navigate(`/orders/${order.id}`)}
                      className="group cursor-pointer border-b border-gray-100 transition-colors hover:bg-orange-50/40"
                    >
                      <TableCell className="pl-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100">
                            {order.items?.image_url ? (
                              <img
                                src={order.items.image_url}
                                alt={order.items.name}
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
                              {order.items?.name ?? 'Product unavailable'}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground">
                              #{order.code}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="text-sm text-gray-700">
                        {order.recipient_name || '—'}
                      </TableCell>

                      <TableCell className="text-sm text-gray-600">
                        {order.shops?.name ?? '—'}
                      </TableCell>

                      <TableCell className="text-right">
                        <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-sm font-semibold text-transparent">
                          {formatCurrency(order.amount, order.currency)}
                        </span>
                      </TableCell>

                      <TableCell>
                        <StatusBadge status={order.status} />
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(order.created_at)}
                      </TableCell>

                      <TableCell className="pr-4">
                        {order.status === 'pending_payment' ? (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResumePayment(order);
                            }}
                            size="sm"
                            className="bg-primary hover:bg-primary/90 text-white shadow-md font-semibold whitespace-nowrap px-4"
                            disabled={resumingPayment === order.id}
                          >
                            {resumingPayment === order.id ? 'Loading...' : 'Complete Payment'}
                          </Button>
                        ) : (
                          <ArrowRight className="h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                        )}
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
