import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Search, Download, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { formatCurrency } from '../../../utils/currency';
import { formatDate } from '../../../utils/relativeTime';
import { useAdminOrders } from '../../hooks/useAdminOrders';
import { STATUS_COLORS, STATUS_LABELS } from '../../../utils/orderStatus';
import { Order, StatusFilter } from '../../types/orders';

export function AdminOrders() {
  const navigate = useNavigate();

  const {
    orders,
    loading,
    actionOrderId,
    updateOrderStatus,
    exportToCSV,
  } = useAdminOrders();

  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    filterOrders();
  }, [orders, searchQuery, statusFilter]);

  const filterOrders = () => {
    let filtered = orders;

    if (statusFilter !== 'all') {
      filtered = filtered.filter((order) => order.status === statusFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((order) =>
        (order.claim_code ?? '').toLowerCase().includes(query) ||
        (order.sender_name ?? '').toLowerCase().includes(query) ||
        (order.recipient_name ?? '').toLowerCase().includes(query) ||
        (order.item_name ?? '').toLowerCase().includes(query) ||
        (order.shop_name ?? '').toLowerCase().includes(query)
      );
    }

    setFilteredOrders(filtered);
  };

  const handleExport = () => {
    exportToCSV(filteredOrders);
  };

  const getStatusColor = (status: string) =>
    STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-800 border-gray-200';

  const getStatusLabel = (status: string) =>
    STATUS_LABELS[status] ?? status.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const getStatusCount = (status: StatusFilter) => {
    if (status === 'all') return orders.length;
    return orders.filter((o) => o.status === status).length;
  };

  return (
    <PageShell>
      <AdminPageHeader
        title="Manage Orders"
        subtitle="View and manage all platform orders"
        onBack={() => navigate('/admin')}
        actions={
          <Button
            onClick={handleExport}
            className="bg-white text-primary hover:bg-white/90 h-8"
            disabled={filteredOrders.length === 0}
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
        }
      />

      <PageBody>
        {/* Search sits on the page rather than inside the gradient bar, where
            white-on-brand input text was hard to read. */}
        <div className="relative mb-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by code, sender, recipient, item or shop…"
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="h-10 pl-9"
          />
        </div>

        <Tabs value={statusFilter} onValueChange={(value: string) => setStatusFilter(value as StatusFilter)}>
          <TabsList className="grid w-full grid-cols-6 mb-6">
            <TabsTrigger value="all" className="font-light">
              All ({getStatusCount('all')})
            </TabsTrigger>
            <TabsTrigger value="pending_payment" className="font-light">
              Pending ({getStatusCount('pending_payment')})
            </TabsTrigger>
            <TabsTrigger value="paid" className="font-light">
              Paid ({getStatusCount('paid')})
            </TabsTrigger>
            <TabsTrigger value="fulfilled" className="font-light">
              Fulfilled ({getStatusCount('fulfilled')})
            </TabsTrigger>
            <TabsTrigger value="expired" className="font-light">
              Expired ({getStatusCount('expired')})
            </TabsTrigger>
            <TabsTrigger value="cancelled" className="font-light">
              Cancelled ({getStatusCount('cancelled')})
            </TabsTrigger>
          </TabsList>

          <Card>
            <CardHeader>
              <CardTitle className="font-light">
                {filteredOrders.length} {filteredOrders.length === 1 ? 'Order' : 'Orders'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Loading orders…</div>
              ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-16 text-center">
                  <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-tint">
                    <Package className="size-6 text-primary" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-base font-medium tracking-tight">
                    {searchQuery ? 'No matching orders' : 'No orders yet'}
                  </h3>
                  <p className="mt-1 max-w-xs text-sm font-light text-muted-foreground">
                    {searchQuery
                      ? 'Try a different code, name, item or shop.'
                      : 'Orders appear here as soon as customers start checking out.'}
                  </p>
                </div>
              ) : (
              <div>
                {/* Desktop View */}
                <div className="hidden md:block overflow-x-auto">
                  <Table className="kl-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Shop</TableHead>
                        <TableHead>Sender</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Fulfilled</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((order) => (
                        <TableRow
                          key={order.transaction_id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/admin/orders/${order.transaction_id}`)}
                        >
                          <TableCell className="font-mono text-primary">
                            {order.claim_code ?? '—'}
                          </TableCell>
                          <TableCell className="font-light">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100">
                                {order.item_image_url ? (
                                  <img
                                    src={order.item_image_url}
                                    alt={order.item_name ?? ''}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <Package className="h-5 w-5 text-gray-400" />
                                  </div>
                                )}
                              </div>
                              <span>{order.item_name ?? 'N/A'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-light">{order.shop_name ?? '—'}</TableCell>
                          <TableCell className="font-light">{order.sender_name ?? '—'}</TableCell>
                          <TableCell className="font-light">{order.recipient_name ?? '—'}</TableCell>
                          <TableCell className="font-light">{formatCurrency(order.amount, 'ZMW')}</TableCell>
                          <TableCell>
                            <Badge className={`font-light ${getStatusColor(order.status)}`}>
                              {getStatusLabel(order.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-light">
                            {formatDate(order.created_at)}
                          </TableCell>
                          <TableCell className="font-light">
                            {order.fulfilled_at ? formatDate(order.fulfilled_at) : '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              {order.status === 'pending_payment' && (
                                <Button
                                  size="sm"
                                  onClick={(event: React.MouseEvent) => {
                                    event.stopPropagation();
                                    updateOrderStatus(order, 'paid');
                                  }}
                                  disabled={actionOrderId === order.transaction_id}
                                >
                                  Mark as Paid
                                </Button>
                              )}
                              {!['fulfilled', 'expired', 'cancelled'].includes(order.status) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(event: React.MouseEvent) => {
                                    event.stopPropagation();
                                    updateOrderStatus(order, 'expired');
                                  }}
                                  disabled={actionOrderId === order.transaction_id}
                                >
                                  Mark Expired
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile View */}
                <div className="flex flex-col gap-4 md:hidden">
                  {filteredOrders.map((order) => (
                    <div
                      key={order.transaction_id}
                      className="p-4 border border-slate-100 bg-white rounded-2xl shadow-sm cursor-pointer hover:bg-orange-50/50"
                      onClick={() => navigate(`/admin/orders/${order.transaction_id}`)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-mono text-xs font-semibold text-slate-500">
                          Code: {order.claim_code ?? '—'}
                        </span>
                        <Badge className={`font-light ${getStatusColor(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 my-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100">
                          {order.item_image_url ? (
                            <img
                              src={order.item_image_url}
                              alt={order.item_name ?? ''}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Package className="h-5 w-5 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {order.item_name ?? 'N/A'}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            Shop: {order.shop_name ?? '—'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-y-1.5 text-xs text-slate-600 border-t pt-3">
                        <div>
                          <span className="text-slate-400">Sender: </span>
                          <span className="font-medium text-slate-800">{order.sender_name ?? '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Recipient: </span>
                          <span className="font-medium text-slate-800">{order.recipient_name ?? '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Amount: </span>
                          <span className="font-semibold text-slate-950">{formatCurrency(order.amount, 'ZMW')}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Created: </span>
                          <span className="text-slate-800">{formatDate(order.created_at)}</span>
                        </div>
                        {order.fulfilled_at && (
                          <div className="col-span-2">
                            <span className="text-slate-400">Fulfilled: </span>
                            <span className="text-slate-800">{formatDate(order.fulfilled_at)}</span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
                        {order.status === 'pending_payment' && (
                          <Button
                            size="sm"
                            onClick={(event: React.MouseEvent) => {
                              event.stopPropagation();
                              updateOrderStatus(order, 'paid');
                            }}
                            disabled={actionOrderId === order.transaction_id}
                          >
                            Mark as Paid
                          </Button>
                        )}
                        {!['fulfilled', 'expired', 'cancelled'].includes(order.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(event: React.MouseEvent) => {
                              event.stopPropagation();
                              updateOrderStatus(order, 'expired');
                            }}
                            disabled={actionOrderId === order.transaction_id}
                          >
                            Mark Expired
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              )}
            </CardContent>
          </Card>
        </Tabs>
      </PageBody>
    </PageShell>
  );
}
