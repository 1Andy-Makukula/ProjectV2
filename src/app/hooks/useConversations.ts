import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import type { Conversation, ViewerRole } from '../types/messaging';

/**
 * Thread list for whoever is signed in.
 *
 * RLS decides what comes back — a buyer sees their own, a merchant sees their
 * shop's, an admin sees everything — so this issues the same query for all
 * three roles rather than branching per role.
 */
export function useConversations(viewerRole: ViewerRole) {
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = profile?.id;

  const load = useCallback(async () => {
    if (!userId) {
      setConversations([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id, kind, buyer_id, shop_id, item_id, subject, is_closed,
          last_message_at, created_at,
          shop:shop_id (id, name, logo_url),
          buyer:buyer_id (id, name),
          item:item_id (id, name)
        `)
        .order('last_message_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = (data ?? []) as unknown as Conversation[];

      // Unread count per thread: messages newer than this viewer's read mark
      // that they did not send themselves.
      const { data: reads } = await supabase
        .from('conversation_reads')
        .select('conversation_id, last_read_at')
        .eq('user_id', userId);

      const readMap = new Map<string, string>(
        (reads ?? []).map((r: any) => [r.conversation_id, r.last_read_at]),
      );

      const withCounts = await Promise.all(
        rows.map(async (c) => {
          const lastRead = readMap.get(c.id);
          let query = supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', c.id)
            .neq('sender_id', userId);

          if (lastRead) query = query.gt('created_at', lastRead);

          const { count } = await query;
          return { ...c, unread_count: count ?? 0 };
        }),
      );

      setConversations(withCounts);
    } catch (err: any) {
      console.error('[useConversations] Failed to load threads:', err);
      toast.error(parseAuthError(err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // A new message anywhere reorders the list and changes unread counts.
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`conversation-list:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  return { conversations, loading, viewerRole, reload: load };
}
