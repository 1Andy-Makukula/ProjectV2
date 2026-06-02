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

// ---------------------------------------------------------------------------
// V2 Schema Types
// ---------------------------------------------------------------------------

interface OrderItemInfo {
  name: string;
  image_url: string | null;
}

interface OrderView {
  // transaction fields
  transaction_id: string;
  buyer_id: string;
  total_amount: number;
  status: string;           // GATEWAY_PROCESSING | SUCCESSFUL | FAILED
  gateway_tx_ref: string | null;
  created_at: string;

  // derived from shop_orders (first shop order for display)
  claim_code: string | null;
  claim_status: string | null; // PENDING_PAYMENT | PENDING | REDEEMED
  recipient_name: string | null;
  shop_name: string | null;

  // from order_items → items (first item for display thumbnail)
  item_name: string | null;
  item_image_url: string | null;
  items: OrderItemInfo[];
}

// Derived unified status for display
type DisplayStatus =
  | 'pending_payment'
  | 'paid'
  | 'fulfilled'
  | 'completed'
  | 'expired'
  | 'cancelled';

type StatusKey = DisplayStatus;

const STATUS_CONFIG: Record<
  StatusKey,
  { label: string; dot: string; pill: string }
> = {
  pending_payment: {
    label: 'Pending',
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

/**
 * Maps V2 transaction.status + shop_orders.claim_status to a display status.
 *
 * V2 status values:
 *   transactions.status: GATEWAY_PROCESSING | SUCCESSFUL | FAILED | CANCELLED
 *   shop_orders.claim_status: PENDING_PAYMENT | PENDING | REDEEMED | CANCELLED
 */
function deriveDisplayStatus(txStatus: string, claimStatus: string | null): DisplayStatus {
  if (txStatus === 'GATEWAY_PROCESSING') return 'pending_payment';
  if (txStatus === 'FAILED' || txStatus === 'CANCELLED') return 'cancelled';
  if (claimStatus === 'REDEEMED') return 'fulfilled';
  if (claimStatus === 'PENDING') return 'paid';
  return 'pending_payment';
}

const getStatus = (raw: DisplayStatus) =>
  STATUS_CONFIG[raw] ?? {
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

function StatusBadge({ status }: { status: DisplayStatus }) {
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
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200/60 bg-white/70 backdrop-blur-md px-5 py-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="text-lg font-semibold text-slate-900 tracking-tight">{value}</p>
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

  const [orders, setOrders] = useState<OrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumingPayment, setResumingPayment] = useState<string | null>(null);

  const handleResumePayment = async (order: OrderView) => {
    setResumingPayment(order.transaction_id);

    try {
      const { data, error } = await supabase.functions.invoke('checkout-retry', {
        body: {
          transaction_id: order.transaction_id,
        },
      });

      if (error) throw error;
      if (data?.success === false || data?.error) {
        throw new Error(data.error || 'Failed to retry payment');
      }

      if (!data?.payment_link) {
        throw new Error('No payment link returned');
      }

      toast.success('Opening payment gateway...');
      window.open(data.payment_link, '_blank');
      
      // Refresh local UI states
      window.location.reload();
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

      // V2: Query transactions joined with the first shop_order and its first item.
      // We use a subquery-style approach: fetch transactions, then for each
      // fetch the first shop_order (claim_code, claim_status, recipient_name, shop name)
      // and the first order_item → item (name, image_url).
      const { data, error: fetchError } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          buyer_id,
          total_amount,
          status,
          gateway_tx_ref,
          created_at,
          shop_orders (
            shop_order_id,
            claim_code,
            claim_status,
            recipient_name,
            shop:shop_id (name),
            order_items (
              item:item_id (name, image_url)
            )
          )
        `)
        .eq('buyer_id', profile.id)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('[OrderDashboard] fetch error:', fetchError);
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      // Flatten the nested V2 structure into a flat OrderView for rendering
      const flatOrders: OrderView[] = (data ?? []).map((txn: any) => {
        const firstShopOrder = txn.shop_orders?.[0];
        const shop = firstShopOrder?.shop;

        const allItems: OrderItemInfo[] = [];
        const uniqueShopNames = new Set<string>();

        txn.shop_orders?.forEach((so: any) => {
          if (so.shop?.name) {
            uniqueShopNames.add(so.shop.name);
          }
          so.order_items?.forEach((oi: any) => {
            if (oi.item?.name) {
              allItems.push({
                name: oi.item.name,
                image_url: oi.item.image_url ?? null,
              });
            }
          });
        });

        let summaryName = 'Product unavailable';
        if (allItems.length === 1) {
          summaryName = allItems[0].name;
        } else if (allItems.length > 1) {
          const shopNamesArr = Array.from(uniqueShopNames);
          if (shopNamesArr.length === 1) {
            summaryName = `${allItems.length} Items from ${shopNamesArr[0]}`;
          } else if (shopNamesArr.length > 1) {
            summaryName = `${allItems.length} Items from ${shopNamesArr[0]} & ${shopNamesArr.length - 1} other${shopNamesArr.length - 1 > 1 ? 's' : ''}`;
          } else {
            summaryName = `${allItems.length} Items`;
          }
        }

        const firstItem = allItems[0] ?? null;

        return {
          transaction_id: txn.transaction_id,
          buyer_id: txn.buyer_id,
          total_amount: txn.total_amount,
          status: txn.status,
          gateway_tx_ref: txn.gateway_tx_ref,
          created_at: txn.created_at,
          claim_code: firstShopOrder?.claim_code ?? null,
          claim_status: firstShopOrder?.claim_status ?? null,
          recipient_name: firstShopOrder?.recipient_name ?? null,
          shop_name: shop?.name ?? null,
          item_name: summaryName,
          item_image_url: firstItem?.image_url ?? null,
          items: allItems,
        };
      });

      setOrders(flatOrders);
      setLoading(false);
    };

    fetchOrders();
  }, [profile?.id]);

  const totalSpend = orders.reduce((sum, order) => sum + order.total_amount, 0);
  const completedCount = orders.filter((order) => {
    const ds = deriveDisplayStatus(order.status, order.claim_status);
    return ds === 'fulfilled' || ds === 'completed';
  }).length;
  const pendingCount = orders.filter((order) => {
    const ds = deriveDisplayStatus(order.status, order.claim_status);
    return ds === 'pending_payment' || ds === 'paid';
  }).length;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="sticky top-0 z-10 border-b border-slate-200/60 bg-white/50 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              id="order-dashboard-back"
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
              className="shrink-0 hover:bg-slate-100 active:scale-95 transition-all duration-200 rounded-lg"
            >
              <ArrowLeft className="h-5 w-5 text-slate-700" />
            </Button>
            <div>
              <h1 className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-xl font-bold text-transparent tracking-tight">
                Order History
              </h1>
              <p className="text-xs text-slate-500 font-medium">
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
            value={loading ? '—' : formatCurrency(totalSpend, 'ZMW')}
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

        <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white/70 backdrop-blur-md shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-700">All Orders</h2>
            {!loading && orders.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
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
                  onClick={() => navigate('/dashboard')}
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
                  orders.map((order, index) => {
                    const displayStatus = deriveDisplayStatus(order.status, order.claim_status);

                    return (
                      <motion.tr
                        key={order.transaction_id}
                        id={`order-row-${order.transaction_id}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.04 }}
                        onClick={() => navigate(`/orders/${order.transaction_id}`)}
                        className="group cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/50"
                      >
                        <TableCell className="pl-6 py-3">
                          <div className="flex items-center gap-3">
                            {order?.items && order.items.length > 1 ? (
                              <div className="flex -space-x-3 overflow-hidden shrink-0">
                                {order.items.slice(0, 3).map((item, idx) => (
                                  <div
                                    key={idx}
                                    className="inline-block h-10 w-10 rounded-md ring-2 ring-white overflow-hidden bg-gray-100 shrink-0"
                                  >
                                    {item?.image_url ? (
                                      <img
                                        src={item.image_url}
                                        alt={item.name}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center">
                                        <Package className="h-5 w-5 text-gray-400" />
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {order.items.length > 3 && (
                                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-200 text-[10px] font-bold text-slate-600 ring-2 ring-white shrink-0">
                                    +{order.items.length - 3}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100">
                                {order?.item_image_url ? (
                                  <img
                                    src={order.item_image_url}
                                    alt={order.item_name ?? ''}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <Package className="h-5 w-5 text-gray-400" />
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">
                                {order?.item_name ?? 'Product unavailable'}
                              </p>
                              <p className="font-mono text-xs text-slate-500">
                                #{order?.claim_code ?? '—'}
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="text-sm text-slate-700 font-medium">
                          {order.recipient_name || '—'}
                        </TableCell>

                        <TableCell className="text-sm text-slate-600">
                          {order.shop_name ?? '—'}
                        </TableCell>

                        <TableCell className="text-right">
                          <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-sm font-semibold text-transparent">
                            {formatCurrency(order.total_amount, 'ZMW')}
                          </span>
                        </TableCell>

                        <TableCell>
                          <StatusBadge status={displayStatus} />
                        </TableCell>

                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(order.created_at)}
                        </TableCell>

                        <TableCell className="pr-4">
                          {displayStatus === 'pending_payment' ? (
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResumePayment(order);
                              }}
                              size="sm"
                              className="bg-primary hover:bg-primary/90 text-white shadow-md font-semibold whitespace-nowrap px-4"
                              disabled={resumingPayment === order.transaction_id}
                            >
                              {resumingPayment === order.transaction_id ? 'Loading...' : 'Complete Payment'}
                            </Button>
                          ) : (
                            <ArrowRight className="h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                          )}
                        </TableCell>
                      </motion.tr>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
