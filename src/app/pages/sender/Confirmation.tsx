import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { supabase } from '../../../lib/supabaseClient';
import { formatCurrency } from '../../../utils/currency';
import { createWhatsAppShareLink, getGiftPageUrl } from '../../../utils/whatsapp';
import { QRCodeDisplay } from '../../components/shared/QRCodeDisplay';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Gift, Share2, Copy, ArrowRight, Check, Download } from 'lucide-react';
import { motion } from 'motion/react';
// @ts-expect-error - canvas-confetti lacks local types until pnpm install runs
import confetti from 'canvas-confetti';

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  flutterwave_tx_ref: string | null;
  flutterwave_transaction_id: string | null;
  sender: {
    name: string;
  };
  item: {
    name: string;
    image_url: string | null;
  };
  shop: {
    name: string;
  };
}

export function Confirmation() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const confettiTriggered = useRef(false);
  const fulfilledConfettiTriggered = useRef(false);

  useEffect(() => {
    if (!orderId) return;
    fetchOrder();

    const channel = supabase
      .channel(`order-confirmation-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`,
        },
        (payload: any) => {
          setOrder((prev) => {
            if (!prev) return prev;
            if (prev.status !== 'fulfilled' && payload.new.status === 'fulfilled') {
              if (!fulfilledConfettiTriggered.current) {
                fulfilledConfettiTriggered.current = true;
                triggerConfetti();
              }
            }
            return { ...prev, ...payload.new } as any;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  useEffect(() => {
    if (order && !confettiTriggered.current) {
      confettiTriggered.current = true;
      triggerConfetti();
    }
  }, [order]);

  const fetchOrder = async () => {
    if (!orderId) return;

    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          code,
          recipient_name,
          amount,
          currency,
          status,
          created_at,
          flutterwave_tx_ref,
          flutterwave_transaction_id,
          sender:sender_id (name),
          item:item_id (name, image_url),
          shop:shop_id (name)
        `)
        .eq('id', orderId)
        .single();

      if (error) throw error;
      
      const orderData = data as unknown as Order;
      
      if (orderData.status === 'pending_payment' && (searchParams.get('status') === 'successful' || searchParams.get('status') === 'completed')) {
        await supabase.functions.invoke('server', {
          body: { action: 'verify_payment', txRef: orderData.flutterwave_tx_ref }
        });
        
        const { data: newData, error: newError } = await supabase
          .from('orders')
          .select(`
            id,
            code,
            recipient_name,
            amount,
            currency,
            status,
            created_at,
            flutterwave_tx_ref,
            flutterwave_transaction_id,
            sender:sender_id (name),
            item:item_id (name, image_url),
            shop:shop_id (name)
          `)
          .eq('id', orderId)
          .single();
          
        if (!newError) {
          setOrder(newData as unknown as Order);
          return;
        }
      }

      setOrder(orderData);
    } catch (error) {
      console.error('Error fetching order:', error);
    } finally {
      setLoading(false);
    }
  };

  const triggerConfetti = () => {
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = {
      startVelocity: 30,
      spread: 360,
      ticks: 60,
      zIndex: 0,
      colors: ['#22c55e', '#16a34a', '#FFD700', '#FFA500'],
    };

    const interval: any = setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);

      confetti({
        ...defaults,
        particleCount,
        origin: { x: Math.random(), y: Math.random() - 0.2 },
      });
    }, 250);
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

  const handleDownloadReceipt = () => {
    if (!order) return;

    // @ts-expect-error - jspdf types missing until pnpm install
    import('jspdf').then(({ jsPDF }) => {
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(24);
      doc.setTextColor(249, 115, 22); // KithLy Orange
      doc.text('KithLy', 20, 30);
      
      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text('Official Gift Receipt', 20, 40);
      
      // Order Details
      doc.setTextColor(0);
      doc.text(`Date: ${new Date(order.created_at).toLocaleDateString()}`, 20, 60);
      doc.text(`Recipient: ${order.recipient_name}`, 20, 70);
      doc.text(`Merchant: ${order.shop?.name || 'KithLy Merchant'}`, 20, 80);
      
      // Item
      doc.setFontSize(14);
      doc.text('Item Details', 20, 100);
      doc.setFontSize(12);
      doc.text(`Item: ${order.item?.name || 'Gift'}`, 20, 110);
      doc.text(`Amount: ${formatCurrency(order.amount, order.currency)}`, 20, 120);
      
      // Proof of Payment
      doc.setFontSize(14);
      doc.text('Proof of Payment', 20, 140);
      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text(`Transaction Ref: ${order.flutterwave_tx_ref || 'N/A'}`, 20, 150);
      doc.text(`Flutterwave ID: ${order.flutterwave_transaction_id || 'N/A'}`, 20, 160);
      
      // Footer Escrow Terms
      doc.setFontSize(10);
      doc.setTextColor(150);
      doc.text('Payment is securely held in escrow until the recipient collects the gift.', 105, 280, { align: 'center' });
      
      doc.save(`KithLy_Receipt_${order.code}.pdf`);
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
          <Button onClick={() => navigate('/home')}>Back to Home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        {/* Success Icon with fade-in animation */}
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1, duration: 0.5, type: 'spring' }}
          className="text-center mb-8"
        >
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-lg">
            <Gift className="w-12 h-12 text-white" />
          </div>
        </motion.div>

        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3 }}
          className="text-center mb-8"
        >
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-primary to-amber-600 bg-clip-text text-transparent">
            Gift sent successfully!
          </h1>
          <p className="text-xl text-muted-foreground">
            {order.recipient_name} will love this
          </p>
        </motion.div>

        {/* Summary Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5 }}
        >
          <Card className="mb-6 overflow-hidden shadow-xl border-2">
            <CardContent className="p-6">
              <div className="flex gap-4 items-start mb-6">
                {order.item?.image_url && (
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    <img
                      src={order.item.image_url}
                      alt={order.item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">{order.item?.name}</h3>
                  <p className="text-sm text-muted-foreground mb-1">
                    from {order.shop?.name}
                  </p>
                  <p className="text-lg font-bold text-primary">
                    {formatCurrency(order.amount, order.currency)}
                  </p>
                </div>
              </div>

              {/* Code Display */}
              {order.status === 'fulfilled' ? (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-green-50 rounded-xl p-6 text-center border-2 border-green-200"
                >
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-green-800 mb-2">Gift Collected!</h3>
                  <p className="text-green-600">
                    {order.recipient_name} has successfully received this gift.
                  </p>
                </motion.div>
              ) : (
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-6 text-center border-2 border-primary/20">
                  <p className="text-sm text-muted-foreground mb-2">Gift Code</p>
                  <div className="flex justify-center mb-4">
                    <QRCodeDisplay value={order.code} size={150} />
                  </div>
                  <p className="text-4xl font-mono font-bold tracking-widest text-primary">
                    {order.code}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Share this code with {order.recipient_name}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.7 }}
          className="space-y-3 mb-6"
        >
          <Button
            onClick={handleWhatsAppShare}
            className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white py-6 text-lg"
            size="lg"
          >
            <Share2 className="w-5 h-5 mr-2" />
            Share via WhatsApp
          </Button>

          <Button
            onClick={handleCopyLink}
            variant="outline"
            className="w-full py-6 text-lg"
            size="lg"
          >
            {copied ? (
              <>
                <Check className="w-5 h-5 mr-2" />
                Link Copied!
              </>
            ) : (
              <>
                <Copy className="w-5 h-5 mr-2" />
                Copy Gift Link
              </>
            )}
          </Button>

          {(order.status === 'paid' || order.status === 'fulfilled') && (
            <Button
              onClick={handleDownloadReceipt}
              variant="outline"
              className="w-full py-6 text-lg border-[#F97316] text-[#F97316] hover:bg-orange-50 transition-colors"
              size="lg"
            >
              <Download className="w-5 h-5 mr-2" />
              Download Official Receipt
            </Button>
          )}
        </motion.div>

        {/* View Orders Link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.9 }}
          className="text-center"
        >
          <Button
            variant="link"
            onClick={() => navigate('/orders')}
            className="text-primary hover:text-primary/80"
          >
            View My Orders
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
