import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { formatCurrency } from '../../../utils/currency';
import { QrCode, LogOut, Package, TrendingUp, Camera, Save, Edit, Trash2, HelpCircle, PackagePlus, Store, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { AdminItems } from '../admin/AdminItems';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet';
import { cn } from '../../components/ui/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderItem {
  item: {
    name: string;
    image_url: string | null;
  } | null;
}

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  recipient_phone?: string | null;
  message?: string | null;
  amount: number;
  paid_at: string | null;
  fulfilled_at: string | null;
  claim_status: string;
  order_items?: OrderItem[];
  item: {
    name: string;
    image_url: string | null;
  } | null;
}

interface Analytics {
  totalFulfilled: number;
  totalValue: number;
  weekFulfilled: number;
  weekValue: number;
  availableBalance: number;
}

// Helper to aggregate duplicate items and compute their total quantities
function aggregateOrderItems(orderItems?: OrderItem[]) {
  if (!orderItems) return [];
  const map = new Map<string, { name: string; image_url: string | null; quantity: number }>();
  for (const oi of orderItems) {
    if (!oi?.item) continue;
    const name = oi.item.name;
    const existing = map.get(name);
    if (existing) {
      existing.quantity += 1;
    } else {
      map.set(name, {
        name,
        image_url: oi.item.image_url ?? null,
        quantity: 1,
      });
    }
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MerchantDashboard() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  // Existing state
  const [shopName, setShopName] = useState('');
  const [shopId, setShopId] = useState<string | null>(null);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [fulfilledOrders, setFulfilledOrders] = useState<Order[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    totalFulfilled: 0,
    totalValue: 0,
    weekFulfilled: 0,
    weekValue: 0,
    availableBalance: 0,
  });
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);

  // Sheet drawer state
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

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
            table: 'shop_orders',
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
            table: 'shop_orders',
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
      const { data: merchantShop, error: shopError } = await supabase
        .from('merchant_shops')
        .select('shop_id, shop:shops(id, name, location, image_url, payout_details, payout_method)')
        .eq('user_id', profile.id)
        .single();

      if (shopError) throw shopError;

      const shop = merchantShop.shop as any;
      const currentShopId = merchantShop.shop_id;

      setShopId(currentShopId);
      setShopName(shop?.name ?? 'Your Shop');

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
        .from('shop_orders')
        .select('*, order_items(item:items(name, image_url))')
        .eq('shop_id', currentShopId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const normalizedOrders = ((data || []) as any[]).map((order) => ({
        ...order,
        id: order.shop_order_id || order.id || 'NO-ID',
        amount: order.subtotal || order.amount || 0,
        code: order.claim_code || order.code || 'NO-CODE',
        paid_at: order.created_at || order.paid_at || null,
        order_items: order.order_items ?? [],
        // Map first order_item's item to top-level 'item' so UI cards don't break
        item: order.order_items?.[0]?.item ?? null,
      }));

      // V2 enums: claim_status is PENDING, PARTIAL_FULFILLMENT, FULFILLED, EXPIRED
      const active = normalizedOrders.filter(
        (o) => o.claim_status === 'PENDING' || o.claim_status === 'PARTIAL_FULFILLMENT'
      );
      const fulfilled = normalizedOrders.filter((o) => o.claim_status === 'FULFILLED');

      setActiveOrders(active as unknown as Order[]);
      setFulfilledOrders(fulfilled as unknown as Order[]);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const fetchAnalytics = async (currentShopId: string) => {
    try {
      // 1. Get fulfilled shop_orders for volume and value stats (V2)
      const { data: ordersData } = await supabase
        .from('shop_orders')
        .select('subtotal, fulfilled_at')
        .eq('shop_id', currentShopId)
        .eq('claim_status', 'FULFILLED');

      const totalValue = ordersData?.reduce((sum: number, o: any) => sum + (o.subtotal || 0), 0) || 0;

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const weekOrders = ordersData?.filter(
        (o: any) => o.fulfilled_at && new Date(o.fulfilled_at) >= oneWeekAgo
      );
      const weekFulfilled = weekOrders?.length || 0;
      const weekValue = weekOrders?.reduce((sum: number, o: any) => sum + (o.subtotal || 0), 0) || 0;

      // 2. Calculate available balance from payout_ledger (unsettled credits)
      const { data: ledgerData } = await supabase
        .from('payout_ledger')
        .select('credit_amount')
        .eq('shop_id', currentShopId)
        .neq('status', 'SETTLED');

      const availableBalance = ledgerData?.reduce((sum: number, row: any) => sum + (row.credit_amount || 0), 0) || 0;

      setAnalytics(prev => ({
        ...prev,
        totalFulfilled: ordersData?.length || 0,
        totalValue,
        weekFulfilled,
        weekValue,
        availableBalance,
      }));
    } catch (error) {
      console.error('Error syncing dashboard:', error);
    }
  };

  const handleFulfillOrder = async (_orderId: string) => {
    navigate('/merchant/fulfill');
  };

  const handleEditProduct = (id: string) => {
    console.log('Edit product', id);
  };

  const handleDeleteProduct = (id: string) => {
    console.log('Delete product', id);
  };

  const handleWithdrawRequest = async () => {
    if (!shopId || analytics.availableBalance <= 0) return;
    setWithdrawing(true);
    try {
      const { error } = await supabase.functions.invoke('server', {
        body: {
          action: 'request_withdrawal',
          shopId,
          amount: analytics.availableBalance,
        },
      });
      if (error) throw error;
      // Optimistically clear the balance in UI — it'll reconcile on next fetch
      setAnalytics(prev => ({ ...prev, availableBalance: 0 }));
      alert('Withdrawal request submitted! KithLy will process it within 1-2 business days.');
    } catch (err: any) {
      console.error('[Withdraw] Failed:', err);
      alert(err.message || 'Withdrawal request failed. Please try again.');
    } finally {
      setWithdrawing(false);
    }
  };

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault(); // 1. STOPS the annoying page refresh!

    try {
      // 2. Tell the data center to destroy the token
      await supabase.auth.signOut();

      // 3. Clear any leftover zombie data in the browser
      localStorage.clear();
      sessionStorage.clear();

      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
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
            <Button variant="ghost" size="icon" onClick={() => navigate('/support')}>
              <HelpCircle className="w-5 h-5" />
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
            { label: 'Total Fulfilled', value: analytics.totalFulfilled, icon: Package, isCurrency: false },
            { label: 'Total Value', value: analytics.totalValue, icon: TrendingUp, isCurrency: true },
            { label: 'This Week', value: analytics.weekFulfilled, icon: Package, isCurrency: false },
            { label: 'Available for Withdrawal', value: analytics.availableBalance, icon: TrendingUp, isCurrency: true },
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white p-6 rounded-xl shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                  <stat.icon className="w-5 h-5 text-primary" />
                </div>
                {stat.label === 'Available for Withdrawal' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleWithdrawRequest}
                    disabled={withdrawing || analytics.availableBalance <= 0}
                    className="h-7 text-xs border-primary text-primary hover:bg-orange-50"
                  >
                    {withdrawing ? 'Requesting...' : 'Withdraw'}
                  </Button>
                )}
              </div>
              <p className="text-2xl font-bold">
                <AnimatedMetric value={stat.value} isCurrency={stat.isCurrency} />
              </p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Quick Actions Grid */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Shop Management</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Fulfill Order',
                description: 'Scan or enter a gift code',
                icon: QrCode,
                path: '/merchant/fulfill',
              },
              {
                label: 'Add New Product',
                description: 'List a new item in your shop',
                icon: PackagePlus,
                path: '/merchant/items/new',
              },
              {
                label: 'Edit Shop Profile',
                description: 'Update location and details',
                icon: Store,
                path: '/merchant/shop/edit',
              },
              {
                label: 'View Public Storefront',
                description: 'See how customers view your shop',
                icon: Store,
                path: shopId ? `/shop/${shopId}` : '#',
                external: true,
              },
              {
                label: 'Account Settings',
                description: 'Manage password and security',
                icon: Settings,
                path: '/settings',
              },
            ].map((action, index) => (
              <motion.button
                key={action.label}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                onClick={() => {
                  if (action.path === '#') return;
                  if (action.external) {
                    window.open(action.path, '_blank');
                  } else {
                    navigate(action.path);
                  }
                }}
                className="group flex flex-col items-start rounded-2xl border border-slate-100 bg-white/80 backdrop-blur-xl p-5 text-left shadow-sm hover:-translate-y-1 hover:shadow-lg transition-all"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 transition-colors group-hover:bg-orange-100">
                  <action.icon
                    className="h-6 w-6 text-orange-500 group-hover:bg-gradient-to-r group-hover:from-orange-500 group-hover:to-blue-800 group-hover:bg-clip-text group-hover:text-transparent"
                    strokeWidth={1.5}
                  />
                </div>
                <h3 className="text-base font-semibold text-slate-900">{action.label}</h3>
                <p className="mt-1 text-xs text-slate-500">{action.description}</p>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Tabs — Active Orders | Fulfilled | Inventory */}
        <Tabs defaultValue="active" className="space-y-6">
          <TabsList className="grid w-full max-w-xl grid-cols-3">
            <TabsTrigger value="active">Active Orders</TabsTrigger>
            <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
          </TabsList>

          {/* Active Orders */}
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
              activeOrders.map((order) => {
                const aggregatedItems = aggregateOrderItems(order.order_items);
                return (
                  <div key={order.id} className="bg-white p-6 rounded-xl shadow-sm border">
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        {aggregatedItems.length > 1 ? (
                          <div className="flex -space-x-4 overflow-hidden shrink-0 py-1">
                            {aggregatedItems.slice(0, 3).map((item, idx) => (
                              <div
                                key={idx}
                                className="inline-block h-20 w-20 rounded-xl ring-4 ring-white overflow-hidden bg-gray-100 shrink-0 shadow-sm"
                              >
                                {item.image_url ? (
                                  <img
                                    src={item.image_url}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <Package className="h-8 w-8 text-gray-400" />
                                  </div>
                                )}
                              </div>
                            ))}
                            {aggregatedItems.length > 3 && (
                              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-200 text-sm font-bold text-slate-600 ring-4 ring-white shrink-0 shadow-sm">
                                +{aggregatedItems.length - 3}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                            {aggregatedItems[0]?.image_url ? (
                              <img
                                src={aggregatedItems[0].image_url}
                                alt={aggregatedItems[0].name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Package className="h-8 w-8 text-gray-400" />
                              </div>
                            )}
                          </div>
                        )}
                        <div>
                          <h3 className="font-semibold text-lg">
                            {aggregatedItems.length === 0 ? (
                              'Gift Bundle'
                            ) : aggregatedItems.length === 1 ? (
                              `${aggregatedItems[0].name}${aggregatedItems[0].quantity > 1 ? ` (×${aggregatedItems[0].quantity})` : ''}`
                            ) : (
                              <span>
                                {aggregatedItems[0].name}{' '}
                                <span className="text-sm font-normal text-muted-foreground">
                                  and {order.order_items?.length! - 1} other item{order.order_items?.length! - 1 > 1 ? 's' : ''}
                                </span>
                              </span>
                            )}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            For: {order.recipient_name}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-primary">REF-{order.id.split('-')[0].toUpperCase()}</p>
                        <p className="text-xs text-muted-foreground">Order Reference</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        {order.paid_at &&
                          `Paid ${new Date(order.paid_at).toLocaleDateString()}`}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => {
                            setSelectedOrder(order);
                            setIsDetailsOpen(true);
                          }}
                          variant="outline"
                          size="sm"
                        >
                          View Order
                        </Button>
                        <Button
                          onClick={() => handleFulfillOrder(order.id)}
                          size="sm"
                          className="bg-gradient-to-r from-primary to-primary-light"
                        >
                          Fulfill This Order
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* Fulfilled */}
          <TabsContent value="fulfilled" className="space-y-4">
            {fulfilledOrders.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border">
                <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No fulfilled orders yet</p>
              </div>
            ) : (
              fulfilledOrders.map((order) => {
                const aggregatedItems = aggregateOrderItems(order.order_items);
                return (
                  <div key={order.id} className="bg-white p-6 rounded-xl shadow-sm border">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        {aggregatedItems.length > 1 ? (
                          <div className="flex -space-x-4 overflow-hidden shrink-0 py-1">
                            {aggregatedItems.slice(0, 3).map((item, idx) => (
                              <div
                                key={idx}
                                className="inline-block h-20 w-20 rounded-xl ring-4 ring-white overflow-hidden bg-gray-100 shrink-0 shadow-sm"
                              >
                                {item.image_url ? (
                                  <img
                                    src={item.image_url}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <Package className="h-8 w-8 text-gray-400" />
                                  </div>
                                )}
                              </div>
                            ))}
                            {aggregatedItems.length > 3 && (
                              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-200 text-sm font-bold text-slate-600 ring-4 ring-white shrink-0 shadow-sm">
                                +{aggregatedItems.length - 3}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                            {aggregatedItems[0]?.image_url ? (
                              <img
                                src={aggregatedItems[0].image_url}
                                alt={aggregatedItems[0].name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Package className="h-8 w-8 text-gray-400" />
                              </div>
                            )}
                          </div>
                        )}
                        <div>
                          <h3 className="font-semibold text-lg">
                            {aggregatedItems.length === 0 ? (
                              'Gift Bundle'
                            ) : aggregatedItems.length === 1 ? (
                              `${aggregatedItems[0].name}${aggregatedItems[0].quantity > 1 ? ` (×${aggregatedItems[0].quantity})` : ''}`
                            ) : (
                              <span>
                                {aggregatedItems[0].name}{' '}
                                <span className="text-sm font-normal text-muted-foreground">
                                  and {order.order_items?.length! - 1} other item{order.order_items?.length! - 1 > 1 ? 's' : ''}
                                </span>
                              </span>
                            )}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            For: {order.recipient_name}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-lg">{formatCurrency(order.amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.fulfilled_at &&
                            new Date(order.fulfilled_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end mt-4 pt-4 border-t border-slate-100">
                      <Button
                        onClick={() => {
                          setSelectedOrder(order);
                          setIsDetailsOpen(true);
                        }}
                        variant="outline"
                        size="sm"
                      >
                        View Order
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* Inventory */}
          <TabsContent value="inventory" className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {shopId ? (
                <AdminItems merchantShopId={shopId} baseRoute="/merchant" />
              ) : (
                <div className="p-12 text-center text-muted-foreground">Loading inventory...</div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* View Order Detail Sheet */}
      <Sheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Order Details</SheetTitle>
            <SheetDescription>
              Full transaction context for this gift bundle.
            </SheetDescription>
          </SheetHeader>
          {selectedOrder && (
            <div className="space-y-6 py-4">
              {/* Reference and Claim Status */}
              <div className="rounded-xl bg-slate-50 p-4 space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 font-medium">Claim Code:</span>
                  <span className="font-mono font-bold text-slate-900 bg-white border px-2 py-0.5 rounded text-xs select-all">
                    {selectedOrder.code}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 font-medium">Status:</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider",
                    selectedOrder.claim_status === 'FULFILLED'
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                  )}>
                    {selectedOrder.claim_status}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 font-medium">Recipient:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedOrder.recipient_name}
                  </span>
                </div>
                {selectedOrder.recipient_phone && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 font-medium">Recipient Phone:</span>
                    <span className="font-semibold text-slate-800">
                      {selectedOrder.recipient_phone}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 font-medium">Date:</span>
                  <span className="text-slate-800">
                    {selectedOrder.paid_at && new Date(selectedOrder.paid_at).toLocaleString()}
                  </span>
                </div>
                {selectedOrder.fulfilled_at && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 font-medium">Fulfilled At:</span>
                    <span className="text-slate-800 font-medium">
                      {new Date(selectedOrder.fulfilled_at).toLocaleString()}
                    </span>
                  </div>
                )}
                {selectedOrder.message && (
                  <div className="pt-2 border-t border-slate-200/60 text-sm">
                    <span className="text-slate-500 font-medium block mb-1">Gift Message:</span>
                    <p className="text-slate-700 italic bg-white p-2 rounded border border-slate-100">
                      "{selectedOrder.message}"
                    </p>
                  </div>
                )}
              </div>

              {/* Items List */}
              <div className="space-y-3">
                <h4 className="font-semibold text-slate-900 text-sm">Products in Bundle</h4>
                <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto pr-1">
                  {aggregateOrderItems(selectedOrder.order_items).map((oi, idx) => (
                    <div key={idx} className="flex items-center gap-3 py-3">
                      <div className="h-12 w-12 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {oi.image_url ? (
                          <img src={oi.image_url} alt={oi.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <Package className="h-5 w-5 text-slate-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-800 text-sm truncate">{oi.name}</p>
                        {oi.quantity > 1 && (
                          <p className="text-xs text-slate-500 mt-0.5">Quantity: {oi.quantity}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <span className="text-sm font-semibold text-slate-950">Total Value:</span>
                <span className="text-lg font-bold text-primary">{formatCurrency(selectedOrder.amount)}</span>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnimatedMetric — unchanged from original
// ---------------------------------------------------------------------------

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
