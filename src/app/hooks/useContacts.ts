import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { useAuth } from '../../utils/auth/AuthContext';
import { validateAndFormatPhone } from '../../utils/phone';
import type { Contact, ContactDraft, ContactSuggestion } from '../types/contacts';

const CONTACT_SELECT =
  'id, name, phone, relationship, birth_month, birth_day, birth_year, source, notes, created_at';

/**
 * The people this person sends things to.
 *
 * Two ways in, both of them consented by construction:
 *
 *   * `suggestions` — recipients from the caller's own order history. They
 *     typed these names and numbers themselves, at checkout, to send somebody
 *     a gift. Offering them back is not an import; it is showing someone what
 *     they already wrote down.
 *   * `create` — typed by hand.
 *
 * Nothing here touches a phone's address book, and there is no bulk path.
 */
export function useContacts() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      setContacts([]);
      setSuggestions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [saved, sent] = await Promise.all([
        supabase
          .from('contacts')
          .select(CONTACT_SELECT)
          .eq('owner_user_id', user.id)
          .order('name', { ascending: true }),
        // Everyone this person has ever sent to. RLS scopes shop_orders to the
        // buyer's own transactions, so this can only ever return their own.
        supabase
          .from('shop_orders')
          .select('recipient_name, recipient_phone, created_at, transactions!inner(buyer_id)')
          .eq('transactions.buyer_id', user.id)
          .not('recipient_phone', 'is', null)
          .order('created_at', { ascending: false })
          .limit(60),
      ]);

      if (saved.error) throw saved.error;

      const rows = (saved.data ?? []) as any[];
      setContacts(rows.map(toContact));

      const known = new Set(rows.map((row) => row.phone));
      const seen = new Map<string, ContactSuggestion>();

      for (const order of (sent.data ?? []) as any[]) {
        const { isValid, formatted } = validateAndFormatPhone(order.recipient_phone ?? '');
        const phone = isValid ? formatted : (order.recipient_phone ?? '').trim();
        if (!phone || known.has(phone)) continue;

        // Most recent name wins: people rename "Mum" from "Mother" over time,
        // and the newest spelling is the one they are using now.
        const existing = seen.get(phone);
        if (existing) {
          existing.timesSent += 1;
          continue;
        }

        seen.set(phone, {
          name: (order.recipient_name ?? '').trim() || phone,
          phone,
          lastSentAt: order.created_at,
          timesSent: 1,
        });
      }

      setSuggestions([...seen.values()]);
    } catch (error: any) {
      console.error('[useContacts] load failed:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (draft: ContactDraft, source: Contact['source'] = 'manual') => {
      if (!user?.id) {
        toast.error('Sign in to save contacts');
        return null;
      }

      const { isValid, formatted } = validateAndFormatPhone(draft.phone);
      if (!isValid) {
        toast.error('That phone number does not look right');
        return null;
      }

      try {
        setBusy(true);
        const { data, error } = await supabase
          .from('contacts')
          .insert([
            {
              owner_user_id: user.id,
              name: draft.name.trim(),
              phone: formatted,
              relationship: draft.relationship?.trim() || null,
              birth_month: draft.birthMonth ?? null,
              birth_day: draft.birthDay ?? null,
              // A year without a day would fail the CHECK, and is meaningless
              // anyway — it is the day that gets somebody a present.
              birth_year: draft.birthMonth ? (draft.birthYear ?? null) : null,
              source,
            },
          ])
          .select(CONTACT_SELECT)
          .single();

        if (error) {
          // contacts_owner_phone_idx — the same number is the same person.
          if (error.code === '23505') {
            toast.info('You already have that person saved');
            return null;
          }
          throw error;
        }

        toast.success(`${draft.name.trim()} saved`);
        await load();
        return toContact(data as any);
      } catch (error: any) {
        console.error('[useContacts] create failed:', error);
        toast.error(parseAuthError(error));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [user?.id, load],
  );

  const update = useCallback(
    async (id: string, draft: ContactDraft) => {
      const { isValid, formatted } = validateAndFormatPhone(draft.phone);
      if (!isValid) {
        toast.error('That phone number does not look right');
        return false;
      }

      try {
        setBusy(true);
        const { error } = await supabase
          .from('contacts')
          .update({
            name: draft.name.trim(),
            phone: formatted,
            relationship: draft.relationship?.trim() || null,
            birth_month: draft.birthMonth ?? null,
            birth_day: draft.birthDay ?? null,
            birth_year: draft.birthMonth ? (draft.birthYear ?? null) : null,
          })
          .eq('id', id);

        if (error) throw error;
        toast.success('Contact updated');
        await load();
        return true;
      } catch (error: any) {
        console.error('[useContacts] update failed:', error);
        toast.error(parseAuthError(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        setBusy(true);
        const { error } = await supabase.from('contacts').delete().eq('id', id);
        if (error) throw error;
        toast.success('Contact removed');
        await load();
        return true;
      } catch (error: any) {
        console.error('[useContacts] remove failed:', error);
        toast.error(parseAuthError(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /** Accepts one of the suggestions above, as-is. */
  const saveSuggestion = useCallback(
    (suggestion: ContactSuggestion) =>
      create({ name: suggestion.name, phone: suggestion.phone }, 'order'),
    [create],
  );

  return {
    contacts,
    suggestions,
    loading,
    busy,
    reload: load,
    create,
    update,
    remove,
    saveSuggestion,
  };
}

function toContact(row: any): Contact {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    relationship: row.relationship ?? null,
    birthMonth: row.birth_month ?? null,
    birthDay: row.birth_day ?? null,
    birthYear: row.birth_year ?? null,
    source: (row.source ?? 'manual') as Contact['source'],
    notes: row.notes ?? null,
    created_at: row.created_at,
  };
}
