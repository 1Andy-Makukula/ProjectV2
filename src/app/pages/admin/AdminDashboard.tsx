import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import {
  ShoppingBag,
  TrendingUp,
  LogOut,
  ArrowRight,
  Download,
  Activity,
  Percent,
  Store,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { StatCard, StatStrip, SectionHeading } from '../../components/shared/StatCard';
import { useAdminDashboard } from '../../hooks/useAdminDashboard';
import { RecentOrder } from '../../types/orders';
import { STATUS_COLORS, STATUS_LABELS } from '../../../utils/orderStatus';
import { useAuth } from '../../../utils/auth/AuthContext';
import { formatCurrency } from '../../../utils/currency';
import { formatDate } from '../../../utils/relativeTime';
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
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const getStatusColor = (status: string) =>
    STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-800 border-gray-200';

  const getStatusLabel = (status: string) =>
    STATUS_LABELS[status] ?? status.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return (
    <PageShell>
      <AdminPageHeader
        title="Admin Dashboard"
        subtitle="KithLy Platform Management"
        actions={
          <>
            <Button
              onClick={handleExportAllData}
              className="bg-white text-primary hover:bg-white/90 h-8"
              disabled={exporting}
            >
              <Download className="size-3.5" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="text-white/80 hover:text-white hover:bg-white/10"
              aria-label="Log out"
            >
              <LogOut className="size-4" />
            </Button>
            <Activity
              className="size-4 text-white/30 hover:text-white cursor-pointer transition-colors"
              onClick={() => toast.success('Antigravity Diagnostic Engine Online')}
            />
          </>
        }
      />

      <PageBody>
        {/* ── Headline figures ─────────────────────────────────────────── */}
        <SectionHeading
          title="Platform"
          description="Gross volume and take across every shop, all time."
        />
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Total Value"
            value={stats.totalValue}
            animate
            isCurrency
            icon={TrendingUp}
            sub={`${formatCurrency(stats.valueThisWeek)} this week`}
          />
          <StatCard
            label="Platform Revenue"
            value={stats.totalCommission}
            animate
            isCurrency
            icon={Percent}
            sub={`${formatCurrency(stats.commissionThisWeek)} this week`}
          />
          <StatCard
            label="Total Orders"
            value={stats.totalOrders}
            animate
            icon={ShoppingBag}
            sub={`${stats.ordersThisWeek.toLocaleString()} this week`}
          />
        </div>

        {/* Merchant applications are work waiting on a person, so they get a
            prompt rather than a figure buried in the counts below. */}
        {stats.pendingShops > 0 && (
          <button
            onClick={() => navigate('/admin/shops')}
            className="mb-8 flex w-full items-center gap-3 rounded-2xl border border-orange-200/80 bg-orange-50 px-5 py-4 text-left transition-colors hover:bg-orange-100/70"
          >
            <Store className="size-5 shrink-0 text-primary" strokeWidth={1.75} />
            <p className="flex-1 text-sm leading-relaxed text-orange-850">
              <strong>
                {stats.pendingShops} merchant application
                {stats.pendingShops === 1 ? '' : 's'}
              </strong>{' '}
              awaiting review.
            </p>
            <ArrowRight className="size-4 shrink-0 text-primary" />
          </button>
        )}

        {/* ── Operational counts ───────────────────────────────────────── */}
        <SectionHeading
          title="Operations"
          description="Where orders currently sit, and how big the network is."
        />
        <StatStrip
          className="mb-8"
          entries={[
            { label: 'Fulfilled', value: stats.fulfilledOrders.toLocaleString(), tone: 'success' },
            { label: 'Pending', value: stats.pendingOrders.toLocaleString(), live: stats.pendingOrders > 0 },
            { label: 'Expired', value: stats.expiredOrders.toLocaleString(), tone: 'muted' },
            { label: 'Orders / wk', value: stats.ordersThisWeek.toLocaleString() },
            { label: 'Shops', value: stats.totalShops.toLocaleString() },
            {
              label: 'Applications',
              value: stats.pendingShops.toLocaleString(),
              live: stats.pendingShops > 0,
            },
            { label: 'Users', value: stats.totalUsers.toLocaleString() },
          ]}
        />

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
                title="Finance"
                description="Withdrawals & settlements"
                onClick={() => navigate('/admin/finance')}
              />
              <QuickLink
                title="Merchandising"
                description="Ads, Banners & Top Picks"
                onClick={() => navigate('/admin/merchandising')}
              />
              <QuickLink
                title="Notifications"
                description="Broadcast an announcement to users"
                onClick={() => navigate('/admin/notifications')}
              />
              <QuickLink
                title="Assisted Merchant Enrollment"
                description="For onboarding in person, when self-service sign-up isn't practical"
                onClick={() => navigate('/admin/merchants')}
              />
              <QuickLink
                title="Experiences"
                description="Curate multi-shop offerings"
                onClick={() => navigate('/admin/experiences')}
              />
              <QuickLink
                title="Catalogue"
                description="Ready-made listings shops can import"
                onClick={() => navigate('/admin/catalog')}
              />
              <QuickLink
                title="Lists"
                description="Publish community lists as KithLy"
                onClick={() => navigate('/lists')}
              />
              <QuickLink
                title="Messages"
                description="Talk to shops and customers"
                onClick={() => navigate('/admin/messages')}
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
                  <Table className="kl-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Shop</TableHead>
                        <TableHead>Sender</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentOrders.map((order: RecentOrder) => (
                        <TableRow
                          key={order.id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/admin/orders/${order.id}`)}
                        >
                          <TableCell className="font-mono text-primary">{order.code}</TableCell>
                          <TableCell className="font-medium text-foreground">{order.item_name}</TableCell>
                          <TableCell className="font-light">{order.shop_name}</TableCell>
                          <TableCell className="font-light">{order.sender_name}</TableCell>
                          <TableCell className="font-light">{order.recipient_name}</TableCell>
                          <TableCell className="font-medium tabular-nums">{formatCurrency(order.amount)}</TableCell>
                          <TableCell>
                            <Badge className={`font-light ${getStatusColor(order.status)}`}>
                              {getStatusLabel(order.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-light">
                            {formatDate(order.created_at)}
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
                          <span className="text-slate-800">{formatDate(order.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
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
