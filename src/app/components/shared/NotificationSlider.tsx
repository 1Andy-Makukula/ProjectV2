import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { Bell, CheckCircle, X, ExternalLink } from 'lucide-react';
import { supabase } from '../../../utils/supabase/client';
import { useAuth } from '../../../utils/auth/AuthContext';
import { Button } from '../ui/button';

export interface AppNotification {
  id: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  reference_id?: string;
}

interface NotificationSliderProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationSlider({ isOpen, onClose }: NotificationSliderProps) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && profile?.id) {
      fetchNotifications();
    }
  }, [isOpen, profile?.id]);

  const fetchNotifications = async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications for slider:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string, is_read: boolean) => {
    if (is_read) return;
    try {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      default:
        return <Bell className="h-5 w-5 text-blue-500" />;
    }
  };

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffH = diffMs / 3_600_000;
    const diffD = diffMs / 86_400_000;

    if (diffH < 1) {
      const mins = Math.floor(diffMs / 60_000);
      return mins <= 0 ? 'Just now' : `${mins}m ago`;
    }
    if (diffH < 24) return `${Math.floor(diffH)}h ago`;
    if (diffD < 7) return `${Math.floor(diffD)}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex justify-center p-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"></div>
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
                    <Bell className="h-6 w-6 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-900">No notifications yet</p>
                  <p className="mt-1 text-sm text-gray-500">We'll let you know when there's an update.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => markAsRead(notification.id, notification.is_read)}
                      className={`flex cursor-pointer gap-4 p-4 transition-colors hover:bg-gray-50 ${
                        !notification.is_read ? 'bg-orange-50/50' : ''
                      }`}
                    >
                      <div className="shrink-0 pt-1">{getIcon(notification.type)}</div>
                      <div className="flex-1">
                        <div className="flex justify-between gap-2">
                          <p className="text-sm text-gray-900">{notification.message}</p>
                          {!notification.is_read && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                              New
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {formatDate(notification.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t p-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  onClose();
                  navigate('/notifications');
                }}
              >
                View All Notifications
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
