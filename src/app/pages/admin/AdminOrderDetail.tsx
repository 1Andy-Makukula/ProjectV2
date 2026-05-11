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
import { supabase } from '../../../utils/supabase/client';
import { formatCurrency } from '../../../utils/currency';
import { callServer } from '../../../utils/server';
import { getGiftPageUrl } from '../../../utils/whatsapp';
import { toast } from 'sonner';

interface OrderDetail {
  id: string;
  code: string;
  amount: number;
  status: string;
  message: string | null;
  recipient_name: string;
  recipient_phone: string;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  flutterwave_tx_ref: string | null;
  flutterwave_transaction_id: string | null;
  sender: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
  item: {
    id: string;
    name: string;
    description: string;
    price: number;
    image_url: string;
  };
  shop: {
    id: string;
    name: string;
    location: string;
    address: string;
  };
}

export function AdminOrderDetail() {
  const navigate = useNavigate();
  const { orderId } = useParams();
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

      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          sender:users!sender_id(id, name, email, phone),
          item:items(id, name, description, price, image_url),
          shop:shops(id, name, location, address)
        `)
        .eq('id', orderId)
        .single();

      if (error) throw error;

      setOrder(data as any);
    } catch (error: any) {
      console.error('Error loading order:', error);
      toast.error('Failed to load order details');
      navigate('/admin/orders');
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (newStatus: string) => {
    if (!order) return;

    setUpdating(true);
    try {
      if (newStatus === 'paid') {
        await callServer(`/orders/${order.id}/confirm-payment`);
      } else {
        const updates: any = { status: newStatus };

        if (newStatus === 'fulfilled' && !order.fulfilled_at) {
          updates.fulfilled_at = new Date().toISOString();
        }

        if (newStatus === 'expired') {
          updates.fulfilled_at = null;
        }

        const { error } = await supabase
          .from('orders')
          .update(updates)
          .eq('id', order.id);

        if (error) throw error;
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
    const giftUrl = getGiftPageUrl(order?.code || '');
    copyToClipboard(giftUrl, 'Gift link');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'fulfilled':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'paid':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'payment_submitted':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'pending_payment':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'expired':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 flex items-center justify-center">
        <div className="text-muted-foreground">Loading order details...</div>
      </div>
    );
  }

  if (!order) {
    return null;
  }

  const giftUrl = getGiftPageUrl(order.code);

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
              <p className="text-sm opacity-90 font-light font-mono">{order.code}</p>
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
                  <Badge className={`font-light ${getStatusColor(order.status)}`}>
                    {getStatusLabel(order.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Status Actions */}
                <div className="flex flex-wrap gap-2">
                  {order.status === 'payment_submitted' && (
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
                            This will confirm payment has been received and update the order status.
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

                  {order.status === 'paid' && (
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
                            This will mark the gift as picked up by the recipient.
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

                  {(order.status === 'pending_payment' || order.status === 'payment_submitted') && (
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
                            This will expire the order and prevent further actions.
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
              </CardContent>
            </Card>

            {/* Item Details */}
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Item Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4">
                  {order.item.image_url && (
                    <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                      <img
                        src={order.item.image_url}
                        alt={order.item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="font-medium text-lg mb-1">{order.item.name}</h3>
                    {order.item.description && (
                      <p className="text-sm text-muted-foreground font-light mb-2">
                        {order.item.description}
                      </p>
                    )}
                    <p className="text-xl font-medium text-primary">
                      {formatCurrency(order.amount)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Shop Details */}
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Shop Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <label className="text-sm text-muted-foreground">Shop Name</label>
                  <p className="font-medium">{order.shop.name}</p>
                </div>
                {order.shop.location && (
                  <div>
                    <label className="text-sm text-muted-foreground">Location</label>
                    <p className="font-light">{order.shop.location}</p>
                  </div>
                )}
                {order.shop.address && (
                  <div>
                    <label className="text-sm text-muted-foreground">Address</label>
                    <p className="font-light">{order.shop.address}</p>
                  </div>
                )}
              </CardContent>
            </Card>

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
                <div>
                  <label className="text-sm text-muted-foreground">Name</label>
                  <p className="font-medium">{order.sender.name}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Email</label>
                  <p className="font-light">{order.sender.email}</p>
                </div>
                {order.sender.phone && (
                  <div>
                    <label className="text-sm text-muted-foreground">Phone</label>
                    <p className="font-light">{order.sender.phone}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recipient Info */}
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Recipient</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <label className="text-sm text-muted-foreground">Name</label>
                  <p className="font-medium">{order.recipient_name}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Phone</label>
                  <p className="font-light">{order.recipient_phone}</p>
                </div>
              </CardContent>
            </Card>

            {/* Payment Info */}
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Payment Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.flutterwave_tx_ref && (
                  <div>
                    <label className="text-sm text-muted-foreground">Transaction Ref</label>
                    <p className="font-mono text-sm font-light">{order.flutterwave_tx_ref}</p>
                  </div>
                )}
                {order.flutterwave_transaction_id && (
                  <div>
                    <label className="text-sm text-muted-foreground">Transaction ID</label>
                    <p className="font-mono text-sm font-light">{order.flutterwave_transaction_id}</p>
                  </div>
                )}
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
                {order.paid_at && (
                  <div>
                    <label className="text-sm text-muted-foreground">Paid</label>
                    <p className="font-light text-sm">
                      {new Date(order.paid_at).toLocaleString()}
                    </p>
                  </div>
                )}
                {order.fulfilled_at && (
                  <div>
                    <label className="text-sm text-muted-foreground">Fulfilled</label>
                    <p className="font-light text-sm">
                      {new Date(order.fulfilled_at).toLocaleString()}
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
