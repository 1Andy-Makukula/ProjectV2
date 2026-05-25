import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Copy, CheckCircle, XCircle, Package, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Separator } from '../../components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog';
import { supabase } from '../../../lib/supabaseClient';
import { formatCurrency } from '../../../utils/currency';
import { callServer } from '../../../utils/server';
import { getGiftPageUrl } from '../../../utils/whatsapp';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// V2 Schema Types
// ---------------------------------------------------------------------------

/**
 * Full detail view combining:
 *   transactions → shop_orders → order_items → items, shops
 *   transactions.buyer → users
 */
interface OrderDetail {
  // Transaction
  transaction_id: string;
  tx_status: string;        // GATEWAY_PROCESSING | SUCCESSFUL | FAILED | CANCELLED
  total_amount: number;
  gateway_tx_ref: string | null;
  origin_type: string;
  created_at: string;
  updated_at: string | null;

  // First shop order (display)
  shop_order_id: string | null;
  claim_code: string | null;
  claim_status: string | null;  // PENDING_PAYMENT | PENDING | REDEEMED | CANCELLED
  recipient_name: string | null;
  recipient_phone: string | null;
  message: string | null;
  shop_order_updated_at: string | null;

  // First item (display)
  item_id: string | null;
  item_name: string | null;
  item_description: string | null;
  item_image_url: string | null;
  item_price: number | null;

  // Shop
  shop_id: string | null;
  shop_name: string | null;
  shop_location: string | null;
  shop_address: string | null;

  // Buyer (sender)
  buyer_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;

  // Derived
  derived_status: string;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function deriveStatus(txStatus: string, claimStatus: string | null): string {
  if (txStatus === 'GATEWAY_PROCESSING') return 'pending_payment';
  if (txStatus === 'FAILED' || txStatus === 'CANCELLED') return 'cancelled';
  if (claimStatus === 'REDEEMED') return 'fulfilled';
  if (claimStatus === 'PENDING') return 'paid';
  return 'pending_payment';
}

const STATUS_COLOR: Record<string, string> = {
  fulfilled:       'bg-green-100 text-green-800 border-green-200',
  paid:            'bg-blue-100 text-blue-800 border-blue-200',
  pending_payment: 'bg-orange-100 text-orange-800 border-orange-200',
  cancelled:       'bg-red-100 text-red-800 border-red-200',
};

const STATUS_LABEL: Record<string, string> = {
  fulfilled:       'Gift Fulfilled',
  paid:            'Payment Confirmed',
  pending_payment: 'Pending Payment',
  cancelled:       'Cancelled',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminOrderDetail() {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>(); // orderId == transaction_id in V2
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (orderId) {
      loadOrder();
    }
  }, [orderId]);

  const loadOrder = async () => {
    try {
      setLoading(true);

      // V2: Query the transaction by transaction_id, joining all related tables
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          status,
          total_amount,
          gateway_tx_ref,
          origin_type,
          created_at,
          updated_at,
          buyer_id,
          buyer:buyer_id (name, email, phone),
          shop_orders (
            shop_order_id,
            claim_code,
            claim_status,
            recipient_name,
            recipient_phone,
            message,
            updated_at,
            shop:shop_id (id, name, location, address),
            order_items (
              item:item_id (id, name, description, image_url, price_zmw)
            )
          )
        `)
        .eq('transaction_id', orderId)
        .single();

      if (error) throw error;

      const txn = data as any;
      const firstShopOrder = txn.shop_orders?.[0];
      const firstItem = firstShopOrder?.order_items?.[0]?.item;
      const shop = firstShopOrder?.shop;
      const buyer = txn.buyer;

      const detail: OrderDetail = {
        transaction_id: txn.transaction_id,
        tx_status: txn.status,
        total_amount: txn.total_amount,
        gateway_tx_ref: txn.gateway_tx_ref,
        origin_type: txn.origin_type,
        created_at: txn.created_at,
        updated_at: txn.updated_at,

        shop_order_id: firstShopOrder?.shop_order_id ?? null,
        claim_code: firstShopOrder?.claim_code ?? null,
        claim_status: firstShopOrder?.claim_status ?? null,
        recipient_name: firstShopOrder?.recipient_name ?? null,
        recipient_phone: firstShopOrder?.recipient_phone ?? null,
        message: firstShopOrder?.message ?? null,
        shop_order_updated_at: firstShopOrder?.updated_at ?? null,

        item_id: firstItem?.id ?? null,
        item_name: firstItem?.name ?? null,
        item_description: firstItem?.description ?? null,
        item_image_url: firstItem?.image_url ?? null,
        item_price: firstItem?.price_zmw ?? null,

        shop_id: shop?.id ?? null,
        shop_name: shop?.name ?? null,
        shop_location: shop?.location ?? null,
        shop_address: shop?.address ?? null,

        buyer_id: txn.buyer_id,
        buyer_name: buyer?.name ?? null,
        buyer_email: buyer?.email ?? null,
        buyer_phone: buyer?.phone ?? null,

        derived_status: deriveStatus(txn.status, firstShopOrder?.claim_status ?? null),
      };

      setOrder(detail);
    } catch (error: any) {
      console.error('Error loading order:', error);
      toast.error('Failed to load order details');
      navigate('/admin/orders');
    } finally {
      setLoading(false);
    }
  };

  /**
   * V2 status update:
   *   "paid"      → confirm_payment action → SUCCESSFUL + PENDING shop_orders
   *   "fulfilled" → set shop_orders.claim_status = REDEEMED
   *   "expired"   → set transactions.status = CANCELLED + shop_orders.claim_status = CANCELLED
   */
  const updateOrderStatus = async (newStatus: 'paid' | 'fulfilled' | 'expired') => {
    if (!order) return;

    setUpdating(true);
    try {
      if (newStatus === 'paid') {
        // Calls server/index.ts confirm_payment → updates transactions + shop_orders
        await callServer(`/orders/${order.transaction_id}/confirm-payment`);

      } else if (newStatus === 'fulfilled') {
        if (!order.shop_order_id) throw new Error('No shop order found');

        const { error } = await supabase
          .from('shop_orders')
          .update({ claim_status: 'REDEEMED' })
          .eq('transaction_id', order.transaction_id);

        if (error) throw error;

      } else if (newStatus === 'expired') {
        const { error: txErr } = await supabase
          .from('transactions')
          .update({ status: 'CANCELLED' })
          .eq('transaction_id', order.transaction_id);

        if (txErr) throw txErr;

        await supabase
          .from('shop_orders')
          .update({ claim_status: 'CANCELLED' })
          .eq('transaction_id', order.transaction_id);
      }

      toast.success(`Order marked as ${newStatus}`);
      loadOrder();
    } catch (error: any) {
      console.error('Error updating order status:', error);
      toast.error('Failed to update order status');
    } finally {
      setUpdating(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const copyGiftLink = () => {
    const giftUrl = getGiftPageUrl(order?.claim_code || '');
    copyToClipboard(giftUrl, 'Gift link');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 flex items-center justify-center">
        <div className="text-muted-foreground">Loading order details...</div>
      </div>
    );
  }

  if (!order) return null;

  const giftUrl = getGiftPageUrl(order.claim_code || '');
  const statusColor = STATUS_COLOR[order.derived_status] ?? 'bg-gray-100 text-gray-800 border-gray-200';
  const statusLabel = STATUS_LABEL[order.derived_status] ?? order.derived_status;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/90 text-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/admin/orders')}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-light">Order Details</h1>
              <p className="text-sm opacity-90 font-light font-mono">
                {order.claim_code ?? order.transaction_id.slice(0, 12)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Status Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="font-light">Order Status</CardTitle>
                  <Badge className={`font-light ${statusColor}`}>
                    {statusLabel}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Status Actions */}
                <div className="flex flex-wrap gap-2">
                  {order.derived_status === 'pending_payment' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button disabled={updating}>
                          <CheckCircle className="w-4 h-4" />
                          Mark as Paid
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Mark Order as Paid?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will confirm payment has been received and update the transaction status to SUCCESSFUL.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => updateOrderStatus('paid')}>
                            Confirm
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}

                  {order.derived_status === 'paid' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button disabled={updating}>
                          <Package className="w-4 h-4" />
                          Mark as Fulfilled
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Mark Order as Fulfilled?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will mark the gift as redeemed by the recipient.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => updateOrderStatus('fulfilled')}>
                            Confirm
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}

                  {(order.derived_status === 'pending_payment') && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={updating}>
                          <XCircle className="w-4 h-4" />
                          Mark as Expired
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Mark Order as Expired?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will cancel the transaction and all associated shop orders.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => updateOrderStatus('expired')}>
                            Expire Order
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>

                {/* Gift Link */}
                {order.claim_code && (
                  <div>
                    <label className="text-sm font-medium mb-2 block">Gift Page Link</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={giftUrl}
                        readOnly
                        className="flex-1 px-3 py-2 text-sm border rounded-md bg-gray-50"
                      />
                      <Button variant="outline" onClick={copyGiftLink}>
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => window.open(giftUrl, '_blank')}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Item Details */}
            {order.item_name && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-light">Item Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4">
                    {order.item_image_url && (
                      <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                        <img
                          src={order.item_image_url}
                          alt={order.item_name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex-1">
                      <h3 className="font-medium text-lg mb-1">{order.item_name}</h3>
                      {order.item_description && (
                        <p className="text-sm text-muted-foreground font-light mb-2">
                          {order.item_description}
                        </p>
                      )}
                      <p className="text-xl font-medium text-primary">
                        {formatCurrency(order.total_amount, 'ZMW')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Shop Details */}
            {order.shop_name && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-light">Shop Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div>
                    <label className="text-sm text-muted-foreground">Shop Name</label>
                    <p className="font-medium">{order.shop_name}</p>
                  </div>
                  {order.shop_location && (
                    <div>
                      <label className="text-sm text-muted-foreground">Location</label>
                      <p className="font-light">{order.shop_location}</p>
                    </div>
                  )}
                  {order.shop_address && (
                    <div>
                      <label className="text-sm text-muted-foreground">Address</label>
                      <p className="font-light">{order.shop_address}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Message */}
            {order.message && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-light">Gift Message</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-light italic">{order.message}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Sender Info */}
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Sender</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.buyer_name && (
                  <div>
                    <label className="text-sm text-muted-foreground">Name</label>
                    <p className="font-medium">{order.buyer_name}</p>
                  </div>
                )}
                {order.buyer_email && (
                  <div>
                    <label className="text-sm text-muted-foreground">Email</label>
                    <p className="font-light">{order.buyer_email}</p>
                  </div>
                )}
                {order.buyer_phone && (
                  <div>
                    <label className="text-sm text-muted-foreground">Phone</label>
                    <p className="font-light">{order.buyer_phone}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recipient Info */}
            {(order.recipient_name || order.recipient_phone) && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-light">Recipient</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {order.recipient_name && (
                    <div>
                      <label className="text-sm text-muted-foreground">Name</label>
                      <p className="font-medium">{order.recipient_name}</p>
                    </div>
                  )}
                  {order.recipient_phone && (
                    <div>
                      <label className="text-sm text-muted-foreground">Phone</label>
                      <p className="font-light">{order.recipient_phone}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Payment Info */}
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Payment Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.gateway_tx_ref && (
                  <div>
                    <label className="text-sm text-muted-foreground">Transaction Ref</label>
                    <p className="font-mono text-sm font-light break-all">{order.gateway_tx_ref}</p>
                  </div>
                )}
                <div>
                  <label className="text-sm text-muted-foreground">Origin</label>
                  <p className="font-light">{order.origin_type}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Total Amount</label>
                  <p className="font-semibold text-primary">{formatCurrency(order.total_amount, 'ZMW')}</p>
                </div>
              </CardContent>
            </Card>

            {/* Timestamps */}
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <label className="text-sm text-muted-foreground">Created</label>
                  <p className="font-light text-sm">
                    {new Date(order.created_at).toLocaleString()}
                  </p>
                </div>
                {order.derived_status === 'paid' && order.shop_order_updated_at && (
                  <div>
                    <label className="text-sm text-muted-foreground">Payment Confirmed</label>
                    <p className="font-light text-sm">
                      {new Date(order.shop_order_updated_at).toLocaleString()}
                    </p>
                  </div>
                )}
                {order.derived_status === 'fulfilled' && order.shop_order_updated_at && (
                  <div>
                    <label className="text-sm text-muted-foreground">Gift Collected</label>
                    <p className="font-light text-sm">
                      {new Date(order.shop_order_updated_at).toLocaleString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
