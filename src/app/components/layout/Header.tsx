// KithLy Header - Global Navigation

import { useState, useEffect } from 'react';
import { ShoppingCart, User, Menu, Gift, Bell, X, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart } from '../../hooks/useCart';
import { supabase } from '../../../lib/supabaseClient';
import { Badge } from '../ui/badge';
import { SearchBar } from '../shared/SearchBar';

interface HeaderProps {
  onMenuClick?: () => void;
  onProfileClick?: () => void;
  onLogoClick?: () => void;
}

export function Header({
  onMenuClick,
  onProfileClick,
  onLogoClick,
}: HeaderProps) {
  const { user, profile } = useAuth();
  const isAuthenticated = !!user;
  const { getTotalItems, setCartSliderOpen } = useCart();
  const cartItemCount = getTotalItems();

  // ── Role-based hub link ──────────────────────────────────────
  const hubHref =
    profile?.role === 'admin' ? '/admin'
    : profile?.role === 'merchant' ? '/merchant'
    : '/dashboard';
  const hubLabel =
    profile?.role === 'admin' ? 'Admin Hub'
    : profile?.role === 'merchant' ? 'Merchant Hub'
    : 'Dashboard';

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const fetchNotifications = async () => {
      // V2 Schema: Query transactions joined with shop_orders
      const { data } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          created_at,
          shop_orders!inner (
            shop_order_id,
            claim_code,
            recipient_name,
            fulfilled_at,
            shop:shop_id (name),
            order_items (
              item:item_id (name)
            )
          )
        `)
        .eq('buyer_id', user.id)
        .in('shop_orders.claim_status', ['FULFILLED', 'PARTIAL_FULFILLMENT'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (data) {
        // Flatten to match legacy UI expectation
        const formatted = data.flatMap((tx: any) => 
          tx.shop_orders.map((so: any) => ({
            id: so.shop_order_id,
            code: so.claim_code,
            recipient_name: so.recipient_name,
            fulfilled_at: so.fulfilled_at || tx.created_at,
            item: { name: so.order_items?.[0]?.item?.name || 'Gift' },
            shop: { name: so.shop?.name || 'Shop' }
          }))
        );
        
        // Check if we have new notifications by comparing lengths (simple heuristic)
        if (notifications.length > 0 && formatted.length > notifications.length) {
          toast.success(`🎉 Gift collected! Your recipient just picked up their item.`);
          setUnreadCount(prev => prev + 1);
        }
        
        setNotifications(formatted);
      }
    };

    fetchNotifications();

    // Notify and Re-fetch Pattern (User Approved)
    const channel = supabase.channel('header-notifications')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `buyer_id=eq.${user.id}`
      }, () => {
        fetchNotifications();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transaction_events',
        filter: `event_type=eq.CLAIM_VERIFIED`
      }, () => {
        // Catch fulfillments (no buyer_id filter available on this table, but fetch is safe)
        fetchNotifications();
      }).subscribe();

    return () => { supabase.removeChannel(channel); }
  }, [isAuthenticated, user?.id]);

  return (
    <header className="sticky top-0 z-50 w-full bg-white/60 backdrop-blur-md border-b border-white/20">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Left: Menu + Logo */}
          <div className="flex items-center gap-4">
            <button
              onClick={onMenuClick}
              className="md:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Menu"
            >
              <Menu className="w-5 h-5" strokeWidth={1.5} />
            </button>

            <Link
              to={isAuthenticated ? hubHref : '/'}
              className="flex items-center gap-2 group"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                <Gift className="w-5 h-5 text-white" strokeWidth={1.5} />
              </div>
              <span className="text-xl font-light tracking-tight text-black group-hover:bg-gradient-to-r group-hover:from-[#F97316] group-hover:to-[#FB923C] group-hover:bg-clip-text group-hover:text-transparent transition-all">
                KithLy
              </span>
            </Link>
          </div>

          {/* Center: Search (Desktop) */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <SearchBar />
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Dashboard Link */}
            {isAuthenticated && (
              <Link
                to={hubHref}
                className="hidden md:inline-flex items-center px-3 py-1.5 text-sm font-light text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors tracking-wide"
              >
                {hubLabel}
              </Link>
            )}

            {/* Notification Bell */}
            {isAuthenticated && (
              <button onClick={() => { setIsNotificationsOpen(true); setUnreadCount(0); }} className="relative p-2 text-gray-500 hover:text-gray-700 transition-colors">
                <Bell className="w-6 h-6" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                )}
              </button>
            )}

            {/* Support */}
            <Link
              to="/support"
              className="p-2 text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Support"
            >
              <HelpCircle className="w-6 h-6" strokeWidth={1.5} />
            </Link>

            {/* Cart */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setCartSliderOpen(true)}
              className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Shopping cart"
            >
              <ShoppingCart className="w-5 h-5" strokeWidth={1.5} />
              {cartItemCount > 0 && (
                <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white text-xs">
                  {cartItemCount}
                </Badge>
              )}
            </motion.button>

            {/* Profile */}
            {isAuthenticated ? (
              <Link
                to="/settings"
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                  <span className="text-white text-sm font-light">
                    {(user?.user_metadata?.full_name || profile?.name)?.charAt(0) || 'U'}
                  </span>
                </div>
                <span className="hidden md:inline text-sm font-light">
                  {(user?.user_metadata?.full_name || profile?.name)?.split(' ')[0]}
                </span>
              </Link>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light transition-transform hover:scale-105 active:scale-95"
              >
                <User className="w-4 h-4" strokeWidth={1.5} />
                <span className="hidden md:inline">Sign In</span>
              </Link>
            )}
          </div>
        </div>

        {/* Mobile Search */}
        <div className="md:hidden pb-3">
          <SearchBar />
        </div>
      </div>

      {isNotificationsOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-80 bg-white shadow-2xl border-l flex flex-col transform transition-transform duration-300">
          <div className="flex items-center justify-between p-4 border-b bg-gray-50">
            <h3 className="font-semibold text-gray-800">Notifications</h3>
            <button onClick={() => setIsNotificationsOpen(false)}><X className="w-5 h-5 text-gray-500" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {notifications.length === 0 ? (
              <p className="text-sm text-gray-500 text-center mt-10">No recent activity.</p>
            ) : (
              notifications.map(notif => (
                <div key={notif.id} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                  <p className="text-sm text-green-800">
                    <strong>{notif.recipient_name}</strong> collected <strong>{notif.item?.name}</strong> from <strong>{notif.shop?.name}</strong>.
                  </p>
                  <p className="text-xs text-green-600 mt-1 mt-1">
                    {new Date(notif.fulfilled_at).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </header>
  );
}
