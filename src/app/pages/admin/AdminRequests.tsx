// AdminRequests — the bespoke-request desk, at '/admin/requests'
//
// Everything a customer asks us for that the catalogue does not carry arrives
// here. The thread and the quotation it ends in already existed; this is the
// board that stops them getting lost, and the place tagging happens.
//
// DELIBERATELY SMALL. The full tagging interface -- thresholds, prompts to
// promote a tag into a bundle, onboarding suggestions -- is deferred to the
// end of the build sequence by agreement. What is NOT deferred is capturing
// the tag, because a counter built later against untagged history answers
// nothing. So this screen does two jobs and stops: show what is waiting, and
// let it be tagged.
//
// Ordered by what is owed rather than by recency: an unanswered request past
// the three-day promise, then unanswered, then everything else. A list sorted
// newest-first buries the thing you are late on under the thing that just
// arrived.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, MessageSquare, Tag as TagIcon } from 'lucide-react';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { Button } from '../../components/ui/button';
import { useRequestInbox, breachesSla, type RequestRow, type RequestState } from '../../hooks/useRequestInbox';

const STATE_LABEL: Record<RequestState, string> = {
  open: 'Needs a price',
  quoted: 'Quoted, waiting',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Quote expired',
  closed: 'Closed',
};

/** Ink for what is settled, brand for what is owed. Never both. */
const STATE_TONE: Record<RequestState, string> = {
  open: 'bg-primary text-white',
  quoted: 'bg-ink text-on-ink',
  accepted: 'bg-ok-100 text-ok-700',
  declined: 'bg-ink-100 text-ink-500',
  expired: 'bg-warn-100 text-warn-700',
  closed: 'bg-ink-100 text-ink-500',
};

/** Owed first, then unanswered, then the rest. */
function rank(row: RequestRow): number {
  if (breachesSla(row)) return 0;
  if (row.state === 'open') return 1;
  if (row.state === 'quoted') return 2;
  return 3;
}

function TagCell({
  row,
  saving,
  count,
  onSave,
}: {
  row: RequestRow;
  saving: boolean;
  count: number;
  onSave: (tag: string) => void;
}) {
  const [draft, setDraft] = useState(row.requestTag ?? '');

  return (
    <div className="flex items-center gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (row.requestTag ?? '') && onSave(draft)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        placeholder="untagged"
        disabled={saving}
        aria-label={`Tag for ${row.subject ?? 'this request'}`}
        className="w-36 rounded-[var(--radius-block)] border border-ink-200 bg-white px-2 py-1
                   text-xs text-ink-900 placeholder:text-ink-400
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {/* The number that makes tagging worth doing: how many times this has
          been asked for. Past a handful it is a bundle, or a shop to sign. */}
      {row.requestTag && count > 1 && (
        <span
          className="rounded-[var(--radius-block)] bg-brand-100 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-brand-700"
          title={`Asked for ${count} times`}
        >
          ×{count}
        </span>
      )}
    </div>
  );
}

export function AdminRequests() {
  const navigate = useNavigate();
  const { rows, loading, saving, setTag, tagCounts } = useRequestInbox();

  const ordered = useMemo(
    () => [...rows].sort((a, b) => rank(a) - rank(b) || b.lastMessageAt.localeCompare(a.lastMessageAt)),
    [rows],
  );

  const owed = ordered.filter(breachesSla).length;
  const waiting = ordered.filter((r) => r.state === 'open').length;

  return (
    <PageShell>
      <AdminPageHeader
        title="Requests"
        subtitle="What people have asked us for that the catalogue does not carry"
      />
      <PageBody>
        {/* Two counters, and only when they are not zero -- a board that says
            "0 overdue" every day trains you to stop reading it. */}
        {(owed > 0 || waiting > 0) && (
          <div className="mb-5 flex flex-wrap gap-2">
            {owed > 0 && (
              <span className="flex items-center gap-1.5 rounded-[var(--radius-block)] bg-primary px-2.5 py-1 text-xs font-semibold text-white">
                <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.75} />
                {owed} past the 3-day promise
              </span>
            )}
            {waiting > 0 && (
              <span className="rounded-[var(--radius-block)] bg-ink px-2.5 py-1 text-xs font-semibold text-on-ink">
                {waiting} needing a price
              </span>
            )}
          </div>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading requests…</p>
        ) : ordered.length === 0 ? (
          <div className="rounded-[var(--radius-tile)] border border-dashed border-ink-200 py-16 text-center">
            <MessageSquare className="mx-auto mb-3 h-9 w-9 text-ink-300" strokeWidth={1} />
            <p className="text-sm text-ink-500">Nobody has asked for anything yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-tile)] border border-ink-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-100 bg-surface-paper">
                <tr className="text-[0.6875rem] uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2.5 font-semibold">Request</th>
                  <th className="px-4 py-2.5 font-semibold">State</th>
                  <th className="px-4 py-2.5 font-semibold">
                    <span className="flex items-center gap-1">
                      <TagIcon className="h-3 w-3" strokeWidth={2.75} /> Tag
                    </span>
                  </th>
                  <th className="px-4 py-2.5 font-semibold">Age</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => (
                  <tr key={row.id} className="border-b border-ink-100 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{row.subject ?? 'Untitled request'}</p>
                      <p className="text-xs text-muted-foreground">{row.buyerName ?? 'Someone'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-[var(--radius-block)] px-2 py-0.5 text-[0.6875rem] font-semibold ${STATE_TONE[row.state]}`}>
                        {STATE_LABEL[row.state]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <TagCell
                        row={row}
                        saving={saving === row.id}
                        count={row.requestTag ? (tagCounts[row.requestTag] ?? 0) : 0}
                        onSave={(tag) => setTag(row.id, tag)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className={breachesSla(row) ? 'font-semibold text-primary' : 'text-muted-foreground'}>
                        {row.ageDays === 0 ? 'today' : `${row.ageDays}d`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/messages?c=${row.id}`)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}

export default AdminRequests;
