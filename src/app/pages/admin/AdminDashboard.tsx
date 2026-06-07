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
import { useAdminDashboard, RecentOrder } from '../../hooks/useAdminDashboard';
import { STATUS_COLORS, STATUS_LABELS } from '../../../utils/orderStatus';
import { useAuth } from '../../../utils/auth/AuthContext';
import { formatCurrency } from '../../../utils/currency';
import { toast } from 'sonner';

export function AdminDashboard() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const {
    stats,
    recentOrders,
    loading,
    exporting,
    exportAllData: handleExportAllData,
  } = useAdminDashboard();

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();

    try {
      await signOut();
      localStorage.clear();
      sessionStorage.clear();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const getStatusColor = (status: string) =>
    STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-800 border-gray-200';

  const getStatusLabel = (status: string) =>
    STATUS_LABELS[status] ?? status.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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
              <div>
                {/* Desktop View */}
                <div className="hidden md:block overflow-x-auto">
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

                {/* Mobile View */}
                <div className="flex flex-col gap-4 md:hidden">
                  {recentOrders.map((order: RecentOrder) => (
                    <div
                      key={order.id}
                      className="p-4 border border-slate-100 bg-white rounded-2xl shadow-sm cursor-pointer hover:bg-orange-50/50"
                      onClick={() => navigate(`/admin/orders/${order.id}`)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-mono text-xs font-semibold text-slate-500">
                          Code: {order.code}
                        </span>
                        <Badge className={`font-light ${getStatusColor(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </Badge>
                      </div>

                      <div className="space-y-1 my-3">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {order.item_name}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          Shop: {order.shop_name}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-y-1.5 text-xs text-slate-600 border-t pt-3">
                        <div>
                          <span className="text-slate-400">Sender: </span>
                          <span className="font-medium text-slate-800">{order.sender_name}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Recipient: </span>
                          <span className="font-medium text-slate-800">{order.recipient_name}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Amount: </span>
                          <span className="font-semibold text-slate-950">{formatCurrency(order.amount)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Date: </span>
                          <span className="text-slate-800">{new Date(order.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
