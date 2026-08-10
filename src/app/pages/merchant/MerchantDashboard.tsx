import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { claimCodeForMerchant, canRevealClaimCode } from '../../../utils/claimCode';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { formatCurrency } from '../../../utils/currency';
import { QrCode, LogOut, Package, TrendingUp, HelpCircle, PackagePlus, Store, Settings, Sparkles, MessageSquare, Wallet, ShieldAlert, Search, Download, ListChecks, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { NotificationBell } from '../../components/shared/NotificationBell';
import { StatCard, SectionHeading } from '../../components/shared/StatCard';
import { ShopOfferingBadge } from '../../components/shared/ShopOfferingBadge';
import { AdminItems } from '../admin/AdminItems';
import { SettlementDashboard } from '../../components/merchant/SettlementDashboard';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet';
import { cn } from '../../components/ui/utils';
import { useMerchantDashboard, Order, OrderItem } from '../../hooks/useMerchantDashboard';

// ---------------------------------------------------------------------------
// Helper to aggregate duplicate items and compute their total quantities
// ---------------------------------------------------------------------------

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

export interface MerchantDashboardProps {
  /**
   * Render someone else's shop with every write control suppressed. Used by
   * the admin support preview — the viewer is still themselves, never the
   * merchant, so nothing here may mutate.
   */
  readOnly?: boolean;
  /** Shop to render in readOnly mode. Ignored for a merchant's own dashboard. */
  previewShopId?: string;
}

export function MerchantDashboard({ readOnly = false, previewShopId }: MerchantDashboardProps = {}) {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  const {
    shopName,
    shopId,
    shopIsActive,
    shopOfferings,
    shopVerificationStatus,
    shopRejectionReason,
    experiences,
    activeOrders,
    fulfilledOrders,
    analytics,
    loading,
    withdrawing,
    ledgerData,
    ledgerLoading,
    handleWithdrawRequest,
    exportOrdersToCSV,
  } = useMerchantDashboard(profile?.id, previewShopId ? { shopId: previewShopId } : undefined);

  // Fulfilled history is the tab that grows without bound, so it gets the
  // search and export the admin order list already had.
  const [fulfilledQuery, setFulfilledQuery] = useState('');
  const filteredFulfilled = (() => {
    const q = fulfilledQuery.trim().toLowerCase();
    if (!q) return fulfilledOrders;
    return fulfilledOrders.filter((o) =>
      (o.code ?? '').toLowerCase().includes(q) ||
      (o.recipient_name ?? '').toLowerCase().includes(q) ||
      (o.order_items ?? []).some((oi) => (oi.item?.name ?? '').toLowerCase().includes(q))
    );
  })();

  // Catalogue management is gated behind approval — mirrors the items_merchant_write
  // RLS policy, which now requires shops.is_active = true.
  const catalogueLocked = !readOnly && !!shopId && !shopIsActive;

  // Sheet drawer state
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();

    try {
      await signOut();
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold">{shopName}</h1>
              {/* The merchant declared this at onboarding and it decides which
                  item types their catalogue form offers — but until now it was
                  only ever visible on the public storefront. */}
              <ShopOfferingBadge
                offersProducts={shopOfferings.offers_products}
                offersServices={shopOfferings.offers_services}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {readOnly ? 'Viewing as merchant — read only' : 'Merchant Dashboard'}
            </p>
          </div>
          {readOnly ? (
            <Button variant="outline" onClick={() => navigate('/admin/shops')}>
              Exit preview
            </Button>
          ) : (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
              {/* The way back out. This page is a mode, not a cage — the
                  merchant is also a customer and can shop like anyone else.
                  Routed to '/' rather than '/dashboard': this button says
                  "shopping", and the marketplace is at the root. Sending a
                  merchant to the Impact Dashboard instead left them with no
                  route to the storefront at all, since every other path out of
                  here is role-aware and lands them back on the merchant side. */}
              <Button
                variant="outline"
                onClick={() => navigate('/')}
                className="hidden sm:inline-flex"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to shopping
              </Button>
              <Button
                onClick={() => navigate('/merchant/fulfill')}
                className="kl-gradient-brand flex-1 sm:flex-none"
              >
                <QrCode className="w-4 h-4 mr-2" />
                Redeem Gift
              </Button>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => navigate('/merchant/messages')} aria-label="Messages">
                  <MessageSquare className="w-5 h-5" />
                </Button>
                <NotificationBell />
                <Button variant="ghost" size="icon" onClick={() => navigate('/support')}>
                  <HelpCircle className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleLogout}>
                  <LogOut className="w-5 h-5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* ── Approval status banner ───────────────────────────────────── */}
        {catalogueLocked && (
          <div className="mb-8 flex items-start gap-3 rounded-2xl border border-orange-200/80 bg-orange-50 px-5 py-4">
            <ShieldAlert className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-orange-850 leading-relaxed">
              {shopVerificationStatus === 'rejected' ? (
                <>
                  <strong>Your shop was not approved.</strong>{' '}
                  {shopRejectionReason || 'Contact support for details.'}
                </>
              ) : (
                <>
                  <strong>Your shop is awaiting admin review.</strong> You'll be able to add
                  items and appear live on KithLy once it's approved.
                </>
              )}
            </p>
          </div>
        )}

        {/* ── Trading figures ──────────────────────────────────────────── */}
        <SectionHeading
          title="Your shop"
          description="Everything handed over, and what is cleared to withdraw."
        />
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Fulfilled"
            value={analytics.totalFulfilled}
            animate
            icon={Package}
            sub={`${analytics.weekFulfilled.toLocaleString()} in the last 7 days`}
          />
          <StatCard
            label="Total Value"
            value={analytics.totalValue}
            animate
            isCurrency
            icon={TrendingUp}
          />
          {/* weekValue is calculated by useMerchantDashboard but was never shown
              until now — the week card used to display only the count. */}
          <StatCard
            label="This Week"
            value={analytics.weekFulfilled}
            animate
            icon={Package}
            sub={`${formatCurrency(analytics.weekValue)} handed over`}
            live={analytics.weekFulfilled > 0}
          />
          <div className="relative">
            <StatCard
              label="Available for Withdrawal"
              value={analytics.availableBalance}
              animate
              isCurrency
              icon={Wallet}
              sub={
                analytics.availableBalance > 0
                  ? 'Cleared and ready to pay out'
                  : 'Nothing cleared yet'
              }
            />
            {!readOnly && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleWithdrawRequest}
                disabled={withdrawing || analytics.availableBalance <= 0}
                className="absolute right-4 bottom-4 h-7 border-primary text-xs text-primary hover:bg-primary-tint"
              >
                {withdrawing ? 'Requesting…' : 'Withdraw'}
              </Button>
            )}
          </div>
        </div>

        {/* Curated bundles carrying this shop's items. Admin-curated without
            the merchant's involvement, so it is listed rather than managed. */}
        {experiences.length > 0 && (
          <div className="mb-8">
            <SectionHeading
              title="Featured in"
              description="Curated experiences that include your products."
            />
            <div className="flex flex-wrap gap-3">
              {experiences.map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white/80 px-4 py-2.5 shadow-sm"
                >
                  <Sparkles className="size-4 shrink-0 text-orange-500" strokeWidth={1.75} />
                  <span className="text-sm font-medium text-slate-900">{exp.name}</span>
                  {exp.expires_at && (
                    <span className="text-xs text-slate-400">
                      until {new Date(exp.expires_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions Grid — hidden in preview: every entry navigates into a
            merchant-only route, which would eject the admin out of the preview. */}
        <div className={cn('mb-8', readOnly && 'hidden')}>
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
                label: 'Shop Lists',
                description: 'Bundle items into a shareable list',
                icon: ListChecks,
                path: '/lists',
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
            ].map((action, index) => {
              const locked = catalogueLocked && action.path === '/merchant/items/new';
              return (
              <motion.button
                key={action.label}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                onClick={() => {
                  if (action.path === '#') return;
                  if (locked) {
                    toast.error('Your shop is still awaiting admin review.');
                    return;
                  }
                  if (action.external) {
                    window.open(action.path, '_blank');
                  } else {
                    navigate(action.path);
                  }
                }}
                className={cn(
                  'group flex flex-col items-start rounded-2xl border border-slate-100 bg-white/80 backdrop-blur-xl p-5 text-left shadow-sm hover:-translate-y-1 hover:shadow-lg transition-all',
                  locked && 'opacity-50 hover:translate-y-0 hover:shadow-sm cursor-not-allowed'
                )}
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
              );
            })}
          </div>
        </div>

        {/* Tabs — Active Orders | Fulfilled | Inventory */}
        <Tabs defaultValue="active" className="space-y-6">
          <TabsList className="flex overflow-x-auto w-full max-w-2xl md:grid md:grid-cols-4 h-auto md:h-9 gap-1 md:gap-0 p-1 md:p-[3px] justify-start scrollbar-none">
            <TabsTrigger value="active">
              Active Orders
              {activeOrders.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary-tint px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary">
                  {activeOrders.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="fulfilled">
              Fulfilled
              {fulfilledOrders.length > 0 && (
                <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                  {fulfilledOrders.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="ledger">
              Settlements
              {ledgerData.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary-tint px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary">
                  {ledgerData.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
          </TabsList>

          {/* Active Orders */}
          <TabsContent value="active" className="space-y-4">
            {activeOrders.length === 0 ? (
              <div className="kl-card flex flex-col items-center px-6 py-16 text-center">
                <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-tint">
                  <Package className="size-6 text-primary" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-medium tracking-tight">Nothing waiting to be handed over</h3>
                <p className="mt-1 max-w-xs text-sm font-light text-muted-foreground">
                  Paid orders land here the moment a customer checks out — no refresh needed.
                </p>
              </div>
            ) : (
              activeOrders.map((order) => {
                const aggregatedItems = aggregateOrderItems(order.order_items);
                return (
                  <div key={order.id} className="bg-white p-6 rounded-xl shadow-sm border">
                    <div className="mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
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
                            For <span className="font-medium text-foreground">{order.recipient_name}</span>
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-left sm:text-right">
                        <p className="kl-stat__label">Reference</p>
                        <p className="mt-0.5 font-mono text-sm font-medium tracking-tight text-primary">
                          REF-{order.id.split('-')[0].toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs font-light text-muted-foreground">
                        {order.paid_at &&
                          `Paid ${new Date(order.paid_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`}
                      </p>
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
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
                        {!readOnly && (
                          <Button
                            onClick={() => navigate('/merchant/fulfill')}
                            size="sm"
                            className="kl-gradient-brand"
                          >
                            Fulfill This Order
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* Fulfilled */}
          <TabsContent value="fulfilled" className="space-y-4">
            {fulfilledOrders.length > 0 && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={fulfilledQuery}
                    onChange={(e) => setFulfilledQuery(e.target.value)}
                    placeholder="Search by code, recipient or item…"
                    className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                {!readOnly && (
                  <Button
                    variant="outline"
                    onClick={() => exportOrdersToCSV(filteredFulfilled, 'kithly-my-orders')}
                    disabled={filteredFulfilled.length === 0}
                  >
                    <Download className="mr-2 size-4" />
                    Export CSV
                  </Button>
                )}
              </div>
            )}
            {filteredFulfilled.length === 0 && fulfilledOrders.length > 0 ? (
              <div className="kl-card px-6 py-12 text-center text-sm text-muted-foreground">
                No orders match “{fulfilledQuery}”.
              </div>
            ) : fulfilledOrders.length === 0 ? (
              <div className="kl-card flex flex-col items-center px-6 py-16 text-center">
                <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-secondary">
                  <Package className="size-6 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-medium tracking-tight">No completed handovers yet</h3>
                <p className="mt-1 max-w-xs text-sm font-light text-muted-foreground">
                  Once you redeem a gift code, the order moves here with its settlement record.
                </p>
              </div>
            ) : (
              filteredFulfilled.map((order) => {
                const aggregatedItems = aggregateOrderItems(order.order_items);
                return (
                  <div key={order.id} className="bg-white p-6 rounded-xl shadow-sm border">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
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
                      <div className="text-left sm:text-right shrink-0">
                        <p className="font-semibold text-lg">{formatCurrency(order.amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.fulfilled_at &&
                            new Date(order.fulfilled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
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

          {/* Settlements / Ledger */}
          <TabsContent value="ledger" className="space-y-4">
            <SettlementDashboard ledgerData={ledgerData} isLoading={ledgerLoading} />
          </TabsContent>

          {/* Inventory */}
          <TabsContent value="inventory" className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {shopId ? (
                <AdminItems merchantShopId={shopId} baseRoute="/merchant" readOnly={readOnly || catalogueLocked} />
              ) : (
                <div className="p-12 text-center text-muted-foreground">Loading inventory...</div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* View Order Detail Sheet */}
      <Sheet open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto max-h-screen">
          <SheetHeader className="border-b border-slate-100 pb-4">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Sparkles className="h-5 w-5 text-orange-500" />
              <span>Order Details</span>
            </SheetTitle>
            <SheetDescription className="text-slate-500 text-xs">
              Full transaction context for this gift bundle.
            </SheetDescription>
          </SheetHeader>
          {selectedOrder && (
            <div className="space-y-6 py-5">
              {/* Reference and Claim Status - styled like a premium coupon/ticket */}
              <div className="relative rounded-2xl bg-gradient-to-br from-orange-50/70 to-amber-50/40 border border-orange-100/70 p-5 shadow-sm space-y-4 overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-orange-200/20 to-amber-200/10 rounded-bl-full pointer-events-none" />
                
                <div className="flex justify-between items-center text-sm border-b border-orange-100/50 pb-3">
                  <div className="flex items-center gap-2">
                    <QrCode className="h-4 w-4 text-orange-500" />
                    <span className="text-slate-500 font-semibold">Claim Code</span>
                  </div>
                  <span className="font-mono font-bold text-orange-600 bg-orange-100/40 border border-orange-200/50 px-2.5 py-1 rounded-xl text-xs select-all tracking-wider shadow-sm">
                    {claimCodeForMerchant(selectedOrder.code, selectedOrder.claim_status)}
                  </span>
                </div>

                {!canRevealClaimCode(selectedOrder.claim_status) && (
                  <p className="text-[11px] text-slate-500 leading-relaxed -mt-2">
                    The customer presents this code at the counter. Enter it in the
                    Handover Terminal to verify and redeem.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-4 text-xs pt-1">
                  <div className="space-y-1">
                    <span className="text-slate-400 block font-medium">Status</span>
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px] border shadow-sm",
                      selectedOrder.claim_status === 'FULFILLED'
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", selectedOrder.claim_status === 'FULFILLED' ? "bg-green-500" : "bg-amber-500")} />
                      {selectedOrder.claim_status}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 block font-medium">Date</span>
                    <span className="text-slate-800 font-semibold flex items-center gap-1">
                      {selectedOrder.paid_at && new Date(selectedOrder.paid_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                </div>

                <div className="border-t border-dashed border-orange-200/60 pt-3 space-y-2.5 text-xs text-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Recipient:</span>
                    <span className="font-semibold text-slate-800">
                      {selectedOrder.recipient_name}
                    </span>
                  </div>
                  
                  {selectedOrder.recipient_phone && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-medium">Phone:</span>
                      <span className="font-mono font-medium text-slate-800">
                        {selectedOrder.recipient_phone}
                      </span>
                    </div>
                  )}

                  {selectedOrder.fulfilled_at && (
                    <div className="flex items-center justify-between border-t border-orange-100/40 pt-2.5">
                      <span className="text-slate-400 font-medium">Fulfilled At:</span>
                      <span className="font-semibold text-green-600">
                        {new Date(selectedOrder.fulfilled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>
                    </div>
                  )}
                </div>

                {/* The gift message is deliberately not shown.
                    It is a private note from the buyer to the recipient, and
                    it reaches the recipient through the WhatsApp share link.
                    The shop needs the items and the recipient, not the words. */}
              </div>

              {/* Items List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-sm">Products in Bundle</h4>
                  <span className="text-xs font-semibold text-slate-400">{aggregateOrderItems(selectedOrder.order_items).length} Items</span>
                </div>
                {/* Product cards list letting it flow naturally inside scrollable SheetContent */}
                <div className="space-y-2.5">
                  {aggregateOrderItems(selectedOrder.order_items).map((oi, idx) => (
                    <div key={idx} className="flex items-center gap-3.5 p-3 rounded-2xl border border-slate-100 bg-white/60 hover:bg-slate-50/50 hover:border-slate-200 transition-all duration-200 shadow-sm">
                      <div className="h-12 w-12 rounded-xl overflow-hidden bg-slate-50 shrink-0 border border-slate-100/70 flex items-center justify-center shadow-inner">
                        {oi.image_url ? (
                          <img src={oi.image_url} alt={oi.name} className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-5 w-5 text-slate-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm truncate">{oi.name}</p>
                        {oi.quantity > 1 && (
                          <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                            Qty: {oi.quantity}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex justify-between items-center pt-5 border-t border-slate-100">
                <span className="text-sm font-bold text-slate-900">Total Value:</span>
                <span className="text-xl font-extrabold bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">
                  {formatCurrency(selectedOrder.amount)}
                </span>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// AnimatedMetric now lives in components/shared/AnimatedMetric.tsx so the admin
// dashboard can use the same count-up.
