import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase } from '../../../utils/supabase/client';
import { formatCurrency } from '../../../utils/currency';
import { callServer } from '../../../utils/server';
import { useAuth } from '../../../utils/auth/AuthContext';
import { createWhatsAppShareLink, getGiftPageUrl } from '../../../utils/whatsapp';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { ArrowLeft, Copy, Share2, Package, MapPin, Calendar, User, MessageSquare, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  recipient_phone: string | null;
  message: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  flutterwave_tx_ref: string | null;
  sender: {
    name: string;
  };
  item: {
    name: string;
    description: string | null;
    image_url: string | null;
  };
  shop: {
    name: string;
    address: string | null;
    location: string | null;
  };
}

const statusConfig: Record<string, { label: string; className: string }> = {
  pending_payment: {
    label: 'Pending Payment',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  },
  payment_submitted: {
    label: 'Payment Submitted',
    className: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  paid: {
    label: 'Paid',
    className: 'bg-blue-100 text-blue-800 border-blue-300',
  },
  fulfilled: {
    label: 'Fulfilled',
    className: 'bg-green-100 text-green-800 border-green-300',
  },
  expired: {
    label: 'Expired',
    className: 'bg-gray-100 text-gray-800 border-gray-300',
  },
};

export function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [retryingPayment, setRetryingPayment] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    fetchOrder();
  }, [orderId]);

  const fetchOrder = async () => {
    if (!orderId) return;

    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          code,
          recipient_name,
          recipient_phone,
          message,
          amount,
          currency,
          status,
          created_at,
          paid_at,
          fulfilled_at,
          flutterwave_tx_ref,
          sender:sender_id (name),
          item:item_id (name, description, image_url),
          shop:shop_id (name, address, location)
        `)
        .eq('id', orderId)
        .single();

      if (error) throw error;
      setOrder(data as unknown as Order);
    } catch (error) {
      console.error('Error fetching order:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!order) return;
    const giftUrl = getGiftPageUrl(order.code);
    await navigator.clipboard.writeText(giftUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsAppShare = () => {
    if (!order) return;
    const giftUrl = getGiftPageUrl(order.code);
    const whatsappUrl = createWhatsAppShareLink(
      order.recipient_name,
      order.sender?.name || 'Someone',
      order.shop?.name || 'KithLy',
      giftUrl
    );
    window.open(whatsappUrl, '_blank');
  };

  const handleResumePayment = async () => {
    if (!order || !order.flutterwave_tx_ref) {
      toast.error('No payment reference was found for this order');
      return;
    }

    setRetryingPayment(true);

    try {
      const response = await callServer<{ paymentLink: string }>('/payment/initialize', {
        body: {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          email: profile?.email || user?.email || '',
          name: profile?.name || user?.user_metadata?.name || 'KithLy Customer',
          phone: profile?.phone || order.recipient_phone || '',
          txRef: order.flutterwave_tx_ref,
        },
      });

      if (!response.paymentLink) {
        throw new Error('Payment link was not returned');
      }

      window.location.assign(response.paymentLink);
    } catch (error: any) {
      console.error('Error resuming payment:', error);
      toast.error(error.message || 'Failed to resume payment');
    } finally {
      setRetryingPayment(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-medium mb-2">Order Not Found</h2>
          <p className="text-muted-foreground mb-6">
            This order doesn't exist or may have been removed.
          </p>
          <Button onClick={() => navigate('/orders')}>Back to Orders</Button>
        </div>
      </div>
    );
  }

  const giftUrl = getGiftPageUrl(order.code);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/orders')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-xl font-semibold">Order Details</h1>
              <p className="text-sm text-muted-foreground">Order #{order.code}</p>
            </div>
            <Badge className={statusConfig[order.status]?.className || ''}>
              {statusConfig[order.status]?.label || order.status}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Item Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-6">
                {order.item?.image_url && (
                  <div className="w-32 h-32 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    <img
                      src={order.item.image_url}
                      alt={order.item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <h2 className="text-2xl font-bold mb-2">{order.item?.name}</h2>
                  <p className="text-muted-foreground mb-3">
                    from {order.shop?.name}
                  </p>
                  {order.item?.description && (
                    <p className="text-sm text-muted-foreground">
                      {order.item.description}
                    </p>
                  )}
                  <p className="text-2xl font-bold text-primary mt-4">
                    {formatCurrency(order.amount, order.currency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Gift Code Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Gift Code</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-6 text-center border-2 border-primary/20 mb-4">
                <p className="text-sm text-muted-foreground mb-2">Share this code</p>
                <p className="text-3xl font-mono font-bold tracking-widest text-primary">
                  {order.code}
                </p>
              </div>
              <div className="text-sm text-muted-foreground mb-4">
                <p className="font-medium">Gift Page Link:</p>
                <p className="text-xs break-all bg-gray-50 p-2 rounded mt-1">{giftUrl}</p>
              </div>
              {order.status === 'pending_payment' && (
                <Button
                  onClick={handleResumePayment}
                  variant="outline"
                  className="w-full mb-4"
                  disabled={retryingPayment}
                >
                  {retryingPayment ? 'Opening Checkout...' : 'Resume Payment'}
                </Button>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={handleCopyLink}
                  variant="outline"
                  className="flex-1"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Link
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleWhatsAppShare}
                  className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share via WhatsApp
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recipient Details */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recipient Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{order.recipient_name}</p>
                </div>
              </div>
              {order.recipient_phone && (
                <div className="flex items-center gap-3">
                  <Package className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p className="font-medium">{order.recipient_phone}</p>
                  </div>
                </div>
              )}
              {order.message && (
                <div className="flex items-start gap-3">
                  <MessageSquare className="w-5 h-5 text-muted-foreground mt-1" />
                  <div>
                    <p className="text-sm text-muted-foreground">Your Message</p>
                    <p className="font-medium italic">"{order.message}"</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Shop Details */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Shop Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Shop Name</p>
                  <p className="font-medium">{order.shop?.name}</p>
                </div>
              </div>
              {(order.shop?.address || order.shop?.location) && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-muted-foreground mt-1" />
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">
                      {order.shop?.address || order.shop?.location}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Order Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Order Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-muted-foreground mt-1" />
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{formatDate(order.created_at)}</p>
                </div>
              </div>
              {order.paid_at && (
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-muted-foreground mt-1" />
                  <div>
                    <p className="text-sm text-muted-foreground">Paid</p>
                    <p className="font-medium">{formatDate(order.paid_at)}</p>
                  </div>
                </div>
              )}
              {order.fulfilled_at && (
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-muted-foreground mt-1" />
                  <div>
                    <p className="text-sm text-muted-foreground">Fulfilled</p>
                    <p className="font-medium">{formatDate(order.fulfilled_at)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
