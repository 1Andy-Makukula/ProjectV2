import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { parseAuthError } from '../../utils/errorParser';
import { toast } from 'sonner';

/**
 * Opens, or rejoins, this person's one thread with KithLy.
 *
 * The concierge desk: somebody wants a thing no shop on the platform lists, so
 * they ask, KithLy sources it and sends a quotation back down the same thread.
 * Everything after this point — messages, quotations, accepting one into the
 * cart — is the machinery that already serves buyer/merchant threads.
 *
 * `start_kithly_conversation` is idempotent per buyer, so asking twice lands
 * back in the conversation that already exists rather than opening a second
 * one for an admin to reconcile by hand. That makes this safe to wire to any
 * number of buttons across the app.
 */
export function useConciergeThread() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [opening, setOpening] = useState(false);

  /** @param subject what they are after, used as the thread's title. */
  const askKithly = useCallback(
    async (subject?: string) => {
      // Signing up is the first step of the ask, not a wall in front of it:
      // the thread belongs to a buyer, so there has to be one.
      if (!profile) {
        navigate('/signup');
        return;
      }

      setOpening(true);
      try {
        const { data, error } = await supabase.rpc('start_kithly_conversation', {
          p_subject: subject?.trim() || undefined,
        });
        if (error) throw error;
        navigate(`/messages?c=${data}`);
      } catch (err: unknown) {
        toast.error(parseAuthError(err));
      } finally {
        setOpening(false);
      }
    },
    [profile, navigate],
  );

  return { askKithly, opening };
}
