// AdminPriceBook — the weekly price run, at '/admin/price-book'
//
// Every KithLy-sourced bundle line, what it cost in town last time, what it
// sells for, and how stale that is. Enter this week's costs, press publish
// once, and the whole run is stamped with one date.
//
// THE THREE THINGS THIS SCREEN EXISTS TO PREVENT
//
//   1. A price run that takes all afternoon, and therefore stops happening.
//   2. A stale lock nobody noticed -- which is not cosmetic, it is a live
//      financial promise still on the shelf.
//   3. A fat-fingered 10x. The previous cost sits next to the field, the
//      computed sell price updates as you type, and the total is shown
//      before you commit.
//
// Prices are NGWEE everywhere, displayed as kwacha. The one place that
// assumption was got wrong put the ledger 100x out; see 20260917020000.

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { Button } from '../../components/ui/button';
import { formatCurrency } from '../../../utils/currency';
import { usePriceBook, isStale, type PriceBookLine } from '../../hooks/usePriceBook';

/** A week from today, which is what a weekly lock means. */
function defaultValidUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function AdminPriceBook() {
  const { lines, loading, publishing, markupBps, staleCount, publish } = usePriceBook();
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [validUntil, setValidUntil] = useState(defaultValidUntil);

  const entered = useMemo(
    () =>
      Object.entries(costs).reduce<Record<string, number>>((acc, [id, raw]) => {
        const kwacha = Number.parseFloat(raw);
        if (Number.isFinite(kwacha) && kwacha >= 0) acc[id] = Math.round(kwacha * 100);
        return acc;
      }, {}),
    [costs],
  );

  const enteredCount = Object.keys(entered).length;

  // What this run will cost us and sell for, before committing to it.
  const runTotals = useMemo(() => {
    let cost = 0;
    let sell = markupBps === null ? null : 0;
    for (const [id, ngwee] of Object.entries(entered)) {
      const line = lines.find((l) => l.id === id);
      if (!line) continue;
      cost += ngwee * line.quantity;
      if (sell !== null && markupBps !== null) {
        sell += Math.round(ngwee * (1 + markupBps / 10_000)) * line.quantity;
      }
    }
    return { cost, sell };
  }, [entered, lines, markupBps]);

  const grouped = useMemo(() => {
    const map = new Map<string, PriceBookLine[]>();
    for (const line of lines) {
      const list = map.get(line.experienceName) ?? [];
      list.push(line);
      map.set(line.experienceName, list);
    }
    return [...map.entries()];
  }, [lines]);

  return (
    <PageShell>
      <AdminPageHeader
        title="Price book"
        subtitle={
          markupBps === null
            ? 'KithLy-sourced bundle lines · markup unavailable — nothing can be published'
            : `KithLy-sourced bundle lines · ${markupBps / 100}% markup applied on publish`
        }
      />
      <PageBody>
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading the price book…</p>
        ) : lines.length === 0 ? (
          <div className="rounded-[var(--radius-tile)] border border-dashed border-ink-200 py-16 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-ink-300" strokeWidth={1} />
            <p className="text-sm text-ink-500">
              No KithLy-sourced bundle lines yet. Lines appear here once a bundle contains
              items owned by the KithLy house shop.
            </p>
          </div>
        ) : (
          <>
            {staleCount > 0 && (
              <div className="mb-5 flex items-center gap-2 rounded-[var(--radius-block)] bg-primary px-3 py-2 text-sm font-semibold text-white">
                <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.75} />
                {staleCount} line{staleCount === 1 ? '' : 's'} past their window. A stale price is
                still a promise on the shelf.
              </div>
            )}

            <div className="space-y-6">
              {grouped.map(([bundleName, bundleLines]) => (
                <section
                  key={bundleName}
                  className="overflow-hidden rounded-[var(--radius-tile)] border border-ink-200 bg-white"
                >
                  <header className="flex items-baseline justify-between border-b border-ink-100 bg-surface-paper px-4 py-2.5">
                    <h2 className="kl-display text-base text-ink-900">{bundleName}</h2>
                    <span className="text-xs text-muted-foreground">
                      {bundleLines[0]?.validUntil
                        ? `held until ${bundleLines[0].validUntil}`
                        : 'never priced'}
                    </span>
                  </header>

                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-100 text-[0.6875rem] uppercase tracking-wide text-ink-500">
                        <th className="px-4 py-2 font-semibold">Item</th>
                        <th className="px-4 py-2 font-semibold">Qty</th>
                        <th className="px-4 py-2 font-semibold">Cost last time</th>
                        <th className="px-4 py-2 font-semibold">Selling at</th>
                        <th className="px-4 py-2 font-semibold">Cost this week (K)</th>
                        <th className="px-4 py-2 font-semibold">New price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundleLines.map((line) => {
                        const ngwee = entered[line.id];
                        const newSell =
                          ngwee === undefined || markupBps === null
                            ? null
                            : Math.round(ngwee * (1 + markupBps / 10_000));
                        // A cost that has moved a long way is usually a typo,
                        // and a typo here becomes a price somebody pays.
                        const suspicious =
                          ngwee !== undefined &&
                          line.sourcedCost !== null &&
                          line.sourcedCost > 0 &&
                          (ngwee > line.sourcedCost * 3 || ngwee < line.sourcedCost / 3);

                        return (
                          <tr key={line.id} className="border-b border-ink-100 last:border-0">
                            <td className="px-4 py-2.5">
                              <span className="text-ink-900">{line.itemName}</span>
                              {isStale(line) && (
                                <span className="ml-2 rounded-[var(--radius-block)] bg-warn-100 px-1.5 py-0.5 text-[0.625rem] font-semibold text-warn-700">
                                  stale
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                              ×{line.quantity}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                              {line.sourcedCost === null
                                ? '—'
                                : formatCurrency(line.sourcedCost, 'ZMW')}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-ink-900">
                              {line.lockedPrice === null
                                ? <span className="text-muted-foreground">live: {formatCurrency(line.livePrice, 'ZMW')}</span>
                                : formatCurrency(line.lockedPrice, 'ZMW')}
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                value={costs[line.id] ?? ''}
                                onChange={(e) =>
                                  setCosts((prev) => ({ ...prev, [line.id]: e.target.value }))
                                }
                                placeholder={
                                  line.sourcedCost !== null
                                    ? (line.sourcedCost / 100).toFixed(2)
                                    : (line.livePrice / 100).toFixed(2)
                                }
                                aria-label={`This week's cost for ${line.itemName}`}
                                className={`w-28 rounded-[var(--radius-block)] border px-2 py-1 text-sm tabular-nums
                                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                                            ${suspicious ? 'border-primary bg-primary-tint' : 'border-ink-200'}`}
                              />
                              {suspicious && (
                                <p className="mt-0.5 text-[0.625rem] font-semibold text-primary">
                                  3× off last week — check it
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums">
                              {newSell === null ? (
                                <span className="text-ink-300">—</span>
                              ) : (
                                <span className="font-semibold text-ink-900">
                                  {formatCurrency(newSell, 'ZMW')}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>

            {/* One publish, one timestamp. A week published across forty
                separate moments has forty expiry dates and the promise stops
                being checkable. */}
            <div className="mt-6 flex flex-wrap items-end justify-between gap-4 rounded-[var(--radius-tile)] border border-ink-200 bg-white p-4">
              <div>
                <label
                  htmlFor="valid-until"
                  className="block text-xs font-semibold uppercase tracking-wide text-ink-500"
                >
                  Hold these prices until
                </label>
                <input
                  id="valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="mt-1 rounded-[var(--radius-block)] border border-ink-200 px-2 py-1 text-sm
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="text-sm">
                <p className="text-muted-foreground">
                  {enteredCount} line{enteredCount === 1 ? '' : 's'} entered
                </p>
                {enteredCount > 0 && (
                  <p className="tabular-nums text-ink-900">
                    costs {formatCurrency(runTotals.cost, 'ZMW')}
                    {runTotals.sell !== null && (
                      <> · sells {formatCurrency(runTotals.sell, 'ZMW')}</>
                    )}
                  </p>
                )}
              </div>

              <Button
                disabled={publishing || enteredCount === 0 || markupBps === null}
                onClick={async () => {
                  const ok = await publish(entered, validUntil);
                  if (ok) setCosts({});
                }}
              >
                {publishing ? 'Publishing…' : `Publish ${enteredCount || ''} price${enteredCount === 1 ? '' : 's'}`}
              </Button>
            </div>

            <p className="mt-3 text-xs font-light text-muted-foreground">
              Lines you leave blank are not touched. Their old price and old date stand, and they
              keep showing as stale — re-stamping a price nobody re-checked is the one thing a
              price run must never do.
            </p>
          </>
        )}
      </PageBody>
    </PageShell>
  );
}

export default AdminPriceBook;
