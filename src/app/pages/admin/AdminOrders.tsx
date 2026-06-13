import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Search, Download, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { formatCurrency } from '../../../utils/currency';
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/90 text-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/admin')}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-light">Manage Orders</h1>
              <p className="text-sm opacity-90 font-light">View and manage all platform orders</p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                placeholder="Search by code, sender, recipient..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-white/60"
              />
            </div>
            <Button
              onClick={handleExport}
              className="bg-white text-primary hover:bg-white/90"
              disabled={filteredOrders.length === 0}
            >
              <Download className="w-5 h-5" />
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
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
                <div className="text-center py-8 text-muted-foreground">Loading orders...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? 'No orders found matching your search' : 'No orders yet'}
                </div>
              ) : (
              <div>
                {/* Desktop View */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-light">Code</TableHead>
                        <TableHead className="font-light">Product</TableHead>
                        <TableHead className="font-light">Shop</TableHead>
                        <TableHead className="font-light">Sender</TableHead>
                        <TableHead className="font-light">Recipient</TableHead>
                        <TableHead className="font-light">Amount</TableHead>
                        <TableHead className="font-light">Status</TableHead>
                        <TableHead className="font-light">Created</TableHead>
                        <TableHead className="font-light">Fulfilled</TableHead>
                        <TableHead className="font-light text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((order) => (
                        <TableRow
                          key={order.transaction_id}
                          className="cursor-pointer hover:bg-orange-50"
                          onClick={() => navigate(`/admin/orders/${order.transaction_id}`)}
                        >
                          <TableCell className="font-mono font-light">
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
                            {new Date(order.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="font-light">
                            {order.fulfilled_at
                              ? new Date(order.fulfilled_at).toLocaleDateString()
                              : '-'}
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
                          <span className="text-slate-800">{new Date(order.created_at).toLocaleDateString()}</span>
                        </div>
                        {order.fulfilled_at && (
                          <div className="col-span-2">
                            <span className="text-slate-400">Fulfilled: </span>
                            <span className="text-slate-800">{new Date(order.fulfilled_at).toLocaleDateString()}</span>
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
      </div>
    </div>
  );
}
