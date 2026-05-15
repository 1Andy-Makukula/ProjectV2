// KithLy Header - Global Navigation

import { useState, useEffect } from 'react';
import { ShoppingCart, User, Menu, Gift, Bell, X } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart } from '../../hooks/useCart';
import { supabase } from '../../../utils/supabase/client';
import { Badge } from '../ui/badge';
import { SearchBar } from '../shared/SearchBar';
import { NotificationSlider } from '../shared/NotificationSlider';

interface HeaderProps {
  onMenuClick?: () => void;
  onCartClick?: () => void;
  onProfileClick?: () => void;
  onLogoClick?: () => void;
}

export function Header({
  onMenuClick,
  onCartClick,
  onProfileClick,
  onLogoClick,
}: HeaderProps) {
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const { getTotalItems } = useCart();
  const cartItemCount = getTotalItems();

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const fetchNotifications = async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, code, recipient_name, fulfilled_at, item:items(name), shop:shops(name)')
        .eq('sender_id', user.id)
        .eq('status', 'fulfilled')
        .order('fulfilled_at', { ascending: false })
        .limit(20);

      if (data) {
        setNotifications(data);
      }
    };

    fetchNotifications();

    const channel = supabase.channel('realtime-sender-notifications')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `sender_id=eq.${user.id}`
      }, (payload: any) => {
        if (payload.new.status === 'fulfilled' && payload.old.status !== 'fulfilled') {
          toast.success(`🎉 Gift collected! Your recipient just picked up their item.`);
          setUnreadCount(prev => prev + 1);
          fetchNotifications(); // Refresh the list to get joined item/shop data
        }
      }).subscribe();

    return () => { supabase.removeChannel(channel); }
  }, [isAuthenticated, user?.id]);

  return (
    <header className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-sm border-b border-border">
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

            <button
              onClick={onLogoClick}
              className="flex items-center gap-2 group"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                <Gift className="w-5 h-5 text-white" strokeWidth={1.5} />
              </div>
              <span className="text-xl font-light tracking-tight text-black group-hover:bg-gradient-to-r group-hover:from-[#F97316] group-hover:to-[#FB923C] group-hover:bg-clip-text group-hover:text-transparent transition-all">
                KithLy
              </span>
            </button>
          </div>

          {/* Center: Search (Desktop) */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <SearchBar />
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Notification Bell */}
            {isAuthenticated && (
              <button onClick={() => { setIsNotificationsOpen(true); setUnreadCount(0); }} className="relative p-2 text-gray-500 hover:text-gray-700 transition-colors">
                <Bell className="w-6 h-6" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                )}
              </button>
            )}

            {/* Cart */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onCartClick}
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
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onProfileClick}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                  <span className="text-white text-sm font-light">
                    {user?.full_name?.charAt(0) || 'U'}
                  </span>
                </div>
                <span className="hidden md:inline text-sm font-light">
                  {user?.full_name?.split(' ')[0]}
                </span>
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onProfileClick}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light"
              >
                <User className="w-4 h-4" strokeWidth={1.5} />
                <span className="hidden md:inline">Sign In</span>
              </motion.button>
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
