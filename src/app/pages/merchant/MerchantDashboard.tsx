import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { formatCurrency } from '../../../utils/currency';
import { QrCode, LogOut, Package, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  amount: number;
  paid_at: string | null;
  fulfilled_at: string | null;
  item: {
    name: string;
  };
}

interface Analytics {
  totalFulfilled: number;
  totalValue: number;
  weekFulfilled: number;
  weekValue: number;
}

export function MerchantDashboard() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [shopName, setShopName] = useState('');
  const [shopId, setShopId] = useState<string | null>(null);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [fulfilledOrders, setFulfilledOrders] = useState<Order[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    totalFulfilled: 0,
    totalValue: 0,
    weekFulfilled: 0,
    weekValue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMerchantData();
  }, [profile?.id]);

  useEffect(() => {
    if (shopId) {
      const subscription = supabase
        .channel(`shop:${shopId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'orders',
            filter: `shop_id=eq.${shopId}`,
          },
          () => {
            fetchOrders(shopId);
            fetchAnalytics(shopId);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `shop_id=eq.${shopId}`,
          },
          () => {
            fetchOrders(shopId);
            fetchAnalytics(shopId);
          }
        )
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [shopId]);

  const fetchMerchantData = async () => {
    if (!profile?.id) return;

    try {
      // Get merchant's shop
      const { data: merchantShop, error: shopError } = await supabase
        .from('merchant_shops')
        .select('shop_id, shop:shops(name)')
        .eq('user_id', profile.id)
        .single();

      if (shopError) throw shopError;

      const currentShopId = merchantShop.shop_id;
      setShopId(currentShopId);
      setShopName((merchantShop.shop as any)?.name || 'Your Shop');

      await fetchOrders(currentShopId);
      await fetchAnalytics(currentShopId);
    } catch (error) {
      console.error('Error fetching merchant data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async (currentShopId: string) => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, code, recipient_name, amount, paid_at, fulfilled_at, status, item:items(name)')
        .eq('shop_id', currentShopId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const active = (data || []).filter((o) => o.status === 'paid');
      const fulfilled = (data || []).filter((o) => o.status === 'fulfilled');

      setActiveOrders(active as unknown as Order[]);
      setFulfilledOrders(fulfilled as unknown as Order[]);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const fetchAnalytics = async (currentShopId: string) => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('amount, fulfilled_at, status')
        .eq('shop_id', currentShopId)
        .eq('status', 'fulfilled');

      if (error) throw error;

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const totalFulfilled = data?.length || 0;
      const totalValue = data?.reduce((sum, o) => sum + o.amount, 0) || 0;

      const weekOrders = data?.filter(
        (o) => o.fulfilled_at && new Date(o.fulfilled_at) >= oneWeekAgo
      );
      const weekFulfilled = weekOrders?.length || 0;
      const weekValue = weekOrders?.reduce((sum, o) => sum + o.amount, 0) || 0;

      setAnalytics({
        totalFulfilled,
        totalValue,
        weekFulfilled,
        weekValue,
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  const handleFulfillOrder = async (orderId: string) => {
    navigate('/merchant/fulfill');
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/');
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
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{shopName}</h1>
            <p className="text-sm text-muted-foreground">Merchant Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate('/merchant/fulfill')}
              className="bg-gradient-to-r from-primary to-primary-light"
            >
              <QrCode className="w-4 h-4 mr-2" />
              Redeem Gift
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Analytics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            {
              label: 'Total Fulfilled',
              value: analytics.totalFulfilled,
              icon: Package,
              isCurrency: false,
            },
            {
              label: 'Total Value',
              value: analytics.totalValue,
              icon: TrendingUp,
              isCurrency: true,
            },
            {
              label: 'This Week',
              value: analytics.weekFulfilled,
              icon: Package,
              isCurrency: false,
            },
            {
              label: 'Week Value',
              value: analytics.weekValue,
              icon: TrendingUp,
              isCurrency: true,
            },
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white p-6 rounded-xl shadow-sm"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                  <stat.icon className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-2xl font-bold">
                <AnimatedMetric value={stat.value} isCurrency={stat.isCurrency} />
              </p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Orders Tabs */}
        <Tabs defaultValue="active" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="active">Active Orders</TabsTrigger>
            <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-4">
            {activeOrders.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border">
                <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No Active Orders</h3>
                <p className="text-muted-foreground">
                  New paid orders will appear here automatically
                </p>
              </div>
            ) : (
              activeOrders.map((order) => (
                <div key={order.id} className="bg-white p-6 rounded-xl shadow-sm border">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">{order.item?.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        For: {order.recipient_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">{order.code}</p>
                      <p className="text-xs text-muted-foreground">Order Code</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {order.paid_at &&
                        `Paid ${new Date(order.paid_at).toLocaleDateString()}`}
                    </p>
                    <Button
                      onClick={() => handleFulfillOrder(order.id)}
                      size="sm"
                      className="bg-gradient-to-r from-primary to-primary-light"
                    >
                      Fulfill This Order
                    </Button>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="fulfilled" className="space-y-4">
            {fulfilledOrders.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border">
                <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No fulfilled orders yet</p>
              </div>
            ) : (
              fulfilledOrders.map((order) => (
                <div key={order.id} className="bg-white p-6 rounded-xl shadow-sm border">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium">{order.item?.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {order.recipient_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(order.amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.fulfilled_at &&
                          new Date(order.fulfilled_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function AnimatedMetric({
  value,
  isCurrency,
}: {
  value: number;
  isCurrency: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let frameId = 0;
    const duration = 900;
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * easedProgress));

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    setDisplayValue(0);
    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return isCurrency ? formatCurrency(displayValue) : displayValue.toLocaleString();
}
