import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router';
import { supabase } from '../../../utils/supabase/client';
import { motion } from 'motion/react';
import { Gift as GiftIcon, MapPin } from 'lucide-react';
import QRCode from 'qrcode';

interface Order {
  id: string;
  recipient_name: string;
  message: string | null;
  code: string;
  status: string;
  amount: number;
  currency: string;
  sender: {
    name: string;
  };
  item: {
    name: string;
    image_url: string | null;
  };
  shop: {
    name: string;
    address: string;
  };
}

export function GiftPage() {
  const { code } = useParams<{ code: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    if (!code) return;

    fetchOrder();

    // Set up real-time subscription
    const subscription = supabase
      .channel(`order:${code}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `code=eq.${code}`,
        },
        () => {
          fetchOrder();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [code]);

  const fetchOrder = async () => {
    if (!code) return;

    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          recipient_name,
          message,
          code,
          status,
          amount,
          currency,
          sender:sender_id (name),
          item:item_id (name, image_url),
          shop:shop_id (name, address)
        `)
        .eq('code', code.toUpperCase())
        .single();

      if (error) throw error;

      setOrder(data as unknown as Order);
    } catch (error) {
      console.error('Error fetching order:', error);
    } finally {
      setLoading(false);
    }
  };

  // Generate QR code when order is paid
  useEffect(() => {
    if (order && order.status === 'paid' && order.code) {
      QRCode.toDataURL(order.code, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      })
        .then((url) => {
          setQrDataUrl(url);
        })
        .catch((err) => {
          console.error('Error generating QR code:', err);
        });
    } else {
      setQrDataUrl('');
    }
  }, [order]);

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
          <h2 className="text-2xl font-medium mb-2">Gift Not Found</h2>
          <p className="text-muted-foreground">
            This gift code doesn't exist or may have expired.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-pink-50 flex items-center justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-2xl w-full bg-white rounded-3xl shadow-xl overflow-hidden"
      >
        {/* Celebratory Header */}
        <div className="bg-gradient-to-r from-primary to-primary-light p-8 text-white text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
          >
            <GiftIcon className="w-20 h-20 mx-auto mb-4" />
          </motion.div>
          <h1 className="text-3xl font-bold mb-2">You have received a gift!</h1>
          <p className="text-white/90 text-lg">From {order.sender?.name}</p>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          {/* Personal Message */}
          {order.message && (
            <div className="bg-orange-50 border-l-4 border-primary p-4 rounded-r-lg">
              <p className="text-sm text-muted-foreground mb-1">Message for you:</p>
              <p className="text-foreground italic">"{order.message}"</p>
            </div>
          )}

          {/* Item Details */}
          <div className="text-center">
            {order.item?.image_url && (
              <div className="mb-6 rounded-2xl overflow-hidden max-w-md mx-auto shadow-md">
                <img
                  src={order.item.image_url}
                  alt={order.item.name}
                  className="w-full h-64 object-cover"
                />
              </div>
            )}
            <h2 className="text-2xl font-semibold mb-2">{order.item?.name}</h2>
            <p className="text-lg text-muted-foreground">from {order.shop?.name}</p>
          </div>

          {/* Status-based Display */}
          {(order.status === 'pending_payment' || order.status === 'payment_submitted') && (
            <div className="text-center py-8">
              <div className="inline-block animate-pulse mb-4">
                <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-primary"></div>
                </div>
              </div>
              <h3 className="text-xl font-medium mb-2">Gift is being confirmed</h3>
              <p className="text-muted-foreground">
                Check back soon! Your gift will be ready for collection shortly.
              </p>
            </div>
          )}

          {order.status === 'paid' && qrDataUrl && (
            <div className="text-center space-y-6">
              {/* QR Code */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 100 }}
                className="inline-block p-6 bg-white border-4 border-primary rounded-2xl shadow-lg"
              >
                <img src={qrDataUrl} alt="QR Code" className="w-64 h-64" />
              </motion.div>

              {/* Code Display */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Your Code</p>
                <p className="text-4xl font-bold tracking-wider text-primary">
                  {order.code}
                </p>
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-left space-y-3">
                <h4 className="font-medium text-foreground flex items-start gap-2">
                  <MapPin className="w-5 h-5 text-primary mt-0.5" />
                  How to collect your gift
                </h4>
                <ol className="text-sm text-muted-foreground space-y-2 ml-7 list-decimal">
                  <li>Visit <strong>{order.shop?.name}</strong></li>
                  <li>Show this screen or the QR code above</li>
                  <li>Collect your gift!</li>
                </ol>
                <p className="text-sm text-muted-foreground mt-4">
                  <strong>Address:</strong> {order.shop?.address}
                </p>
              </div>
            </div>
          )}

          {order.status === 'fulfilled' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-10 h-10 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-medium mb-2">Gift Collected!</h3>
              <p className="text-muted-foreground">
                You have successfully collected this gift. Hope you enjoyed it!
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-8 py-4 text-center border-t">
          <p className="text-sm text-muted-foreground">
            Powered by <span className="text-primary font-medium">KithLy</span>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
