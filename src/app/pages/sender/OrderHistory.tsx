import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { formatCurrency } from '../../../utils/currency';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Package, Store, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  item: {
    name: string;
    image_url: string | null;
  };
  shop: {
    name: string;
  };
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  pending_payment: {
    label: 'Pending Payment',
    variant: 'outline',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  },
  payment_submitted: {
    label: 'Payment Submitted',
    variant: 'outline',
    className: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  paid: {
    label: 'Paid',
    variant: 'outline',
    className: 'bg-blue-100 text-blue-800 border-blue-300',
  },
  fulfilled: {
    label: 'Fulfilled',
    variant: 'outline',
    className: 'bg-green-100 text-green-800 border-green-300',
  },
  expired: {
    label: 'Expired',
    variant: 'outline',
    className: 'bg-gray-100 text-gray-800 border-gray-300',
  },
};

export function OrderHistory() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
  }, [profile]);

  const fetchOrders = async () => {
    if (!profile?.id) return;

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
          item:item_id (name, image_url),
          shop:shop_id (name)
        `)
        .eq('sender_id', profile.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders((data as unknown as Order[]) || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInHours = diffInMs / (1000 * 60 * 60);
    const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

    if (diffInHours < 24) {
      if (diffInHours < 1) {
        return 'Just now';
      }
      return `${Math.floor(diffInHours)}h ago`;
    } else if (diffInDays < 7) {
      return `${Math.floor(diffInDays)}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4 mb-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/home')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
              My Orders
            </h1>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {orders.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16 bg-white rounded-2xl border"
          >
            <Package className="w-20 h-20 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-xl font-semibold mb-2">No Orders Yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              You haven't sent any gifts yet. Browse our shops and send your first gift!
            </p>
            <Button
              onClick={() => navigate('/home')}
              className="bg-gradient-to-r from-primary to-primary-light"
            >
              <Store className="w-4 h-4 mr-2" />
              Browse Shops
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {orders.map((order, index) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(`/orders/${order.id}`)}
                className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer border hover:border-primary/30"
              >
                <div className="flex gap-4">
                  {/* Item Image */}
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    {order.item?.image_url ? (
                      <img
                        src={order.item.image_url}
                        alt={order.item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                  </div>

                  {/* Order Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">
                          {order.item?.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {order.shop?.name}
                        </p>
                      </div>
                      <Badge
                        className={statusConfig[order.status]?.className || ''}
                      >
                        {statusConfig[order.status]?.label || order.status}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          For: <span className="font-medium text-foreground">{order.recipient_name}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(order.created_at)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">
                          {formatCurrency(order.amount, order.currency)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
