import { useNavigate, useParams } from 'react-router';
import { Copy, CheckCircle, XCircle, Package, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
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
import { formatCurrency } from '../../../utils/currency';
import { getGiftPageUrl } from '../../../utils/whatsapp';
import { toast } from 'sonner';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { useAdminOrderDetail } from '../../hooks/useAdminOrderDetail';
import { STATUS_COLORS, STATUS_LABELS } from '../../../utils/orderStatus';

export function AdminOrderDetail() {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();

  const {
    order,
    loading,
    updating,
    updateOrderStatus,
  } = useAdminOrderDetail(orderId);

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
      <PageShell>
        <AdminPageHeader
          title="Order Details"
          subtitle="Loading..."
          onBack={() => navigate('/admin/orders')}
        />
        <PageBody contained>
          <div className="text-center py-12 text-sm text-muted-foreground">
            Loading order details...
          </div>
        </PageBody>
      </PageShell>
    );
  }

  if (!order) return null;

  const giftUrl = getGiftPageUrl(order.claim_code || '');
  const statusColor = STATUS_COLORS[order.derived_status] ?? 'bg-gray-100 text-gray-800 border-gray-200';
  const statusLabel = STATUS_LABELS[order.derived_status] ?? order.derived_status;

  return (
    <PageShell>
      <AdminPageHeader
        title="Order Details"
        subtitle={order.claim_code ?? order.transaction_id.slice(0, 12)}
        onBack={() => navigate('/admin/orders')}
      />

      <PageBody contained>
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

                  {order.derived_status === 'pending_payment' && (
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
      </PageBody>
    </PageShell>
  );
}
