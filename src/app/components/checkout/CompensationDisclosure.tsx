// CompensationDisclosure — what happens to this money if the gift is never
// collected, said before the sender pays.
//
// WHY THIS COMPONENT EXISTS
// -------------------------
// KithLy used to split every expired gift 80/20 and tell the sender afterwards,
// in a notification, once the money had already gone. That is indefensible
// twice over: most shops lost nothing by a gift going uncollected, and nobody
// agreed to it.
//
// The replacement is conditional and disclosed. A merchant marks an item as
// genuinely held or prepared -- a cake baked to order, a perishable, reserved
// stock -- with a percentage. The sender sees it here, before paying. Anything
// not marked refunds in full to the card or account they paid with.
//
// WHY IT IS NOT A COLLAPSED "TERMS" LINK
// --------------------------------------
// A disclosure the sender has to go looking for is not a disclosure. The one
// case that costs them money is stated in full, in the flow, in plain words.
// When nothing in the basket carries a term, the component renders the
// reassurance instead of nothing at all: "everything comes back to you" is
// worth saying, and it is the answer to the question the section raises.

import { ShieldCheck, Info } from 'lucide-react';
import type { CartItem } from '../../types';

interface CompensationDisclosureProps {
  items: CartItem[];
  /** Days the recipient has to collect. Shown so the risk has a timescale. */
  windowDays?: number;
  className?: string;
}

interface DisclosedLine {
  key: string;
  name: string;
  percent: number;
  reason: string | null;
}

export function collectDisclosures(items: CartItem[]): DisclosedLine[] {
  const seen = new Map<string, DisclosedLine>();

  for (const line of items) {
    const p = line.product;
    if (!p?.compensation_eligible) continue;

    const percent = Number(p.compensation_percent ?? 0);
    if (!Number.isFinite(percent) || percent <= 0) continue;

    // One entry per item, not per unit: three of the same cake is one term.
    if (seen.has(p.id)) continue;

    seen.set(p.id, {
      key: p.id,
      name: p.name ?? p.title,
      percent,
      reason: p.compensation_reason ?? null,
    });
  }

  return [...seen.values()];
}

export function CompensationDisclosure({
  items,
  windowDays = 14,
  className,
}: CompensationDisclosureProps) {
  const disclosures = collectDisclosures(items);

  if (disclosures.length === 0) {
    return (
      <div className={className}>
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3">
          <ShieldCheck className="size-4 shrink-0 text-[var(--success)] mt-0.5" />
          <p className="text-sm text-muted-foreground">
            If this gift is not collected within {windowDays} days, every ngwee
            comes back to the card or account you paid with. We never turn it
            into credit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="rounded-xl border border-border p-3">
        <div className="flex items-start gap-2.5">
          <Info className="size-4 shrink-0 text-[var(--primary)] mt-0.5" />
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium">If this gift is not collected</p>
            <p className="text-sm text-muted-foreground">
              You have {windowDays} days to collect. After that, most of this
              basket is refunded in full to the way you paid.{' '}
              {disclosures.length === 1 ? 'One item is different' : 'Some items are different'}
              , because the shop prepares them for you:
            </p>

            <ul className="space-y-2">
              {disclosures.map((d) => (
                <li key={d.key} className="text-sm">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted-foreground">
                    {' '}— the shop keeps {d.percent}%, and {100 - d.percent}% comes
                    back to you.
                  </span>
                  {d.reason && (
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {d.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <p className="text-xs text-muted-foreground">
              You can extend the collection window from the reminder we send, so
              this rarely comes up.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
