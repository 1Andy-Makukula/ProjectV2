import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import {
  ShoppingBag,
  TrendingUp,
  Store,
  Users,
  CheckCircle,
  Clock,
  XCircle,
  LogOut,
  ArrowRight,
  Download,
  Activity,
  Percent,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../utils/auth/AuthContext';
import { formatCurrency } from '../../../utils/currency';
import { toast } from 'sonner';

interface Stats {
  totalOrders: number;
  totalValue: number;
  ordersThisWeek: number;
  valueThisWeek: number;
  totalCommission: number;
  commissionThisWeek: number;
  totalShops: number;
  totalUsers: number;
  fulfilledOrders: number;
  pendingOrders: number;
  expiredOrders: number;
}

interface RecentOrder {
  id: string;
  code: string;
  item_name: string;
  shop_name: string;
  sender_name: string;
  recipient_name: string;
  amount: number;
  status: string;
  created_at: string;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [stats, setStats] = useState<Stats>({
    totalOrders: 0,
    totalValue: 0,
    ordersThisWeek: 0,
    valueThisWeek: 0,
    totalCommission: 0,
    commissionThisWeek: 0,
    totalShops: 0,
    totalUsers: 0,
    fulfilledOrders: 0,
    pendingOrders: 0,
    expiredOrders: 0,
  });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // V2: Query transactions joined with shop_orders
      const { data: transactions, error: txError } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          status,
          total_amount,
          created_at,
          buyer:buyer_id (name),
          shop_orders (
            shop_order_id,
            claim_code,
            claim_status,
            recipient_name,
            shop:shop_id (name),
            order_items (
              item:item_id (name)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (txError) throw txError;

      // Get shops count
      const { count: shopsCount, error: shopsError } = await supabase
        .from('shops')
        .select('*', { count: 'exact', head: true });

      if (shopsError) throw shopsError;

      // Get users count
      const { count: usersCount, error: usersError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      if (usersError) throw usersError;

      // Calculate stats
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const ordersThisWeek = transactions?.filter((t: any) => new Date(t.created_at) >= weekAgo) || [];

      setStats({
        totalOrders: transactions?.length || 0,
        totalValue: transactions?.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0) || 0,
        ordersThisWeek: ordersThisWeek.length,
        valueThisWeek: ordersThisWeek.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0),
        totalCommission: (transactions?.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0) || 0) * 0.05,
        commissionThisWeek: (ordersThisWeek.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0)) * 0.05,
        totalShops: shopsCount || 0,
        totalUsers: usersCount || 0,
        fulfilledOrders: transactions?.filter((t: any) => t.shop_orders?.some((so: any) => so.claim_status === 'REDEEMED' || so.claim_status === 'FULFILLED')).length || 0,
        pendingOrders: transactions?.filter((t: any) => t.status === 'GATEWAY_PROCESSING' || t.shop_orders?.some((so: any) => so.claim_status === 'PENDING')).length || 0,
        expiredOrders: transactions?.filter((t: any) => t.status === 'FAILED' || t.status === 'CANCELLED').length || 0,
      });

      // Get recent orders with details
      const formattedOrders = transactions?.slice(0, 20).map((txn: any) => {
        const firstShopOrder = txn.shop_orders?.[0];
        const firstItem = firstShopOrder?.order_items?.[0]?.item;

        let displayStatus = 'pending_payment';
        if (txn.status === 'GATEWAY_PROCESSING') displayStatus = 'pending_payment';
        else if (txn.status === 'FAILED' || txn.status === 'CANCELLED') displayStatus = 'cancelled';
        else if (firstShopOrder?.claim_status === 'REDEEMED' || firstShopOrder?.claim_status === 'FULFILLED') displayStatus = 'fulfilled';
        else if (firstShopOrder?.claim_status === 'PENDING') displayStatus = 'paid';

        return {
          id: txn.transaction_id,
          code: firstShopOrder?.claim_code || 'N/A',
          item_name: firstItem?.name || 'N/A',
          shop_name: firstShopOrder?.shop?.name || 'N/A',
          sender_name: (txn.buyer as any)?.name || 'N/A',
          recipient_name: firstShopOrder?.recipient_name || 'N/A',
          amount: txn.total_amount || 0,
          status: displayStatus,
          created_at: txn.created_at,
        };
      }) || [];

      setRecentOrders(formattedOrders);
    } catch (error: any) {
      console.error('Error loading dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
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

      // 4. Safely redirect to the login page
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleExportAllData = async () => {
    try {
      setExporting(true);

      const { data, error } = await supabase
        .from('orders')
        .select(`
          code,
          recipient_name,
          amount,
          currency,
          status,
          created_at,
          paid_at,
          fulfilled_at,
          sender:users!sender_id(name, email, phone),
          item:items(name),
          shop:shops(name, location)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const headers = [
        'Code',
        'Item',
        'Shop',
        'Shop Location',
        'Sender Name',
        'Sender Email',
        'Sender Phone',
        'Recipient Name',
        'Amount',
        'Currency',
        'Status',
        'Created At',
        'Paid At',
        'Fulfilled At',
      ];

      const rows = (data || []).map((order: any) => [
        order.code,
        order.item?.name || '',
        order.shop?.name || '',
        order.shop?.location || '',
        order.sender?.name || '',
        order.sender?.email || '',
        order.sender?.phone || '',
        order.recipient_name || '',
        (order.amount / 100).toFixed(2),
        order.currency || 'ZMW',
        order.status || '',
        order.created_at || '',
        order.paid_at || '',
        order.fulfilled_at || '',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map((row: any[]) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kithly-platform-export-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);

      toast.success('Platform data exported to CSV');
    } catch (error: any) {
      console.error('Error exporting data:', error);
      toast.error(error.message || 'Failed to export platform data');
    } finally {
      setExporting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'fulfilled':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'paid':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'pending_payment':
      case 'payment_submitted':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'expired':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/90 text-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-light mb-1">Admin Dashboard</h1>
                <Activity 
                  className="w-5 h-5 text-white/40 hover:text-white cursor-pointer transition-colors" 
                  onClick={() => toast.success('Antigravity Diagnostic Engine Online')} 
                />
              </div>
              <p className="text-sm opacity-90 font-light">KithLy Platform Management</p>
            </div>
            <Button
              variant="outline"
              onClick={handleLogout}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </Button>
          </div>
          <div className="mt-4">
            <Button
              onClick={handleExportAllData}
              className="bg-white text-primary hover:bg-white/90"
              disabled={exporting}
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export All Data to CSV'}
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <StatCard
            title="Total Orders"
            value={stats.totalOrders}
            icon={ShoppingBag}
            gradient="from-blue-500 to-blue-600"
          />
          <StatCard
            title="Total Value"
            value={formatCurrency(stats.totalValue)}
            icon={TrendingUp}
            gradient="from-green-500 to-green-600"
          />
          <StatCard
            title="Orders This Week"
            value={stats.ordersThisWeek}
            icon={ShoppingBag}
            gradient="from-purple-500 to-purple-600"
          />
          <StatCard
            title="Value This Week"
            value={formatCurrency(stats.valueThisWeek)}
            icon={TrendingUp}
            gradient="from-indigo-500 to-indigo-600"
          />
          <StatCard
            title="Total KithLy Revenue (5%)"
            value={formatCurrency(stats.totalCommission)}
            icon={Percent}
            gradient="from-amber-500 to-amber-600"
          />
          <StatCard
            title="Revenue This Week (5%)"
            value={formatCurrency(stats.commissionThisWeek)}
            icon={Percent}
            gradient="from-yellow-500 to-yellow-600"
          />
          <StatCard
            title="Total Shops"
            value={stats.totalShops}
            icon={Store}
            gradient="from-orange-500 to-orange-600"
          />
          <StatCard
            title="Total Users"
            value={stats.totalUsers}
            icon={Users}
            gradient="from-pink-500 to-pink-600"
          />
          <StatCard
            title="Fulfilled Orders"
            value={stats.fulfilledOrders}
            icon={CheckCircle}
            gradient="from-green-500 to-green-600"
          />
          <StatCard
            title="Pending Orders"
            value={stats.pendingOrders}
            icon={Clock}
            gradient="from-yellow-500 to-yellow-600"
          />
          <StatCard
            title="Expired Orders"
            value={stats.expiredOrders}
            icon={XCircle}
            gradient="from-red-500 to-red-600"
          />
        </div>

        {/* Quick Links */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="font-light">Quick Links</CardTitle>
            <CardDescription className="font-light">Navigate to admin sections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <QuickLink
                title="Manage Shops"
                description="View and edit shops"
                onClick={() => navigate('/admin/shops')}
              />
              <QuickLink
                title="Manage Orders"
                description="View all orders"
                onClick={() => navigate('/admin/orders')}
              />
              <QuickLink
                title="Merchandising"
                description="Ads, Banners & Top Picks"
                onClick={() => navigate('/admin-merch')}
              />
              <QuickLink
                title="Manage Merchants"
                description="Create merchant accounts"
                onClick={() => navigate('/admin/merchants')}
              />
              <QuickLink
                title="Add New Shop"
                description="Create a new shop"
                onClick={() => navigate('/admin/shops/new')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="font-light">Recent Activity</CardTitle>
            <CardDescription className="font-light">Last 20 orders across all shops</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : recentOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No orders yet</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-light">Code</TableHead>
                      <TableHead className="font-light">Item</TableHead>
                      <TableHead className="font-light">Shop</TableHead>
                      <TableHead className="font-light">Sender</TableHead>
                      <TableHead className="font-light">Recipient</TableHead>
                      <TableHead className="font-light">Amount</TableHead>
                      <TableHead className="font-light">Status</TableHead>
                      <TableHead className="font-light">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.map((order: RecentOrder) => (
                      <TableRow
                        key={order.id}
                        className="cursor-pointer hover:bg-orange-50"
                        onClick={() => navigate(`/admin/orders/${order.id}`)}
                      >
                        <TableCell className="font-mono font-light">{order.code}</TableCell>
                        <TableCell className="font-light">{order.item_name}</TableCell>
                        <TableCell className="font-light">{order.shop_name}</TableCell>
                        <TableCell className="font-light">{order.sender_name}</TableCell>
                        <TableCell className="font-light">{order.recipient_name}</TableCell>
                        <TableCell className="font-light">{formatCurrency(order.amount)}</TableCell>
                        <TableCell>
                          <Badge className={`font-light ${getStatusColor(order.status)}`}>
                            {getStatusLabel(order.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-light">
                          {new Date(order.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({ title, value, icon: Icon, gradient }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4`}>
            <Icon className="w-6 h-6 text-white" strokeWidth={1.5} />
          </div>
          <h3 className="text-sm font-light text-muted-foreground mb-1">{title}</h3>
          <p className="text-2xl font-medium text-black">{value}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Quick Link Component
function QuickLink({ title, description, onClick }: any) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-primary hover:bg-orange-50 transition-all text-left"
    >
      <div>
        <h4 className="font-medium text-sm mb-1">{title}</h4>
        <p className="text-xs text-muted-foreground font-light">{description}</p>
      </div>
      <ArrowRight className="w-5 h-5 text-primary" />
    </motion.button>
  );
}
