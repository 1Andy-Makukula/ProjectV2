import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingUp, Gift, Store, ArrowLeft, Sparkles, Bell, X } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { formatCurrency } from '../../../utils/currency';

function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-3 w-44" />
    </div>
  );
}

interface MetricCardProps {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | number;
  subLabel?: string;
}

function MetricCard({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  subLabel,
}: MetricCardProps) {
  return (
    <Card className="rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center gap-4 pb-2 space-y-0">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${iconBg}`}
        >
          <Icon className={`h-6 w-6 ${iconColor}`} />
        </div>
        <CardTitle className="text-sm font-medium text-muted-foreground leading-snug">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold text-gray-900 tracking-tight">
          {value}
        </p>
        {subLabel && (
          <p className="mt-1 text-xs text-muted-foreground">{subLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function CustomerDashboard() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [metricsLoading, setMetricsLoading] = useState(true);
  const [totalGenerosity, setTotalGenerosity] = useState(0);
  const [giftsDelivered, setGiftsDelivered] = useState(0);
  const [shopsSupported, setShopsSupported] = useState(0);

  const [dashboardNotifications, setDashboardNotifications] = useState<any[]>([]);
  const [latestNotification, setLatestNotification] = useState<any | null>(null);

  const fetchNotifications = async () => {
    if (!profile?.id) return;
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      setDashboardNotifications(data || []);
    } catch (err) {
      console.error('Error fetching dashboard notifications:', err);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      setDashboardNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  useEffect(() => {
    if (!profile?.id) return;
    fetchMetrics();
    fetchNotifications();

    const channel = supabase
      .channel('dashboard-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          const newNotif = payload.new;
          setDashboardNotifications((prev) => [newNotif, ...prev].slice(0, 5));
          setLatestNotification(newNotif);
          setTimeout(() => setLatestNotification(null), 5000); // Hide banner after 5s
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  const fetchMetrics = async () => {
    if (!profile?.id) return;

    setMetricsLoading(true);

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('amount, shop_id')
        .eq('sender_id', profile.id);

      if (error) throw error;

      const rows = data ?? [];
      setTotalGenerosity(rows.reduce((sum: number, order: any) => sum + (order.amount ?? 0), 0));
      setGiftsDelivered(rows.length);
      setShopsSupported(new Set(rows.map((order: any) => order.shop_id)).size);
    } catch (err) {
      console.error('[CustomerDashboard] fetchMetrics error:', err);
      setTotalGenerosity(0);
      setGiftsDelivered(0);
      setShopsSupported(0);
    } finally {
      setMetricsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              id="dashboard-back"
              variant="ghost"
              size="icon"
              onClick={() => navigate('/home')}
              className="shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Impact Dashboard
              </h1>
              <p className="text-xs text-muted-foreground">
                A snapshot of your generosity
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        <AnimatePresence>
          {latestNotification && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg shadow-sm flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-green-600" />
                <p className="text-sm font-medium text-green-800">
                  {latestNotification.message}
                </p>
              </div>
              <button 
                onClick={() => setLatestNotification(null)}
                className="text-green-600 hover:bg-green-100 p-1 rounded-full transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              Your Giving
            </span>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">
            Your Giving at a Glance
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Every gift you send puts money directly into the hands of local merchants and
            brings joy to someone across the distance.
          </p>
        </motion.div>

        <div id="metrics-grid" className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {metricsLoading ? (
            <>
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </>
          ) : (
            <>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <MetricCard
                  icon={TrendingUp}
                  iconBg="bg-orange-100"
                  iconColor="text-orange-600"
                  label="Total Generosity"
                  value={formatCurrency(totalGenerosity, 'ZMW')}
                  subLabel="Cumulative value of gifts sent"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <MetricCard
                  icon={Gift}
                  iconBg="bg-primary/10"
                  iconColor="text-primary"
                  label="Gifts Delivered"
                  value={giftsDelivered}
                  subLabel="Successful deliveries to recipients"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 }}
              >
                <MetricCard
                  icon={Store}
                  iconBg="bg-amber-100"
                  iconColor="text-amber-600"
                  label="Local Shops Supported"
                  value={shopsSupported}
                  subLabel="Unique merchants benefited"
                />
              </motion.div>
            </>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center"
        >
          <Gift className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm font-medium text-gray-400">
            Transaction history coming soon
          </p>
          <p className="mt-1 text-xs text-gray-300">
            A detailed record of every gift will appear here
          </p>
        </motion.div>
      </div>
    </div>
  );
}
