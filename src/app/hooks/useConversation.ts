import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { uploadChatImage } from '../../utils/uploadImage';
import type { Conversation, Message, Quotation } from '../types/messaging';

const MESSAGE_SELECT = `
  id, conversation_id, sender_id, sender_role, message_type, body, image_url,
  quotation_id, created_at,
  quotation:quotation_id (
    id, conversation_id, shop_id, buyer_id, status, total_amount, notes,
    valid_until, target_execution_date, fulfillment_item_id, created_at,
    decline_reason,
    quotation_line_items (id, description, quantity, unit_price_zmw, sort_order)
  )
`;

/** One open thread, with its messages kept live. */
export function useConversation(conversationId?: string) {
  const { profile } = useAuth();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const userId = profile?.id;

  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [convRes, msgRes] = await Promise.all([
        supabase
          .from('conversations')
          .select(`
            id, kind, buyer_id, shop_id, item_id, subject, is_closed,
            last_message_at, created_at,
            shop:shop_id (id, name, logo_url),
            buyer:buyer_id (id, name),
            item:item_id (id, name)
          `)
          .eq('id', conversationId)
          .single(),
        supabase
          .from('messages')
          .select(MESSAGE_SELECT)
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true }),
      ]);

      if (convRes.error) throw convRes.error;
      if (msgRes.error) throw msgRes.error;

      setConversation(convRes.data as unknown as Conversation);
      const rows = (msgRes.data ?? []) as unknown as Message[];
      seen.current = new Set(rows.map((m) => m.id));
      setMessages(rows);

      await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
    } catch (err: any) {
      console.error('[useConversation] Failed to load thread:', err);
      toast.error(parseAuthError(err));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live messages. A quotation arrives as a message whose joined quotation is
  // not in the realtime payload, so those trigger a targeted refetch.
  useEffect(() => {
    if (!conversationId) return;

    // Unique per subscription: supabase-js reuses a channel when the topic
    // matches and then rejects `.on()` on it, so two mounts sharing a topic
    // would throw.
    const channel = supabase
      .channel(`conversation:${conversationId}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const row = payload.new as Message;
          if (seen.current.has(row.id)) return;
          seen.current.add(row.id);

          if (row.message_type === 'quotation') {
            const { data } = await supabase
              .from('messages')
              .select(MESSAGE_SELECT)
              .eq('id', row.id)
              .single();
            if (data) {
              setMessages((prev) => [...prev, data as unknown as Message]);
              return;
            }
          }

          setMessages((prev) => [...prev, row]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!conversationId || !body.trim()) return false;
      setSending(true);
      try {
        const { error } = await supabase.rpc('send_message', {
          p_conversation_id: conversationId,
          p_body: body.trim(),
          p_message_type: 'text',
        });
        if (error) throw error;
        return true;
      } catch (err: any) {
        console.error('[useConversation] Failed to send:', err);
        toast.error(parseAuthError(err));
        return false;
      } finally {
        setSending(false);
      }
    },
    [conversationId],
  );

  const sendImageMessage = useCallback(
    async (file: File) => {
      if (!conversationId) return false;
      setUploadingImage(true);
      try {
        // The storage PATH is persisted, not a URL. Chat attachments live in a
        // private bucket now (migration 20260903020000) and are viewed through
        // a signed URL minted per render -- a stored one would simply expire,
        // and a stored public one is the leak being closed.
        const { path } = await uploadChatImage(file, conversationId);
        const { error } = await supabase.rpc('send_message', {
          p_conversation_id: conversationId,
          p_message_type: 'image',
          p_image_url: path,
        });
        if (error) throw error;
        return true;
      } catch (err: any) {
        console.error('[useConversation] Failed to send image:', err);
        toast.error(parseAuthError(err));
        return false;
      } finally {
        setUploadingImage(false);
      }
    },
    [conversationId],
  );

  const refreshQuotation = useCallback((updated: Quotation) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.quotation_id === updated.id ? { ...m, quotation: { ...m.quotation, ...updated } } : m,
      ),
    );
  }, []);

  return {
    conversation,
    messages,
    loading,
    sending,
    uploadingImage,
    userId,
    sendMessage,
    sendImageMessage,
    refreshQuotation,
    reload: load,
  };
}
