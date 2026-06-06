import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingUp, Gift, Store, ArrowLeft, Sparkles, Bell, X, Clock, AlertCircle, ChevronRight, CreditCard, Receipt, Send, Inbox, Package, CheckCircle2, QrCode, Coins, Lock, PhoneOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { formatCurrency } from '../../../utils/currency';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { QRCodeDisplay } from '../../components/shared/QRCodeDisplay';
import { EmptyState } from '../../components/shared/EmptyState';
import type { FloatingItem } from '../../../types/database.types';
import { WalletLedgerView } from '../../components/shared/WalletLedgerView';
import { ActiveVouchers } from '../../components/features/ActiveVouchers';
import { ClaimHistory } from '../../components/features/ClaimHistory';


function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-3 w-44" />
    </div>
  );
}

interface MetricCardProps {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | number;
  subLabel?: string;
}

function MetricCard({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  subLabel,
}: MetricCardProps) {
  return (
    <Card className="rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center gap-4 pb-2 space-y-0">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${iconBg}`}
        >
          <Icon className={`h-6 w-6 ${iconColor}`} />
        </div>
        <CardTitle className="text-sm font-medium text-muted-foreground leading-snug">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold text-gray-900 tracking-tight">
          {value}
        </p>
        {subLabel && (
          <p className="mt-1 text-xs text-muted-foreground">{subLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

import { calculateTimeRemaining } from '../../../utils/timeHelpers';


// Derived unified status for display
type DisplayStatus =
  | 'pending_payment'
  | 'paid'
  | 'fulfilled'
  | 'completed'
  | 'expired'
  | 'cancelled';

const STATUS_CONFIG: Record<
  DisplayStatus,
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

function deriveDisplayStatus(txStatus: string, claimStatus: string | null): DisplayStatus {
  if (txStatus === 'GATEWAY_PROCESSING') return 'pending_payment';
  if (txStatus === 'FAILED' || txStatus === 'CANCELLED') return 'cancelled';
  if (claimStatus === 'REDEEMED') return 'fulfilled';
  if (claimStatus === 'PENDING') return 'paid';
  return 'pending_payment';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr} · ${timeStr}`;
}

export function CustomerDashboard() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [metricsLoading, setMetricsLoading] = useState(true);
  const [totalGenerosity, setTotalGenerosity] = useState(0);
  const [giftsDelivered, setGiftsDelivered] = useState(0);
  const [shopsSupported, setShopsSupported] = useState(0);

  const [latestNotification, setLatestNotification] = useState<any | null>(null);

  // Top-level panel: 'sending' | 'receiving' — persisted to localStorage
  const LS_KEY = 'kithly_active_dashboard_view';
  const [activePanel, setActivePanelState] = useState<'sending' | 'receiving'>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return stored === 'receiving' ? 'receiving' : 'sending';
    } catch { return 'sending'; }
  });

  const setActivePanel = useCallback((panel: 'sending' | 'receiving') => {
    setActivePanelState(panel);
    try { localStorage.setItem(LS_KEY, panel); } catch { /* ignore */ }
  }, []);

  const [activeTab, setActiveTab] = useState('orders');
  const [floatingItems, setFloatingItems] = useState<FloatingItem[]>([]);
  const [loadingFloating, setLoadingFloating] = useState(false);
  const [selectedClaimCode, setSelectedClaimCode] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [convertingItemId, setConvertingItemId] = useState<string | null>(null);

  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [resumingPaymentId, setResumingPaymentId] = useState<string | null>(null);

  const [receivedGifts, setReceivedGifts] = useState<any[]>([]);
  const [loadingReceived, setLoadingReceived] = useState(false);
  const handleResumePayment = async (order: any) => {
    setResumingPaymentId(order.transaction_id);

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
      
      // Refresh local UI states using the optimized pipeline
      fetchOrdersAndMetrics();
    } catch (err: any) {
      console.error('[CustomerDashboard] resume payment error:', err);
      toast.error(err.message || 'Failed to resume payment');
    } finally {
      setResumingPaymentId(null);
    }
  };


  const fetchFloatingItems = async () => {
    if (!profile?.phone) return;
    setLoadingFloating(true);
    try {
      const { data, error } = await supabase
        .from('order_items')
        .select('order_item_id, created_at, child_claim_code, allocated_price, items(name, image_url), shop_orders!inner(recipient_phone)')
        .eq('fulfillment_status', 'FLOATING')
        .eq('shop_orders.recipient_phone', profile.phone);

      if (error) throw error;
      setFloatingItems((data as any) || []);
    } catch (err) {
      console.error('[CustomerDashboard] fetchFloatingItems error:', err);
      setFloatingItems([]);
    } finally {
      setLoadingFloating(false);
    }
  };

  const fetchReceivedGifts = async () => {
    if (!profile?.phone) return;
    setLoadingReceived(true);
    try {
      const { data, error } = await supabase
        .from('shop_orders')
        .select(`
          shop_order_id,
          claim_code,
          claim_status,
          created_at,
          message,
          recipient_name,
          recipient_phone,
          subtotal,
          shops (
            name,
            address,
            logo_url
          ),
          transactions (
            users (
              name
            )
          ),
          order_items (
            items (
              name,
              image_url
            )
          )
        `)
        .eq('recipient_phone', profile.phone)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReceivedGifts(data || []);
    } catch (err) {
      console.error('[CustomerDashboard] fetchReceivedGifts error:', err);
      setReceivedGifts([]);
    } finally {
      setLoadingReceived(false);
    }
  };

  const fetchOrdersAndMetrics = async () => {
    if (!profile?.id) return;
    setLoadingOrders(true);
    setMetricsLoading(true);
    try {
      const { data, error } = await supabase
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
            shop_id,
            shop:shop_id (name),
            order_items (
              item:item_id (name, image_url)
            )
          )
        `)
        .eq('buyer_id', profile.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      let totalGen = 0;
      let deliveredCount = 0;
      const uniqueShops = new Set<string>();

      const flatOrders = (data ?? []).map((txn: any) => {
        totalGen += txn.total_amount ?? 0;
        
        if (txn.shop_orders) {
          txn.shop_orders.forEach((so: any) => {
            deliveredCount += 1;
            if (so.shop_id) uniqueShops.add(so.shop_id);
          });
        }

        const firstShopOrder = txn.shop_orders?.[0];
        const firstItem = firstShopOrder?.order_items?.[0]?.item;
        const shop = firstShopOrder?.shop;

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
          item_name: firstItem?.name ?? null,
          item_image_url: firstItem?.image_url ?? null,
        };
      });

      setOrders(flatOrders);
      setTotalGenerosity(totalGen);
      setGiftsDelivered(deliveredCount);
      setShopsSupported(uniqueShops.size);

    } catch (err) {
      console.error('[CustomerDashboard] fetchOrdersAndMetrics error:', err);
      setTotalGenerosity(0);
      setGiftsDelivered(0);
      setShopsSupported(0);
    } finally {
      setLoadingOrders(false);
      setMetricsLoading(false);
    }
  };

  const handleConvert = async (item: FloatingItem) => {
    if (!user?.id) {
      toast.error('You must be logged in to convert items to credits.');
      return;
    }
    setConvertingItemId(item.order_item_id);
    try {
      const { error } = await supabase.rpc('convert_floating_item_to_credits', {
        p_item_id: item.order_item_id,
        p_user_id: user.id,
      });

      if (error) throw error;

      toast.success('Credits added to your wallet!');
      fetchFloatingItems();
      window.dispatchEvent(new Event('wallet-update'));
    } catch (err: any) {
      console.error('[CustomerDashboard] handleConvert error:', err);
      toast.error(err.message || 'Failed to convert item to credits.');
    } finally {
      setConvertingItemId(null);
    }
  };

  useEffect(() => {
    if (!profile?.id) return;
    
    // Fire all initial queries in parallel
    const promises = [fetchOrdersAndMetrics()];
    if (profile?.phone) {
      promises.push(fetchReceivedGifts(), fetchFloatingItems());
    }
    Promise.all(promises);

    const channel = supabase
      .channel('dashboard-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          const newNotif = payload.new;
          setLatestNotification(newNotif);
          setTimeout(() => setLatestNotification(null), 5000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.phone]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              id="dashboard-back"
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
              className="shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Impact Dashboard
              </h1>
              <p className="text-xs text-muted-foreground">
                A snapshot of your generosity
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        <AnimatePresence>
          {latestNotification && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg shadow-sm flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-green-600" />
                <p className="text-sm font-medium text-green-800">
                  {latestNotification.message}
                </p>
              </div>
              <button 
                onClick={() => setLatestNotification(null)}
                className="text-green-600 hover:bg-green-100 p-1 rounded-full transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              Your Giving
            </span>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">
            Your Giving at a Glance
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Every gift you send puts money directly into the hands of local merchants and
            brings joy to someone across the distance.
          </p>
        </motion.div>

        <div id="metrics-grid" className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {metricsLoading ? (
            <>
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </>
          ) : (
            <>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <MetricCard
                  icon={TrendingUp}
                  iconBg="bg-orange-100"
                  iconColor="text-orange-600"
                  label="Total Generosity"
                  value={formatCurrency(totalGenerosity, 'ZMW')}
                  subLabel="Cumulative value of gifts sent"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <MetricCard
                  icon={Gift}
                  iconBg="bg-primary/10"
                  iconColor="text-primary"
                  label="Gifts Delivered"
                  value={giftsDelivered}
                  subLabel="Successful deliveries to recipients"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 }}
              >
                <MetricCard
                  icon={Store}
                  iconBg="bg-amber-100"
                  iconColor="text-amber-600"
                  label="Local Shops Supported"
                  value={shopsSupported}
                  subLabel="Unique merchants benefited"
                />
              </motion.div>
            </>
          )}
        </div>

        {/* ── Top-level P2P panel toggle ── */}
        <div className="flex w-full items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/70 backdrop-blur-md p-1 shadow-sm mb-2">
          {([['sending', Send, 'Sending Details'], ['receiving', Inbox, 'Receiving Details']] as const).map(([panel, Icon, label]) => (
            <button
              key={panel}
              id={`dashboard-panel-${panel}`}
              onClick={() => setActivePanel(panel)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 min-h-[44px] ${
                activePanel === panel
                  ? 'bg-gradient-to-r from-primary to-primary-light text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* ── SENDING DETAILS panel ── */}
        <AnimatePresence mode="wait">
        {activePanel === 'sending' && (
          <motion.div key="sending" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="orders">Order History</TabsTrigger>
            <TabsTrigger value="vault">My Vault</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            {loadingOrders ? (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <div key={i} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-1/4" />
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </div>
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-16 w-16 rounded-xl" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : orders.length === 0 ? (
              <EmptyState
                icon={Gift}
                title="No Orders Yet"
                description="When you send a gift, its details and transaction history will show up here!"
                action={{
                  label: "Send a Gift",
                  onClick: () => navigate('/')
                }}
              />
            ) : (
              <div className="space-y-4">
                {orders.map((order, idx) => {
                  const displayStatus = deriveDisplayStatus(order.status, order.claim_status);
                  const isPendingPayment = displayStatus === 'pending_payment';
                  const statusCfg = STATUS_CONFIG[displayStatus] ?? {
                    label: displayStatus,
                    dot: 'bg-gray-400',
                    pill: 'bg-gray-50 text-gray-500 ring-gray-200',
                  };

                  return (
                    <motion.div
                      key={order.transaction_id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: idx * 0.05 }}
                      className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-all duration-300"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-50 pb-4 mb-4">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Order #{order.transaction_id.slice(0, 8)}</span>
                          <span>•</span>
                          <span>{formatDate(order.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusCfg.pill}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`} />
                            {statusCfg.label}
                          </span>

                          {order.claim_status === 'PENDING' && (
                            (() => {
                              const remaining = calculateTimeRemaining(order.created_at);
                              return (
                                <div className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                                  remaining.isUrgent ? 'text-red-600 bg-red-50 ring-1 ring-red-100 animate-pulse' : 'text-slate-500 bg-slate-50 ring-1 ring-slate-100'
                                }`}>
                                  <Clock className="h-3 w-3" />
                                  <span>{remaining.text}</span>
                                </div>
                              );
                            })()
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-start gap-4">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100 border border-gray-100 flex items-center justify-center">
                            {order.item_image_url ? (
                              <img
                                src={order.item_image_url}
                                alt={order.item_name || 'Gift'}
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            ) : (
                              <Gift className="h-6 w-6 text-slate-300" />
                            )}
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-sm font-semibold text-gray-900 leading-snug">
                              {order.item_name || 'KithLy Gift Bundle'}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              Recipient: <span className="font-medium text-gray-700">{order.recipient_name || 'Gift Recipient'}</span>
                            </p>
                            {order.shop_name && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Store className="h-3 w-3 text-slate-400" />
                                <span>{order.shop_name}</span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-4 border-t md:border-t-0 pt-4 md:pt-0 border-gray-50">
                          <div className="text-left md:text-right">
                            <p className="text-xs text-muted-foreground">Total Price</p>
                            <p className="text-base font-bold text-gray-900">
                              {formatCurrency(order.total_amount, 'ZMW')}
                            </p>
                          </div>
                                                   <div className="flex flex-wrap gap-2 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/orders/${order.transaction_id}`)}
                              className="text-xs font-semibold rounded-xl text-primary hover:bg-primary/5 transition-all flex items-center gap-1"
                            >
                              <span>View Details</span>
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                            
                            {!isPendingPayment && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/receipt/${order.transaction_id}`)}
                                className="text-xs font-semibold rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-all flex items-center gap-1"
                              >
                                <Receipt className="h-3.5 w-3.5" />
                                <span>View Receipt</span>
                              </Button>
                            )}

                            {isPendingPayment && (
                              <Button
                                size="sm"
                                onClick={() => handleResumePayment(order)}
                                disabled={resumingPaymentId === order.transaction_id}
                                className="bg-primary hover:bg-primary-dark text-white font-medium shadow-sm transition-all flex items-center gap-1.5"
                              >
                                {resumingPaymentId === order.transaction_id ? (
                                  <>
                                    <Clock className="h-3.5 w-3.5 animate-spin" />
                                    <span>Retrying...</span>
                                  </>
                                ) : (
                                  <>
                                    <CreditCard className="h-3.5 w-3.5" />
                                    <span>Complete Payment</span>
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>

                      {isPendingPayment && (
                        <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50/50 border border-amber-100/50 px-4 py-3 text-amber-800 text-xs">
                          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                          <div className="flex-1">
                            <span className="font-semibold">Payment Incomplete:</span> We haven't received confirmation for this order yet. You can complete the checkout now.
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="vault">
            {!profile?.phone ? (
              <EmptyState
                icon={PhoneOff}
                title="Phone Number Required"
                description="We need your phone number to find your floating gifts. Please update your profile in settings."
                action={{
                  label: "Go to Settings",
                  onClick: () => navigate('/settings')
                }}
              />
            ) : loadingFloating ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2].map((i) => (
                  <div key={i} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-16 w-16 rounded-xl shrink-0" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                    <Skeleton className="h-10 w-full rounded-xl" />
                  </div>
                ))}
              </div>
            ) : floatingItems.length === 0 ? (
              <EmptyState
                icon={Gift}
                title="Your Vault is Empty"
                description="Items marked as MISSING by a merchant will appear here as FLOATING so you can claim them at other KithLy partner shops."
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {floatingItems.map((item, idx) => (
                  <motion.div
                    key={item.child_claim_code}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.05 }}
                    className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between"
                  >
                    <div className="flex items-start gap-4">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                        {item.items?.image_url ? (
                          <img
                            src={item.items.image_url}
                            alt={item.items.name}
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Gift className="h-6 w-6 text-slate-300" />
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate leading-snug">
                          {item.items?.name || 'Unspecified Gift'}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-600 ring-1 ring-orange-100">
                            <Lock className="h-3.5 w-3.5" />
                            <span>Locked Value: {formatCurrency(item.allocated_price, 'ZMW')}</span>
                          </div>

                          {(() => {
                            const remaining = calculateTimeRemaining(item.created_at);
                            return (
                              <div className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                                remaining.isUrgent ? 'text-red-600 bg-red-50 ring-1 ring-red-100 animate-pulse' : 'text-slate-500 bg-slate-50 ring-1 ring-slate-100'
                              }`}>
                                <Clock className="h-3 w-3" />
                                <span>{remaining.text}</span>
                              </div>
                            );
                          })()}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-2">
                          Available to claim at any KithLy partner shop for this value or less.
                        </p>
                      </div>
                    </div>
                    
                    <div className="mt-6 grid grid-cols-2 gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs font-medium rounded-xl hover:bg-slate-50"
                        onClick={() => {
                          setSelectedClaimCode(item.child_claim_code);
                          setIsModalOpen(true);
                        }}
                      >
                        <QrCode className="mr-2 h-3.5 w-3.5" />
                        Claim Item
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs font-medium text-slate-400 hover:text-slate-600 rounded-xl"
                        disabled={convertingItemId !== null}
                        onClick={() => handleConvert(item)}
                      >
                        <Coins className="mr-2 h-3.5 w-3.5" />
                        {convertingItemId === item.order_item_id ? 'Converting...' : 'Convert'}
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>

        </Tabs>
        </motion.div>
        )}

        {/* ── RECEIVING DETAILS panel ── */}
        {activePanel === 'receiving' && (
          <motion.div key="receiving" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
            {!profile?.phone ? (
              <EmptyState
                icon={PhoneOff}
                title="Phone Number Required"
                description="We need your phone number to find gifts sent to you. Add it in Settings."
                action={{ label: 'Go to Settings', onClick: () => navigate('/settings') }}
              />
            ) : loadingReceived ? (
              <div className="space-y-8">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm space-y-4">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-40 w-full rounded-2xl" />
                    <Skeleton className="h-10 w-full rounded-xl" />
                  </div>
                ))}
              </div>
            ) : (() => {
              const activeVouchers = receivedGifts.filter(o => o.claim_status === 'PENDING' || !o.claim_status);
              const claimHistory = receivedGifts.filter(o => o.claim_status === 'FULFILLED' || o.claim_status === 'PARTIAL_FULFILLMENT');

              return (
                <div className="space-y-10">
                  {/* Immutable Wallet Ledger */}
                  <section>
                    <WalletLedgerView />
                  </section>

                  {/* Active Vouchers */}
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <QrCode className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-700">Active Vouchers</h3>
                      {activeVouchers.length > 0 && (
                        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          {activeVouchers.length}
                        </span>
                      )}
                    </div>

                    {activeVouchers.length === 0 ? (
                      <EmptyState icon={Package} title="No active vouchers" description="Gifts sent to your phone number will appear here, ready to show to the merchant." />
                    ) : (
                      <ActiveVouchers activeVouchers={activeVouchers} />
                    )}
                  </section>

                  {/* Claim History */}
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Claim History</h3>
                    </div>

                    <ClaimHistory claimHistory={claimHistory} />
                  </section>
                </div>
              );
            })()}
          </motion.div>
        )}
        </AnimatePresence>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-md text-center p-8 rounded-3xl">
            <DialogHeader className="space-y-3 flex flex-col items-center">
              <DialogTitle className="text-xl font-bold text-gray-900 tracking-tight">
                Redemption QR Code
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 max-w-xs leading-relaxed">
                Show this code to the cashier to claim your item.
              </DialogDescription>
            </DialogHeader>

            <div className="my-6 flex flex-col items-center justify-center p-6 bg-slate-50 rounded-2xl border border-slate-100">
              {selectedClaimCode && (
                <>
                  <QRCodeDisplay value={selectedClaimCode} size={180} />
                  <p className="mt-4 font-mono text-lg font-bold tracking-[0.25em] text-slate-900 select-all selection:bg-orange-100">
                    {selectedClaimCode}
                  </p>
                </>
              )}
            </div>

            <Button
              onClick={() => setIsModalOpen(false)}
              className="w-full rounded-xl py-3 font-semibold shadow-sm"
            >
              Close
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

