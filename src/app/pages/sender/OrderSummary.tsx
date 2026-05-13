import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { ArrowLeft, Store, Shield, Edit } from 'lucide-react';
import { motion } from 'motion/react';
import { formatCurrency } from '../../../utils/currency';
import { generateUniqueOrderCode } from '../../../utils/codeGenerator';
import { callServer } from '../../../utils/server';
import { toast } from 'sonner';

interface Item {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  image_url: string | null;
  shop_id: string;
}

interface Shop {
  id: string;
  name: string;
}

interface SendFlowData {
  item: Item;
  shop: Shop;
  recipientName: string;
  recipientPhone: string;
  message: string;
}

interface PaymentInitializationResponse {
  success: boolean;
  paymentLink: string;
}

export function OrderSummary() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [sendData, setSendData] = useState<SendFlowData | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // Retrieve send flow data from sessionStorage
    const storedData = sessionStorage.getItem('sendFlowData');
    if (!storedData) {
      // If no data found, redirect back to home
      navigate('/home');
      return;
    }

    try {
      const data = JSON.parse(storedData);
      setSendData(data);
    } catch (error) {
      console.error('Error parsing send flow data:', error);
      navigate('/home');
    }
  }, [navigate]);

  const handleEdit = () => {
    if (!sendData) return;
    navigate(`/send/${sendData.item.id}`);
  };

  const handlePayNow = async () => {
    if (!sendData || !user) return;

    setCreating(true);

    try {
      const txRef = `KITHLY-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;

      // Generate unique order code
      const checkCodeExists = async (code: string): Promise<boolean> => {
        const { data } = await supabase
          .from('orders')
          .select('code')
          .eq('code', code)
          .single();
        return !!data;
      };

      const orderCode = await generateUniqueOrderCode(checkCodeExists);

      // Create order with pending_payment status
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          sender_id: user.id,
          item_id: sendData.item.id,
          shop_id: sendData.item.shop_id,
          recipient_name: sendData.recipientName,
          recipient_phone: sendData.recipientPhone,
          message: sendData.message || null,
          amount: sendData.item.price,
          currency: sendData.item.currency,
          code: orderCode,
          status: 'pending_payment',
          flutterwave_tx_ref: txRef,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      sessionStorage.removeItem('sendFlowData');

      const paymentResponse = await callServer<PaymentInitializationResponse>(
        '/payment/initialize',
        {
          body: {
            action: 'initialize_payment',
            orderId: order.id,
            amount: sendData.item.price,
            currency: sendData.item.currency,
            email: profile?.email || user.email,
            name: profile?.name || user.user_metadata?.name || 'KithLy Customer',
            phone: profile?.phone || sendData.recipientPhone,
            txRef,
          },
        },
      );

      if (!paymentResponse.paymentLink) {
        throw new Error('Payment link was not returned');
      }

      // Opens in a new tab, keeping your app open in the background
      window.open(paymentResponse.paymentLink, '_blank');
    } catch (error: any) {
      console.error('Error creating order:', error);
      toast.error(error.message || 'Failed to start payment. Please try again.');
      navigate('/orders', {
        state: {
          message:
            'Your order may have been created, but payment could not be started. Please check your orders.',
        },
      });
    } finally {
      setCreating(false);
    }
  };

  if (!sendData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const { item, shop, recipientName, recipientPhone, message } = sendData;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleEdit}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-semibold">Order Summary</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Item Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardContent className="p-4">
              <div className="flex gap-4">
                {/* Item Image */}
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Store className="w-8 h-8 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Item Details */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg mb-1">{item.name}</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    from {shop.name}
                  </p>
                  <p className="text-lg font-bold text-primary">
                    {formatCurrency(item.price, item.currency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recipient Details */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recipient Details</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleEdit}
                  className="text-primary"
                >
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Name</p>
                <p className="font-medium">{recipientName}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Phone</p>
                <p className="font-medium">{recipientPhone}</p>
              </div>
              {message && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Message</p>
                  <div className="bg-orange-50 border-l-4 border-primary p-3 rounded-r-lg">
                    <p className="text-sm italic">"{message}"</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* KithLy Escrow Protection Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Alert className="border-blue-200 bg-blue-50">
            <Shield className="w-5 h-5 text-blue-600" />
            <AlertTitle className="text-blue-900">
              Protected by KithLy Escrow
            </AlertTitle>
            <AlertDescription className="text-blue-800">
              Your payment is held securely until the gift is collected. If
              there's any issue, we'll help resolve it or provide a full refund.
              Send with confidence!
            </AlertDescription>
          </Alert>
        </motion.div>

        {/* Order Total */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Total Amount</p>
                  <p className="text-2xl font-bold text-primary">
                    {formatCurrency(item.price, item.currency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
        >
          <Button
            onClick={handlePayNow}
            disabled={creating}
            className="w-full h-12 text-base font-medium bg-gradient-to-r from-primary to-primary-light"
          >
            {creating ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                Starting Payment...
              </div>
            ) : (
              'Pay Now'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleEdit}
            disabled={creating}
            className="w-full h-12 text-base font-medium"
          >
            Edit Details
          </Button>
        </motion.div>

        {/* Footer Note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center"
        >
          <p className="text-xs text-muted-foreground">
            By proceeding, you agree to KithLy's terms of service
          </p>
        </motion.div>
      </div>
    </div>
  );
}
