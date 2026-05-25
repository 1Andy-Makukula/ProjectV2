import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { supabase } from '../../../lib/supabaseClient';
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

interface Shop {
  id: string;
  name: string;
  location: string | null;
  address: string | null;
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
  order_items: Array<{ item: Item }>;
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
    phone: string | null;
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
        updated_at,
        buyer:buyer_id (name, email, phone),
        shop_orders (
          shop_order_id,
          claim_code,
          claim_status,
          subtotal,
          recipient_name,
          recipient_phone,
          message,
          created_at,
          updated_at,
          shop:shop_id (id, name, location, address),
          order_items (
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
  }, [orderId]);

  // Real-time subscription: listen to shop_orders changes for this transaction
  useEffect(() => {
    if (!orderId) return;

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

    return () => {
      subscription.unsubscribe();
    };
  }, [orderId]);

  const handleResumePayment = async () => {
    if (!transaction?.gateway_tx_ref) {
      toast.error('No payment reference found.');
      return;
    }

    setResumingPayment(true);

    try {
      const { data, error } = await supabase.functions.invoke('server', {
        body: {
          action: 'initialize_payment',
          orderId: transaction.transaction_id,
          amount: transaction.total_amount,
          currency: 'ZMW',
          email: profile?.email || '',
          name: profile?.name || 'Customer',
          phone: profile?.phone || '',
          txRef: transaction.gateway_tx_ref,
        },
      });

      if (error) throw error;
      if (!data?.paymentLink) throw new Error('No payment link returned');

      window.location.assign(data.paymentLink);
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
        {transaction.shop_orders.map((shopOrder, idx) => {
          const giftUrl = getGiftPageUrl(shopOrder.claim_code);

          return (
            <motion.div
              key={shopOrder.shop_order_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
            >
              {/* Product header */}
              {shopOrder.order_items.map(({ item }) => (
                <div key={item.id} className="flex gap-4 border-b border-gray-100 p-5">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Package className="h-8 w-8 text-gray-300" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{item.name}</p>
                    {item.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                    )}
                    <p className="mt-2 text-base font-bold text-primary">
                      {formatCurrency(shopOrder.subtotal, 'ZMW')}
                    </p>
                  </div>
                </div>
              ))}

              {/* Claim code */}
              <div className="border-b border-gray-100 bg-orange-50/60 px-5 py-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Claim Code
                </p>
                <div className="flex items-center gap-3">
                  <span className="flex-1 font-mono text-2xl font-bold tracking-[0.3em] text-primary">
                    {shopOrder.claim_code}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(shopOrder.claim_code, 'Claim code')}
                    title="Copy claim code"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => window.open(giftUrl, '_blank')}
                    title="Open gift page"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Shop details */}
              <div className="space-y-3 px-5 py-4">
                <InfoRow icon={MapPin} label="Shop" value={shopOrder.shop.name} />
                {shopOrder.shop.location && (
                  <InfoRow icon={MapPin} label="Location" value={shopOrder.shop.location} />
                )}
                {shopOrder.shop.address && (
                  <InfoRow icon={MapPin} label="Address" value={shopOrder.shop.address} />
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
        </Section>
      </div>
    </div>
  );
}
