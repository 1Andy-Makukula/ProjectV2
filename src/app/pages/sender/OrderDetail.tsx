import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { supabase } from '../../../lib/supabaseClient';
import { TelemetryTimeline } from '../../components/shared/TelemetryTimeline';
import { useAuth } from '../../../utils/auth/AuthContext';
import { formatCurrency } from '../../../utils/currency';
import { getGiftPageUrl } from '../../../utils/whatsapp';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Package,
  MapPin,
  User,
  Phone,
  MessageSquare,
  Receipt,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
} from 'lucide-react';
import { cn } from '../../components/ui/utils';

// ---------------------------------------------------------------------------
// V2 Schema Types
// ---------------------------------------------------------------------------

interface Item {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price_zmw: number;
}

import { calculateTimeRemaining } from '../../../utils/timeHelpers';

interface Shop {
  id: string;
  name: string;
  location: string | null;
}

interface ShopOrderDetail {
  shop_order_id: string;
  claim_code: string;
  claim_status: string; // PENDING_PAYMENT | PENDING | REDEEMED | CANCELLED
  subtotal: number;
  recipient_name: string | null;
  recipient_phone: string | null;
  message: string | null;
  created_at: string;
  updated_at: string | null;
  shop: Shop;
  order_items: Array<{
    order_item_id: string;
    allocated_price: number;
    fulfillment_status: string;
    item: Item;
  }>;
}

interface TransactionDetail {
  transaction_id: string;
  buyer_id: string;
  total_amount: number;
  status: string;  // GATEWAY_PROCESSING | SUCCESSFUL | FAILED | CANCELLED
  gateway_tx_ref: string | null;
  origin_type: string;
  created_at: string;
  updated_at: string | null;
  shop_orders: ShopOrderDetail[];
  buyer: {
    name: string;
    email: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Derived display status
// ---------------------------------------------------------------------------

type DisplayStatus = 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled';

function deriveDisplayStatus(txStatus: string, claimStatus: string | null): DisplayStatus {
  if (txStatus === 'GATEWAY_PROCESSING') return 'pending_payment';
  if (txStatus === 'FAILED' || txStatus === 'CANCELLED') return 'cancelled';
  if (claimStatus === 'REDEEMED') return 'fulfilled';
  if (claimStatus === 'PENDING') return 'paid';
  return 'pending_payment';
}

const STATUS_CONFIG = {
  pending_payment: { label: 'Payment Pending', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-400' },
  paid:            { label: 'Payment Confirmed', icon: CheckCircle2, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-400' },
  fulfilled:       { label: 'Gift Collected', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-400' },
  cancelled:       { label: 'Cancelled', icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-400' },
};

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SkeletonDetail() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}

export function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>(); // orderId == transaction_id in V2
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [transaction, setTransaction] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumingPayment, setResumingPayment] = useState(false);
  const [events, setEvents] = useState<any[]>([]);

  const parsePayload = (payload: any) => {
    if (!payload) return {};
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload);
      } catch {
        return {};
      }
    }
    return payload;
  };

  const fetchEvents = async () => {
    if (!orderId) return;
    try {
      const { data, error } = await supabase
        .from('transaction_events')
        .select('*')
        .eq('transaction_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error('[OrderDetail] fetchEvents error:', err);
    }
  };

  const fetchTransaction = async () => {
    if (!orderId) return;

    setLoading(true);

    const { data, error } = await supabase
      .from('transactions')
      .select(`
        transaction_id,
        buyer_id,
        total_amount,
        status,
        gateway_tx_ref,
        origin_type,
        created_at,
        buyer:buyer_id (name, email),
        shop_orders (
          shop_order_id,
          claim_code,
          claim_status,
          subtotal,
          recipient_name,
          recipient_phone,
          message,
          created_at,
          shop:shop_id (id, name, location),
          order_items (
            order_item_id,
            allocated_price,
            fulfillment_status,
            item:item_id (id, name, description, image_url, price_zmw)
          )
        )
      `)
      .eq('transaction_id', orderId)
      .single();

    if (error) {
      console.error('[OrderDetail] fetch error:', error);
      toast.error('Could not load order details');
      navigate('/orders');
      return;
    }

    setTransaction(data as unknown as TransactionDetail);
    setLoading(false);
  };

  useEffect(() => {
    fetchTransaction();
    fetchEvents();

    // Real-time subscription: listen to shop_orders changes for this transaction
    const subscription = supabase
      .channel(`order-detail:${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shop_orders',
          filter: `transaction_id=eq.${orderId}`,
        },
        () => {
          fetchTransaction();
        },
      )
      .subscribe();

    // Subscribe to real-time telemetry updates
    const eventsSub = supabase
      .channel(`order-events:${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transaction_events',
          filter: `transaction_id=eq.${orderId}`,
        },
        (payload) => {
          const newEvent = payload.new;
          console.log('[OrderDetail] Postgres inserted telemetry:', newEvent);
          setEvents((prev) => [newEvent, ...prev]);

          // Flash a toast notification to the sender
          let toastMsg = 'Update: An event occurred on your order.';
          if (newEvent.event_type === 'FULFILLMENT_PROCESSED') {
            const parsed = parsePayload(newEvent.payload);
            const shopName = parsed?.shop_name || 'Partner Shop';
            toastMsg = `Update: Items handed over at ${shopName}!`;
          } else if (newEvent.event_type === 'CLAIM_VERIFIED') {
            toastMsg = 'Update: Escrow Claim Code verified successfully.';
          }
          toast.success(toastMsg, { duration: 5000 });
        },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
      eventsSub.unsubscribe();
    };
  }, [orderId]);

  const handleResumePayment = async () => {
    if (!transaction?.transaction_id) {
      toast.error('No transaction reference found.');
      return;
    }

    setResumingPayment(true);

    try {
      const { data, error } = await supabase.functions.invoke('checkout-init', {
        body: {
          transaction_id: transaction.transaction_id,
        },
      });

      if (error) throw error;
      if (data?.success === false || data?.error) {
        throw new Error(data.error || 'Failed to resume payment');
      }

      if (!data?.payment_link) throw new Error('No payment link returned');

      toast.success('Opening payment gateway...');
      window.location.assign(data.payment_link);
    } catch (err: any) {
      console.error('Error resuming payment:', err);
      toast.error(err.message || 'Failed to resume payment');
    } finally {
      setResumingPayment(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-sm">
          <div className="mx-auto max-w-2xl px-6 py-4">
            <Skeleton className="h-7 w-32" />
          </div>
        </div>
        <SkeletonDetail />
      </div>
    );
  }

  if (!transaction) return null;

  // Derive unified display status from the first shop order
  const firstShopOrder = transaction.shop_orders[0];
  const displayStatus = deriveDisplayStatus(
    transaction.status,
    firstShopOrder?.claim_status ?? null,
  );
  const statusCfg = STATUS_CONFIG[displayStatus];
  const StatusIcon = statusCfg.icon;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl px-6 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/orders')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Order Detail</h1>
            <p className="font-mono text-xs text-muted-foreground">
              #{firstShopOrder?.claim_code ?? transaction.transaction_id.slice(0, 8)}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
        {/* Status banner */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-3 rounded-2xl border px-5 py-4 ${statusCfg.bg} ${statusCfg.border}`}
        >
          <StatusIcon className={`h-5 w-5 ${statusCfg.color}`} />
          <div>
            <p className={`text-sm font-semibold ${statusCfg.color}`}>{statusCfg.label}</p>
            {displayStatus === 'pending_payment' && (
              <p className="text-xs text-amber-600/80">
                Complete your payment to secure this gift in escrow.
              </p>
            )}
            {displayStatus === 'paid' && (
              <p className="text-xs text-blue-600/80">
                Your gift is secured. Recipient can collect using the claim code.
              </p>
            )}
          </div>
          {displayStatus === 'pending_payment' && (
            <Button
              size="sm"
              onClick={handleResumePayment}
              disabled={resumingPayment}
              className="ml-auto bg-amber-500 hover:bg-amber-600 text-white shadow-md"
            >
              {resumingPayment ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Loading...</>
              ) : 'Complete Payment'}
            </Button>
          )}
        </motion.div>

        {/* Shop orders — one card per vendor */}
        {transaction?.shop_orders?.map((shopOrder, idx) => {
          const giftUrl = getGiftPageUrl(shopOrder.claim_code);

          return (
            <motion.div
              key={shopOrder.shop_order_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-md hover:shadow-lg transition-all duration-350"
            >
              {/* Product list in a scrollable container */}
              <div className="flex flex-col divide-y divide-gray-100 max-h-[340px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200">
                {shopOrder?.order_items?.map((orderItem) => {
                  const { item, fulfillment_status } = orderItem;
                  return (
                    <div key={item?.id} className="flex gap-4 p-5 hover:bg-slate-50/30 transition-colors duration-200">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-gray-50 border border-gray-100/70 shadow-inner flex items-center justify-center">
                        {item?.image_url ? (
                          <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Package className="h-8 w-8 text-gray-300" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-bold text-gray-900 text-sm truncate leading-snug">{item?.name}</p>
                            
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border shadow-sm",
                              fulfillment_status === 'COLLECTED' ? 'bg-green-50 text-green-700 border-green-200' :
                              fulfillment_status === 'MISSING' ? 'bg-red-50 text-red-700 border-red-200' :
                              fulfillment_status === 'FLOATING' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                              fulfillment_status === 'CONVERTED' ? 'bg-slate-50 text-slate-700 border-slate-200' :
                              fulfillment_status === 'EXPIRED' ? 'bg-gray-50 text-gray-500 border-gray-200' :
                              'bg-amber-50 text-amber-700 border-amber-200'
                            )}>
                              <span className={cn("h-1 w-1 rounded-full",
                                fulfillment_status === 'COLLECTED' ? 'bg-green-500' :
                                fulfillment_status === 'MISSING' ? 'bg-red-500' :
                                fulfillment_status === 'FLOATING' ? 'bg-orange-500' :
                                fulfillment_status === 'CONVERTED' ? 'bg-slate-500' :
                                fulfillment_status === 'EXPIRED' ? 'bg-gray-400' :
                                'bg-amber-500'
                              )} />
                              {fulfillment_status}
                            </span>
                          </div>
                          
                          {item?.description && (
                            <p className="mt-1 text-xs text-slate-500 line-clamp-2 leading-relaxed">{item.description}</p>
                          )}
                        </div>
                        
                        <div className="mt-2.5 flex items-center justify-between">
                          <p className="text-base font-extrabold text-primary">
                            {formatCurrency(orderItem.allocated_price || item?.price_zmw, 'ZMW')}
                          </p>
                          
                          {(fulfillment_status === 'PENDING' || fulfillment_status === 'FLOATING') && (
                            (() => {
                              const remaining = calculateTimeRemaining(shopOrder.created_at);
                              return (
                                <div className={cn(
                                  "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border shadow-sm",
                                  remaining.isUrgent ? 'text-red-600 bg-red-50 border-red-150 animate-pulse font-semibold' : 'text-slate-500 bg-slate-50 border-slate-100'
                                )}>
                                  <Clock className="h-3.5 w-3.5" />
                                  <span>{remaining.text}</span>
                                </div>
                              );
                            })()
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Claim code - Styled like a premium coupon/ticket */}
              <div className="border-t border-b border-dashed border-gray-200 bg-gradient-to-br from-orange-50/60 to-amber-50/30 px-6 py-5">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-orange-500">
                  Claim Code
                </p>
                <div className="flex items-center gap-3">
                  <span className="flex-1 font-mono text-2xl font-black tracking-[0.25em] text-orange-600 select-all selection:bg-orange-100">
                    {shopOrder.claim_code}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(shopOrder.claim_code, 'Claim code')}
                    title="Copy claim code"
                    className="h-9 w-9 rounded-xl hover:bg-orange-100/50 hover:text-orange-600 transition-colors"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => window.open(giftUrl, '_blank')}
                    title="Open gift page"
                    className="h-9 w-9 rounded-xl hover:bg-orange-100/50 hover:text-orange-600 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Shop details */}
              <div className="space-y-3.5 px-6 py-5 bg-slate-50/30">
                <InfoRow icon={MapPin} label="Shop" value={shopOrder.shop.name} />
                {shopOrder.shop.location && (
                  <InfoRow icon={MapPin} label="Location" value={shopOrder.shop.location} />
                )}
              </div>
            </motion.div>
          );
        })}

        {/* Recipient details — from first shop order */}
        {firstShopOrder && (firstShopOrder.recipient_name || firstShopOrder.recipient_phone) && (
          <Section title="Recipient">
            {firstShopOrder.recipient_name && (
              <InfoRow icon={User} label="Name" value={firstShopOrder.recipient_name} />
            )}
            {firstShopOrder.recipient_phone && (
              <InfoRow icon={Phone} label="Phone" value={firstShopOrder.recipient_phone} />
            )}
          </Section>
        )}

        {/* Gift message */}
        {firstShopOrder?.message && (
          <Section title="Personal Message">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
                <MessageSquare className="h-4 w-4" />
              </div>
              <p className="text-sm italic leading-relaxed text-gray-700">
                &quot;{firstShopOrder.message}&quot;
              </p>
            </div>
          </Section>
        )}

        {/* Transaction summary */}
        <Section title="Transaction">
          <InfoRow
            icon={Receipt}
            label="Amount"
            value={formatCurrency(transaction.total_amount, 'ZMW')}
          />
          {transaction.gateway_tx_ref && (
            <InfoRow
              icon={Layers}
              label="Reference"
              value={transaction.gateway_tx_ref}
            />
          )}
          <InfoRow
            icon={Clock}
            label="Date"
            value={new Date(transaction.created_at).toLocaleString()}
          />
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs font-semibold rounded-xl hover:bg-slate-50 flex items-center justify-center gap-1.5 border border-primary/20 hover:border-primary/40 text-primary transition-all duration-200"
              onClick={() => navigate(`/receipt/${transaction.transaction_id}`)}
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>View Printable Receipt</span>
            </Button>
          </div>
        </Section>

        {/* Telemetry Tracking timeline */}
        <Section title="Delivery Tracking">
          <TelemetryTimeline events={events} />
        </Section>
      </div>
    </div>
  );
}
