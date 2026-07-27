import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';

export interface AppNotification {
  id: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  reference_id?: string | null;
}

/**
 * The single source of notifications for every role.
 *
 * This replaces two separate mechanisms: a slide-over that read the
 * notifications table but was reachable from one page, and a header that polled
 * `transactions` and inferred "something happened" by comparing array lengths
 * against a baseline held in component state — so it forgot everything on
 * reload and no merchant or admin ever saw any of it.
 *
 * One realtime subscription per signed-in user, no polling.
 */
export function useNotifications() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = profile?.id;

  // Kept in a ref so the realtime handler never closes over a stale list.
  const seen = useRef<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, message, type, is_read, created_at, reference_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const rows = (data ?? []) as AppNotification[];
      seen.current = new Set(rows.map((r) => r.id));
      setNotifications(rows);
    } catch (err) {
      console.error('[useNotifications] Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as AppNotification;
          if (seen.current.has(row.id)) return;
          seen.current.add(row.id);
          setNotifications((prev) => [row, ...prev].slice(0, 50));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    } catch (err) {
      console.error('[useNotifications] Failed to mark as read:', err);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unread.length === 0) return;

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await supabase.from('notifications').update({ is_read: true }).in('id', unread);
    } catch (err) {
      console.error('[useNotifications] Failed to mark all as read:', err);
    }
  }, [notifications]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  };
}
