// NotificationBell — the one notification surface, for every role.
//
// Drops into the customer header, the merchant dashboard and the admin page
// header. Before this existed, the notification panel was reachable from the
// storefront home page alone and no merchant or admin screen rendered one at
// all, so a merchant whose shop was approved had nowhere to find out.

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  MessageSquare,
  Clock,
  Megaphone,
  X,
} from 'lucide-react';
import { useNotifications, type AppNotification } from '../../hooks/useNotifications';
import { relativeTime, absoluteTime } from '../../../utils/relativeTime';

interface NotificationBellProps {
  /** Matches the bell to its surrounding chrome. */
  tone?: 'light' | 'dark';
  className?: string;
}

function iconFor(type: string) {
  switch (type) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2} />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-amber-500" strokeWidth={2} />;
    case 'rejection':
      return <XCircle className="h-4 w-4 text-red-500" strokeWidth={2} />;
    case 'message':
      return <MessageSquare className="h-4 w-4 text-blue-500" strokeWidth={2} />;
    case 'reminder':
      return <Clock className="h-4 w-4 text-orange-500" strokeWidth={2} />;
    case 'announcement':
    case 'promo':
      return <Megaphone className="h-4 w-4 text-purple-500" strokeWidth={2} />;
    default:
      return <Info className="h-4 w-4 text-slate-400" strokeWidth={2} />;
  }
}

/** Message notifications point at a thread; applications at the review queue; everything else at an order. */
function routeFor(notification: AppNotification): string | null {
  if (!notification.reference_id) return null;
  if (notification.type === 'message') return `/messages?c=${notification.reference_id}`;
  if (notification.type === 'merchant_application') return '/admin/shops';
  return null;
}

export function NotificationBell({ tone = 'dark', className = '' }: NotificationBellProps) {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Keep the relative timestamps honest while the panel is open.
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [isOpen]);

  const triggerColour =
    tone === 'light'
      ? 'text-white/80 hover:text-white hover:bg-white/10'
      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100';

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        // Same footprint as the header's other tools, so the cluster lines up.
        className={`relative grid size-9 place-items-center rounded-[var(--radius-pill)]
                    transition-colors ${triggerColour} ${className}`}
      >
        <Bell className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center
                       rounded-full bg-primary px-1 text-[10px] font-bold text-white shadow-sm"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Rendered into document.body, not in place.
          
          This drawer is `fixed` with z-50, which ought to be enough -- but the
          bell sits inside page headers that are `sticky top-0 z-10`, several
          of them also `backdrop-blur`. Both sticky-with-z-index and
          backdrop-filter establish a stacking context, and a descendant can
          never paint above its own stacking context no matter how high its
          z-index goes. So the drawer was confined to the header's z-10 layer
          and the page grid painted straight over it.
          
          Raising z-50 to z-[9999] would have changed nothing, which is the
          trap here. Escaping the ancestor is the only fix. */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm"
            />

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
                  <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
                  {unreadCount > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      All read
                    </button>
                  )}
                  <button
                    onClick={() => setIsOpen(false)}
                    className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Close notifications"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex flex-col gap-3 p-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex animate-pulse gap-3">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-slate-100" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-3/4 rounded bg-slate-100" />
                          <div className="h-2.5 w-1/3 rounded bg-slate-100" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 shadow-inner">
                      <Bell className="h-6 w-6 text-slate-300" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-slate-900">All caught up</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Payments, collections and messages will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    <AnimatePresence initial={false}>
                      {notifications.map((notification) => {
                        const route = routeFor(notification);
                        return (
                          <motion.button
                            key={notification.id}
                            layout
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 60, height: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={() => {
                              markAsRead(notification.id);
                              if (route) {
                                setIsOpen(false);
                                navigate(route);
                              }
                            }}
                            className={`relative flex w-full gap-4 px-4 py-3.5 text-left transition-colors ${
                              !notification.is_read
                                ? 'bg-orange-50/60 hover:bg-orange-50'
                                : 'hover:bg-slate-50/80'
                            } ${route ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            {!notification.is_read && (
                              <span className="absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary" />
                            )}

                            <div className="shrink-0 pt-0.5">{iconFor(notification.type)}</div>

                            <div className="min-w-0 flex-1">
                              <p
                                className={`text-sm leading-snug ${
                                  !notification.is_read
                                    ? 'font-medium text-slate-900'
                                    : 'text-slate-700'
                                }`}
                              >
                                {notification.message}
                              </p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <Clock className="h-3 w-3 shrink-0 text-slate-300" />
                                <span className="text-xs font-medium tabular-nums text-slate-400">
                                  {relativeTime(notification.created_at, now)}
                                </span>
                                <span className="text-slate-200">·</span>
                                <span className="text-[11px] text-slate-300">
                                  {absoluteTime(notification.created_at)}
                                </span>
                              </div>
                            </div>
                          </motion.button>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
