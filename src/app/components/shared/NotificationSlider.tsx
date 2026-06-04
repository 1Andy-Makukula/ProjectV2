import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { Bell, CheckCircle, X, ExternalLink, Gift, Send, ArrowRight, CheckCheck, Clock } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
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

// ---------------------------------------------------------------------------
// Live relative-time hook — ticks every 30 s while panel is open
// ---------------------------------------------------------------------------

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function relativeTime(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime();
  const diffS  = diffMs / 1_000;
  const diffM  = diffMs / 60_000;
  const diffH  = diffMs / 3_600_000;
  const diffD  = diffMs / 86_400_000;

  if (diffS < 10)  return 'Just now';
  if (diffM < 1)   return `${Math.floor(diffS)}s ago`;
  if (diffM < 60)  return `${Math.floor(diffM)}m ago`;
  if (diffH < 24)  return `${Math.floor(diffH)}h ago`;
  if (diffD < 7)   return `${Math.floor(diffD)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function absoluteTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationSlider({ isOpen, onClose }: NotificationSliderProps) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const now = useNow(isOpen);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [inboundGifts, setInboundGifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dismissedGiftIds, setDismissedGiftIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && profile?.id)    fetchNotifications();
    if (isOpen && profile?.phone) fetchInboundGifts();
  }, [isOpen, profile?.id, profile?.phone]);

  const fetchNotifications = async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications for slider:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchInboundGifts = async () => {
    if (!profile?.phone) return;
    try {
      const { data, error } = await supabase
        .from('shop_orders')
        .select(`
          shop_order_id,
          claim_code,
          claim_status,
          created_at,
          message,
          order_items(items(name)),
          transactions(users(name))
        `)
        .eq('recipient_phone', profile.phone)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      setInboundGifts(data || []);
    } catch (err) {
      console.error('Error fetching inbound gifts for slider:', err);
    }
  };

  const markAsRead = async (id: string, is_read: boolean) => {
    if (is_read) return;
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    try { await supabase.from('notifications').update({ is_read: true }).eq('id', id); } catch (e) { console.error(e); }
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.is_read).map(n => n.id);
    if (!unread.length) return;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    try { await supabase.from('notifications').update({ is_read: true }).in('id', unread); } catch (e) { console.error(e); }
  };

  const dismissNotification = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const dismissGift = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedGiftIds(prev => new Set(prev).add(id));
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-5 w-5 text-emerald-500" />;
      default:        return <Bell className="h-5 w-5 text-blue-400" />;
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const visibleGifts = inboundGifts.filter(g => !dismissedGiftIds.has(g.shop_order_id));

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
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-gray-900">Notifications</h2>
                {unreadCount > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    title="Mark all as read"
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    <span>All read</span>
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex flex-col gap-3 p-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex gap-3 animate-pulse">
                      <div className="h-8 w-8 rounded-full bg-slate-100 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-3/4 rounded bg-slate-100" />
                        <div className="h-2.5 w-1/3 rounded bg-slate-100" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">

                  {/* ── Gifts Received ── */}
                  {visibleGifts.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                        <Gift className="h-3.5 w-3.5 text-primary" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Gifts Received</p>
                      </div>
                      <AnimatePresence>
                        {visibleGifts.map((order) => {
                          const itemName = order.order_items?.[0]?.items?.name;
                          const senderName = order.transactions?.users?.name || 'Someone';
                          const isPending = order.claim_status === 'PENDING' || !order.claim_status;
                          const relTime = relativeTime(order.created_at, now);
                          const absTime = absoluteTime(order.created_at);

                          return (
                            <motion.div
                              key={order.shop_order_id}
                              layout
                              initial={{ opacity: 0, x: 30 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 60, height: 0, marginBottom: 0 }}
                              transition={{ duration: 0.22 }}
                              className="group relative flex cursor-pointer gap-4 px-4 py-3.5 hover:bg-orange-50/50 active:bg-orange-50 transition-colors"
                              onClick={() => { navigate(`/gift/${order.claim_code}`); onClose(); }}
                            >
                              {/* Icon */}
                              <div className="shrink-0 pt-0.5">
                                <div className={`h-9 w-9 rounded-full flex items-center justify-center shadow-sm ${
                                  isPending ? 'bg-gradient-to-br from-primary/20 to-primary/10' : 'bg-emerald-50'
                                }`}>
                                  <Gift className={`h-4 w-4 ${isPending ? 'text-primary' : 'text-emerald-500'}`} />
                                </div>
                              </div>

                              {/* Body */}
                              <div className="flex-1 min-w-0 pr-6">
                                <p className="text-sm text-gray-900 leading-snug">
                                  <span className="font-semibold">{senderName}</span>
                                  {' sent you '}
                                  {itemName ? <span className="font-semibold">{itemName}</span> : 'a gift'}
                                </p>

                                {/* Time row */}
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Clock className="h-3 w-3 text-slate-300 shrink-0" />
                                  <span className="text-xs text-slate-400 font-medium">{relTime}</span>
                                  <span className="text-slate-200">·</span>
                                  <span className="text-[11px] text-slate-300">{absTime}</span>
                                </div>

                                {isPending && (
                                  <div className="flex items-center gap-1.5 mt-2">
                                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                                      Ready to Claim
                                    </span>
                                    <ArrowRight className="h-3 w-3 text-primary" />
                                  </div>
                                )}
                              </div>

                              {/* Dismiss */}
                              <button
                                onClick={(e) => dismissGift(order.shop_order_id, e)}
                                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 rounded-full p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500 transition-all"
                                title="Dismiss"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* ── Activity / System ── */}
                  {notifications.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                        <Send className="h-3.5 w-3.5 text-slate-400" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Activity</p>
                      </div>
                      <AnimatePresence>
                        {notifications.map((notification) => {
                          const isExpanded = expandedId === notification.id;
                          const relTime = relativeTime(notification.created_at, now);
                          const absTime = absoluteTime(notification.created_at);

                          return (
                            <motion.div
                              key={notification.id}
                              layout
                              initial={{ opacity: 0, x: 20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 60, height: 0 }}
                              transition={{ duration: 0.2 }}
                              onClick={() => { markAsRead(notification.id, notification.is_read); toggleExpand(notification.id); }}
                              className={`group relative flex cursor-pointer gap-4 px-4 py-3.5 transition-colors ${
                                !notification.is_read
                                  ? 'bg-orange-50/60 hover:bg-orange-50'
                                  : 'hover:bg-gray-50/80'
                              }`}
                            >
                              {/* Unread dot */}
                              {!notification.is_read && (
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-primary" />
                              )}

                              <div className="shrink-0 pt-0.5">{getIcon(notification.type)}</div>

                              <div className="flex-1 min-w-0 pr-6">
                                <div className="flex items-start justify-between gap-2">
                                  <p className={`text-sm leading-snug ${!notification.is_read ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                                    {notification.message}
                                  </p>
                                  {!notification.is_read && (
                                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">New</span>
                                  )}
                                </div>

                                {/* Live timer row */}
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Clock className="h-3 w-3 text-slate-300 shrink-0" />
                                  <span className="text-xs text-slate-400 font-medium tabular-nums">{relTime}</span>
                                  <span className="text-slate-200">·</span>
                                  <span className="text-[11px] text-slate-300">{absTime}</span>
                                </div>

                                {/* Expandable reference */}
                                {isExpanded && notification.reference_id && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="mt-2"
                                  >
                                    <button
                                      onClick={(e) => { e.stopPropagation(); navigate(`/order/${notification.reference_id}`); onClose(); }}
                                      className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
                                    >
                                      View Details <ArrowRight className="h-3 w-3" />
                                    </button>
                                  </motion.div>
                                )}
                              </div>

                              {/* Per-item dismiss */}
                              <button
                                onClick={(e) => dismissNotification(notification.id, e)}
                                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 rounded-full p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500 transition-all"
                                title="Dismiss"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Empty state */}
                  {notifications.length === 0 && visibleGifts.length === 0 && (
                    <div className="flex flex-col items-center justify-center p-12 text-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 shadow-inner">
                        <Bell className="h-6 w-6 text-slate-300" />
                      </div>
                      <p className="text-sm font-semibold text-gray-900">All caught up</p>
                      <p className="mt-1 text-sm text-gray-400">No notifications right now.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 p-4">
              <Button
                variant="outline"
                className="w-full rounded-xl"
                onClick={() => { onClose(); navigate('/notifications'); }}
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
