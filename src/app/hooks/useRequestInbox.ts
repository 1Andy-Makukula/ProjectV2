// The bespoke-request inbox, for whoever is answering them.
//
// WHY THE STATE IS DERIVED AND NOT STORED
// ---------------------------------------
// The obvious move is a `request_status` column an admin ticks along. It was
// not taken, because every state except one is already a fact somewhere else:
//
//   nobody has quoted yet          no quotation on the thread
//   we have sent a price           latest quotation is `pending`
//   they said yes                  latest quotation is `accepted`
//   they said no                   latest quotation is `declined`
//   the price went stale           latest quotation is `expired`
//   finished                       conversation.is_closed
//
// A column duplicating those would be a second source of truth that drifts the
// first time somebody accepts a quote on their phone and nobody remembers to
// tick the board. Derived state cannot drift, and the one genuinely new fact
// -- "seen it, working on it, no price yet" -- is not worth a schema change
// while the admin screen is still deliberately minimal.
//
// The cost is one query for the quotations rather than a column read. At the
// volume a human can personally answer, that is not a cost.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';

export type RequestState = 'open' | 'quoted' | 'accepted' | 'declined' | 'expired' | 'closed';

export interface RequestRow {
  id: string;
  subject: string | null;
  requestTag: string | null;
  buyerName: string | null;
  lastMessageAt: string;
  createdAt: string;
  isClosed: boolean;
  state: RequestState;
  /** Whole days since the thread was opened. Drives the SLA warning. */
  ageDays: number;
}

/**
 * The row as PostgREST returns it. `buyer` comes back as an object for a
 * to-one embed, but the generated types model embeds loosely enough that
 * naming the shape here is clearer than casting at the call site.
 */
interface InboxRow {
  id: string;
  subject: string | null;
  request_tag: string | null;
  is_closed: boolean | null;
  last_message_at: string;
  created_at: string;
  buyer: { name: string | null } | { name: string | null }[] | null;
}

/** A to-one embed that the type says might be a list. Take the first. */
function buyerName(buyer: InboxRow['buyer']): string | null {
  if (!buyer) return null;
  return (Array.isArray(buyer) ? buyer[0]?.name : buyer.name) ?? null;
}

/** Working days promised for a quote. Mirrors REQUEST_SLA_DAYS. */
const SLA_DAYS = 3;

function dayssince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * The newest quotation decides the state, because a thread may carry several:
 * a declined price is often followed by a better one, and the board should
 * show where the conversation actually stands rather than where it started.
 */
function stateFrom(isClosed: boolean, latestStatus: string | undefined): RequestState {
  if (isClosed) return 'closed';
  switch (latestStatus) {
    case 'pending': return 'quoted';
    case 'accepted': return 'accepted';
    case 'declined': return 'declined';
    case 'expired': return 'expired';
    default: return 'open';
  }
}

/** An untouched request past the promise. The only thing worth alerting on. */
export function breachesSla(row: RequestRow): boolean {
  return row.state === 'open' && !row.isClosed && row.ageDays >= SLA_DAYS;
}

export function useRequestInbox() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // RLS returns every conversation to an admin, so this is filtered by
      // kind rather than by ownership.
      const { data: convs, error } = await supabase
        .from('conversations')
        .select('id, subject, request_tag, is_closed, last_message_at, created_at, buyer:buyer_id (name)')
        .eq('kind', 'admin_buyer')
        .order('last_message_at', { ascending: false })
        .limit(200);
      if (error) throw error;

      const ids = (convs ?? []).map((c: { id: string }) => c.id);

      // One query for every quotation on the visible threads, newest first,
      // rather than one per thread.
      const latest = new Map<string, string>();
      if (ids.length > 0) {
        const { data: quotes } = await supabase
          .from('quotations')
          .select('conversation_id, status, created_at')
          .in('conversation_id', ids)
          .order('created_at', { ascending: false });

        for (const q of (quotes ?? []) as { conversation_id: string; status: string }[]) {
          if (!latest.has(q.conversation_id)) latest.set(q.conversation_id, q.status);
        }
      }

      setRows(
        ((convs ?? []) as unknown as InboxRow[]).map((c): RequestRow => ({
          id: c.id,
          subject: c.subject ?? null,
          requestTag: c.request_tag ?? null,
          buyerName: buyerName(c.buyer),
          lastMessageAt: c.last_message_at,
          createdAt: c.created_at,
          isClosed: Boolean(c.is_closed),
          state: stateFrom(Boolean(c.is_closed), latest.get(c.id)),
          ageDays: dayssince(c.created_at),
        })),
      );
    } catch (err) {
      console.error('[useRequestInbox] load:', err);
      toast.error(parseAuthError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Tag a request. The database slugs it, so whatever is typed here is
   * normalised before it is stored and the local row is refreshed from the
   * returned value rather than from the input.
   */
  const setTag = useCallback(async (id: string, tag: string) => {
    setSaving(id);
    try {
      const { data, error } = await supabase
        .from('conversations')
        .update({ request_tag: tag.trim() === '' ? null : tag })
        .eq('id', id)
        .select('request_tag')
        .single();
      if (error) throw error;
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, requestTag: data?.request_tag ?? null } : r)),
      );
    } catch (err) {
      toast.error(parseAuthError(err));
    } finally {
      setSaving(null);
    }
  }, []);

  /**
   * How often each tag has been seen. The whole reason tagging exists: a tag
   * that keeps coming back is the catalogue telling you what to stock, or the
   * shop list telling you who to go and sign.
   */
  const tagCounts = rows.reduce<Record<string, number>>((acc, r) => {
    if (r.requestTag) acc[r.requestTag] = (acc[r.requestTag] ?? 0) + 1;
    return acc;
  }, {});

  return { rows, loading, saving, reload: load, setTag, tagCounts };
}
