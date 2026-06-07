import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';

export interface Stats {
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

export interface RecentOrder {
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

export function useAdminDashboard() {
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

  const loadDashboardData = useCallback(async () => {
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
  }, []);

  const exportAllData = useCallback(async () => {
    try {
      setExporting(true);

      const { data, error } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          total_amount,
          currency,
          status,
          created_at,
          buyer:users!buyer_id(name, email, phone),
          shop_orders (
            claim_code,
            claim_status,
            recipient_name,
            recipient_phone,
            message,
            fulfilled_at,
            shop:shops(name, location),
            order_items (
              item:items(name)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const headers = [
        'Transaction ID',
        'Claim Code',
        'Item',
        'Shop',
        'Shop Location',
        'Sender Name',
        'Sender Email',
        'Sender Phone',
        'Recipient Name',
        'Recipient Phone',
        'Amount (ZMW)',
        'Currency',
        'TX Status',
        'Claim Status',
        'Message',
        'Created At',
        'Fulfilled At',
      ];

      const rows = (data || []).flatMap((txn: any) => {
        const buyer = txn.buyer as any;
        const shopOrders = txn.shop_orders || [];

        if (shopOrders.length === 0) {
          return [[
            txn.transaction_id,
            '',
            '',
            '',
            '',
            buyer?.name || '',
            buyer?.email || '',
            buyer?.phone || '',
            '',
            '',
            (txn.total_amount || 0).toFixed(2),
            txn.currency || 'ZMW',
            txn.status || '',
            '',
            '',
            txn.created_at || '',
            '',
          ]];
        }

        return shopOrders.map((so: any) => [
          txn.transaction_id,
          so.claim_code || '',
          so.order_items?.[0]?.item?.name || '',
          so.shop?.name || '',
          so.shop?.location || '',
          buyer?.name || '',
          buyer?.email || '',
          buyer?.phone || '',
          so.recipient_name || '',
          so.recipient_phone || '',
          (txn.total_amount || 0).toFixed(2),
          txn.currency || 'ZMW',
          txn.status || '',
          so.claim_status || '',
          so.message || '',
          txn.created_at || '',
          so.fulfilled_at || '',
        ]);
      });

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
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  return {
    stats,
    recentOrders,
    loading,
    exporting,
    exportAllData,
    reload: loadDashboardData,
  };
}
