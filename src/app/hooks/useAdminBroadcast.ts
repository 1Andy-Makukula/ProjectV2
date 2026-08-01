import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { parseAuthError } from '../../utils/errorParser';
import { toast } from 'sonner';

export type BroadcastAudience = 'all' | 'sender' | 'merchant';

export function useAdminBroadcast() {
  const [message, setMessage] = useState('');
  const [type, setType] = useState('announcement');
  const [audience, setAudience] = useState<BroadcastAudience>('all');
  const [sending, setSending] = useState(false);

  const sendBroadcast = async (): Promise<number | null> => {
    if (!message.trim()) {
      toast.error('Message is required');
      return null;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.rpc('admin_broadcast_notification', {
        p_message: message.trim(),
        p_type: type,
        p_audience: audience,
      });
      if (error) throw error;

      const recipientCount = data as number;
      toast.success(`Sent to ${recipientCount} user${recipientCount === 1 ? '' : 's'}`);
      setMessage('');
      return recipientCount;
    } catch (err) {
      toast.error(parseAuthError(err));
      return null;
    } finally {
      setSending(false);
    }
  };

  return {
    message,
    setMessage,
    type,
    setType,
    audience,
    setAudience,
    sending,
    sendBroadcast,
  };
}
