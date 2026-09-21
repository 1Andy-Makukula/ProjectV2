// Opening a conversation that ends in a quotation.
//
// Two doors into the same room, and the room was already built. `conversations`,
// `messages`, `quotations` and `quotation_line_items` have existed for months,
// the QuotationBuilder and QuotationCard are written, and an accepted quotation
// already reaches checkout. What was missing was any way for a customer to
// start one:
//
//   ask a shop    `start_conversation(shop_id, item_id, subject)` -- existed,
//                 but was reachable from exactly one place, the bottom of an
//                 item's detail page.
//   ask KithLy    `start_kithly_conversation(subject)` -- written on 16 Sep,
//                 applied on 20 Sep, and called by nothing at all. So a buyer
//                 could not reach us even though the machinery was live.
//
// Both are wrapped here rather than in a component so the two doors cannot
// drift apart on the things that are easy to get inconsistent: the signed-out
// redirect, the in-flight guard against double-taps, error surfacing, and where
// you land afterwards.

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { parseAuthError } from '../../utils/errorParser';

/**
 * What we promise, in days, for a bespoke quote.
 *
 * WORKING days, and the copy says so. In Zambia a Saturday request answered on
 * Tuesday is either inside or outside the promise depending entirely on which
 * kind of day was meant, and leaving that to the reader is how a promise
 * becomes an argument.
 *
 * It is three days to a QUOTE, never to a delivery. Every string below is
 * written so it cannot be read the other way.
 */
export const REQUEST_SLA_DAYS = 3;

export const REQUEST_SLA_LINE =
  `We reply with a price within ${REQUEST_SLA_DAYS} working days. ` +
  'Nothing is ordered and nothing is charged until you accept it.';

export function useRequestThread() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [opening, setOpening] = useState(false);

  const enter = useCallback(
    async (rpc: 'start_kithly_conversation' | 'start_conversation', args: Record<string, unknown>) => {
      // Signed out, the thread cannot be attributed to anybody -- both RPCs
      // raise on a null auth.uid(). Send them to sign up rather than letting
      // the database refuse and surfacing that as an error.
      if (!profile) {
        navigate('/signup');
        return;
      }
      if (opening) return;

      setOpening(true);
      try {
        const { data, error } = await supabase.rpc(rpc, args);
        if (error) throw error;
        navigate(`/messages?c=${data}`);
      } catch (err) {
        toast.error(parseAuthError(err));
      } finally {
        setOpening(false);
      }
    },
    [navigate, profile, opening],
  );

  /**
   * Ask KithLy for something the catalogue does not carry.
   *
   * Reuses the person's one open desk rather than starting a second thread --
   * there is only ever one counterparty here, so the thread is the
   * relationship and splitting it would lose the history.
   */
  const askKithly = useCallback(
    (subject?: string) => enter('start_kithly_conversation', { p_subject: subject ?? null }),
    [enter],
  );

  /** Ask a specific shop, optionally about a specific item. */
  const askShop = useCallback(
    (shopId: string, options?: { itemId?: string; subject?: string }) =>
      enter('start_conversation', {
        p_shop_id: shopId,
        p_item_id: options?.itemId ?? null,
        p_subject: options?.subject ?? null,
      }),
    [enter],
  );

  return { askKithly, askShop, opening };
}
