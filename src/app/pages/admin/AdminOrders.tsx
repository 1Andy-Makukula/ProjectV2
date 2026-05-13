import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Search, Download, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { supabase } from '../../../utils/supabase/client';
import { formatCurrency } from '../../../utils/currency';
import { callServer } from '../../../utils/server';
import { toast } from 'sonner';

interface Order {
  id: string;
  code: string;
  item_name: string;
  item_image_url: string | null;
  shop_name: string;
  sender_name: string;
  recipient_name: string;
  amount: number;
  status: string;
  created_at: string;
  fulfilled_at: string | null;
}

type StatusFilter = 'all' | 'pending_payment' | 'payment_submitted' | 'paid' | 'fulfilled' | 'expired';

export function AdminOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    filterOrders();
  }, [orders, searchQuery, statusFilter]);

  const loadOrders = async () => {
    try {
      setLoading(true);

      const { data: ordersData, error } = await supabase
        .from('orders')
        .select('*, items(name, image_url), shops(name), users!sender_id(name)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedOrders = (ordersData || []).map((order: any) => ({
        id: order.id,
        code: order.code,
        item_name: order.items?.name || 'N/A',
        item_image_url: order.items?.image_url || null,
        shop_name: order.shops?.name || 'N/A',
        sender_name: order.users?.name || 'N/A',
        recipient_name: order.recipient_name,
        amount: order.amount,
        status: order.status,
        created_at: order.created_at,
        fulfilled_at: order.fulfilled_at,
      }));

      setOrders(formattedOrders);
    } catch (error: any) {
      console.error('Error loading orders:', error);
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const filterOrders = () => {
    let filtered = orders;

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(order => order.status === statusFilter);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(order =>
        order.code.toLowerCase().includes(query) ||
        order.sender_name.toLowerCase().includes(query) ||
        order.recipient_name.toLowerCase().includes(query) ||
        order.item_name.toLowerCase().includes(query) ||
        order.shop_name.toLowerCase().includes(query)
      );
    }

    setFilteredOrders(filtered);
  };

  const exportToCSV = () => {
    const headers = ['Code', 'Item', 'Shop', 'Sender', 'Recipient', 'Amount', 'Status', 'Created', 'Fulfilled'];
    const rows = filteredOrders.map(order => [
      order.code,
      order.item_name,
      order.shop_name,
      order.sender_name,
      order.recipient_name,
      (order.amount / 100).toFixed(2),
      order.status,
      new Date(order.created_at).toLocaleDateString(),
      order.fulfilled_at ? new Date(order.fulfilled_at).toLocaleDateString() : 'N/A',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kithly-orders-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Orders exported to CSV');
  };

  const updateOrderStatus = async (
    orderId: string,
    currentStatus: string,
    newStatus: Exclude<StatusFilter, 'all'>,
  ) => {
    if (currentStatus === newStatus) return;

    try {
      setActionOrderId(orderId);

      if (newStatus === 'paid') {
        await callServer(`/orders/${orderId}/confirm-payment`);
      } else {
        const { error } = await supabase
          .from('orders')
          .update({
            status: newStatus,
            fulfilled_at: newStatus === 'fulfilled' ? new Date().toISOString() : null,
          })
          .eq('id', orderId);

        if (error) throw error;
      }

      toast.success(`Order marked as ${newStatus.split('_').join(' ')}`);
      await loadOrders();
    } catch (error: any) {
      console.error('Error updating order:', error);
      toast.error(error.message || 'Failed to update order');
    } finally {
      setActionOrderId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'fulfilled':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'paid':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'payment_submitted':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'pending_payment':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'expired':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const getStatusCount = (status: StatusFilter) => {
    if (status === 'all') return orders.length;
    return orders.filter(o => o.status === status).length;
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
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-white/60"
              />
            </div>
            <Button
              onClick={exportToCSV}
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
        <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <TabsList className="grid w-full grid-cols-6 mb-6">
            <TabsTrigger value="all" className="font-light">
              All ({getStatusCount('all')})
            </TabsTrigger>
            <TabsTrigger value="pending_payment" className="font-light">
              Pending ({getStatusCount('pending_payment')})
            </TabsTrigger>
            <TabsTrigger value="payment_submitted" className="font-light">
              Submitted ({getStatusCount('payment_submitted')})
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
                <div className="overflow-x-auto">
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
                          key={order.id}
                          className="cursor-pointer hover:bg-orange-50"
                          onClick={() => navigate(`/admin/orders/${order.id}`)}
                        >
                          <TableCell className="font-mono font-light">{order.code}</TableCell>
                          <TableCell className="font-light">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100">
                                {order.item_image_url ? (
                                  <img
                                    src={order.item_image_url}
                                    alt={order.item_name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <Package className="h-5 w-5 text-gray-400" />
                                  </div>
                                )}
                              </div>
                              <span>{order.item_name}</span>
                            </div>
                          </TableCell>
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
                          <TableCell className="font-light">
                            {order.fulfilled_at ? new Date(order.fulfilled_at).toLocaleDateString() : '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              {order.status === 'payment_submitted' && (
                                <Button
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    updateOrderStatus(order.id, order.status, 'paid');
                                  }}
                                  disabled={actionOrderId === order.id}
                                >
                                  Mark as Paid
                                </Button>
                              )}
                              {!['fulfilled', 'expired'].includes(order.status) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    updateOrderStatus(order.id, order.status, 'expired');
                                  }}
                                  disabled={actionOrderId === order.id}
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
              )}
            </CardContent>
          </Card>
        </Tabs>
      </div>
    </div>
  );
}
