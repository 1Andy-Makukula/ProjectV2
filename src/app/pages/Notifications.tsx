// KithLy Notifications Center

import { motion } from 'motion/react';
import { Bell, Gift, CheckCircle, AlertCircle, Info, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Badge } from '../components/ui/badge';

interface Notification {
  id: string;
  type: 'success' | 'info' | 'warning';
  title: string;
  message: string;
  time: string;
  read: boolean;
}

const mockNotifications: Notification[] = [
  {
    id: '1',
    type: 'success',
    title: 'Gift Redeemed',
    message: 'Your gift "Shoprite Voucher" was successfully redeemed at Garden Mall',
    time: '2 hours ago',
    read: false,
  },
  {
    id: '2',
    type: 'info',
    title: 'New Gift Received',
    message: 'You received a new gift worth ZMW 250. Check your vault!',
    time: '5 hours ago',
    read: false,
  },
  {
    id: '3',
    type: 'warning',
    title: 'Gift Expiring Soon',
    message: 'Your gift "Cafe Latte Voucher" expires in 2 days',
    time: '1 day ago',
    read: true,
  },
  {
    id: '4',
    type: 'success',
    title: 'Profile Verified',
    message: 'Your profile has been verified. You now have full access to KithLy',
    time: '2 days ago',
    read: true,
  },
];

export function Notifications() {
  const navigate = useNavigate();
  const unreadCount = mockNotifications.filter(n => !n.read).length;

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-600" strokeWidth={1.5} />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-orange-600" strokeWidth={1.5} />;
      case 'info':
        return <Info className="w-5 h-5 text-blue-600" strokeWidth={1.5} />;
    }
  };

  const getBgColor = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return 'bg-green-50';
      case 'warning':
        return 'bg-orange-50';
      case 'info':
        return 'bg-blue-50';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8 max-w-3xl">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm font-light text-muted-foreground hover:text-black mb-6"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
          Back
        </button>

        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
              <Bell className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-3xl font-light text-black">Notifications</h1>
              {unreadCount > 0 && (
                <p className="text-sm font-light text-muted-foreground">
                  {unreadCount} unread
                </p>
              )}
            </div>
          </div>

          {unreadCount > 0 && (
            <button className="text-sm font-light text-[#F97316] hover:underline">
              Mark all read
            </button>
          )}
        </div>

        <div className="space-y-3">
          {mockNotifications.map((notification, idx) => (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`bg-white rounded-[1rem] p-4 border ${
                notification.read ? 'border-border' : 'border-[#F97316]/20 shadow-sm'
              }`}
            >
              <div className="flex gap-4">
                <div className={`w-10 h-10 rounded-xl ${getBgColor(notification.type)} flex items-center justify-center flex-shrink-0`}>
                  {getIcon(notification.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-medium text-black">{notification.title}</h3>
                    {!notification.read && (
                      <div className="w-2 h-2 rounded-full bg-[#F97316] flex-shrink-0 mt-1.5" />
                    )}
                  </div>
                  <p className="text-sm font-light text-muted-foreground mb-2">
                    {notification.message}
                  </p>
                  <p className="text-xs font-light text-muted-foreground">
                    {notification.time}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {mockNotifications.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gray-100 flex items-center justify-center">
              <Bell className="w-10 h-10 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <h3 className="text-xl font-light text-black mb-2">No notifications</h3>
            <p className="text-sm font-light text-muted-foreground">
              You're all caught up!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
