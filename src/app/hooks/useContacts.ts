import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { useAuth } from '../../utils/auth/AuthContext';
import { validateAndFormatPhone } from '../../utils/phone';
import type {
  Contact,
  ContactDraft,
  ContactSuggestion,
  Occasion,
  OccasionDraft,
} from '../types/contacts';

const CONTACT_SELECT = `
  id, name, phone, relationship, source, notes, created_at,
  contact_occasions (id, contact_id, kind, label, recurrence, month, day, year, notes)
`;

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
    async (
      draft: ContactDraft,
      source: Contact['source'] = 'manual',
      firstOccasion?: OccasionDraft,
    ) => {
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
              notes: draft.notes?.trim() || null,
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

        const created = toContact(data as any);

        // Saving somebody and saying why in one step: the occasion is written
        // against the contact that was just made, so the pair either both
        // exist or the contact stands alone and can be added to later.
        if (firstOccasion) await writeOccasion(created.id, firstOccasion);

        toast.success(`${draft.name.trim()} saved`);
        await load();
        return created;
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
            notes: draft.notes?.trim() || null,
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

  const addOccasion = useCallback(
    async (contactId: string, draft: OccasionDraft) => {
      try {
        setBusy(true);
        await writeOccasion(contactId, draft);
        toast.success('Occasion saved');
        await load();
        return true;
      } catch (error: any) {
        console.error('[useContacts] addOccasion failed:', error);
        toast.error(parseAuthError(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const removeOccasion = useCallback(
    async (occasionId: string) => {
      try {
        setBusy(true);
        const { error } = await supabase
          .from('contact_occasions')
          .delete()
          .eq('id', occasionId);
        if (error) throw error;
        await load();
        return true;
      } catch (error: any) {
        console.error('[useContacts] removeOccasion failed:', error);
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
    addOccasion,
    removeOccasion,
    saveSuggestion,
  };
}

/**
 * Writes one occasion, shaped to its recurrence.
 *
 * The columns a recurrence does not use are nulled rather than left to chance:
 * the table's CHECK constraints reject a monthly occasion carrying a month, and
 * rightly so -- a stored value nothing reads is a value that will eventually be
 * read by mistake.
 */
async function writeOccasion(contactId: string, draft: OccasionDraft) {
  const annual = draft.recurrence === 'annual';
  const once = draft.recurrence === 'once';

  const { error } = await supabase.from('contact_occasions').insert([
    {
      contact_id: contactId,
      kind: draft.kind,
      label: draft.label?.trim() || null,
      recurrence: draft.recurrence,
      month: annual || once ? (draft.month ?? null) : null,
      day: draft.day,
      year: once ? (draft.year ?? null) : null,
      notes: draft.notes?.trim() || null,
    },
  ]);

  if (error) throw error;
}

function toContact(row: any): Contact {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    relationship: row.relationship ?? null,
    source: (row.source ?? 'manual') as Contact['source'],
    notes: row.notes ?? null,
    created_at: row.created_at,
    occasions: (row.contact_occasions ?? []).map(
      (occasion: any): Occasion => ({
        id: occasion.id,
        contact_id: occasion.contact_id,
        kind: occasion.kind,
        label: occasion.label ?? null,
        recurrence: occasion.recurrence,
        month: occasion.month ?? null,
        day: occasion.day,
        year: occasion.year ?? null,
        notes: occasion.notes ?? null,
      }),
    ),
  };
}
