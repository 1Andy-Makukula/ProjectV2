// SenderEscrowPanel — what your money is doing, when you no longer have a wallet.
//
// WHY THIS REPLACES THE WALLET LEDGER
// -----------------------------------
// The wallet view answered "what is my balance and how did it get there". Under
// the escrow model there is no balance: a sender's money is either committed to
// a gift somebody has not collected yet, or already on its way back to the card
// they paid with. Showing a total and calling it credit would be the single
// most misleading thing this screen could do.
//
// So the three figures are deliberately separated by WHERE THE MONEY IS, not
// summed into a headline number. And the copy avoids "balance", "credit" and
// "available" throughout -- none of them are true.
//
// THE EXTENSION IS THE POINT
// --------------------------
// §7 of the settlement model: prefer prevention. A collected gift is worth more
// to everyone than any split of an uncollected one, so the most valuable thing
// this panel can do is not report on expiry but avert it. Gifts inside a week
// of expiring get a one-tap "give them another week", which is the same action
// the reminder notification offers.

import { Clock, Gift, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useSenderEscrow } from '../../hooks/useSenderEscrow';
import { Button } from '../ui/button';

function formatZmw(ngwee: number | null | undefined): string {
  return `ZMW ${((ngwee ?? 0) / 100).toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5));
}

export function SenderEscrowPanel() {
  const { escrow, expiring, loading, extending, extendGift } = useSenderEscrow();
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Looking up your gifts…</span>
        </div>
      </div>
    );
  }

  const nothingHeld =
    !escrow ||
    (escrow.awaiting_collection_ngwee === 0 &&
      escrow.refund_on_the_way_ngwee === 0 &&
      escrow.refund_needs_details_ngwee === 0);

  async function handleExtend(shopOrderId: string) {
    setNote(null);
    setFailed(null);
    const result = await extendGift(shopOrderId);
    if (!result.ok) {
      setFailed(result.error ?? 'We could not extend that gift.');
      return;
    }
    setNote('Done — they have another week to collect it.');
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <h3 className="font-medium">Your gifts and your money</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          KithLy holds nothing you can spend. Money you have sent is either
          waiting to be collected, or on its way back to you.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {nothingHeld ? (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting at the moment. Every gift you have sent has been
            collected.
          </p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Gift className="size-3.5" />
                Waiting to be collected
              </dt>
              <dd className="mt-1.5 font-medium tabular-nums">
                {formatZmw(escrow?.awaiting_collection_ngwee)}
              </dd>
            </div>

            <div className="rounded-xl border border-border p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RotateCcw className="size-3.5" />
                Refund on its way
              </dt>
              <dd className="mt-1.5 font-medium tabular-nums">
                {formatZmw(escrow?.refund_on_the_way_ngwee)}
              </dd>
              <p className="mt-1 text-xs text-muted-foreground">
                Back to the way you paid
              </p>
            </div>

            {/* Shown only when it is non-zero, because it is an alarming card  */}
            {/* and an empty one would be alarming for no reason.               */}
            {(escrow?.refund_needs_details_ngwee ?? 0) > 0 && (
              <div className="rounded-xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 p-3">
                <dt className="flex items-center gap-1.5 text-xs text-[var(--destructive)]">
                  <TriangleAlert className="size-3.5" />
                  We need your details
                </dt>
                <dd className="mt-1.5 font-medium tabular-nums">
                  {formatZmw(escrow?.refund_needs_details_ngwee)}
                </dd>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your money is safe. We could not return it to the original
                  card, so we will be in touch.
                </p>
              </div>
            )}
          </dl>
        )}

        {/* ------------------------------------------------------------ */}
        {/* Prevention. The most useful thing on this panel.              */}
        {/* ------------------------------------------------------------ */}
        {expiring.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="size-4 text-[var(--primary)]" />
              <h4 className="text-sm font-medium">Running out of time</h4>
            </div>

            <ul className="space-y-2">
              {expiring.map((gift) => {
                const days = daysUntil(gift.expires_at);
                const exhausted = gift.expiry_extensions >= 2;

                return (
                  <li
                    key={gift.shop_order_id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {gift.recipient_name ?? 'Your recipient'}
                        {gift.shop_name ? ` · ${gift.shop_name}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {days === 0
                          ? 'Expires today'
                          : `${days} ${days === 1 ? 'day' : 'days'} left to collect`}
                        {gift.claim_code ? ` · ${gift.claim_code}` : ''}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={exhausted || extending === gift.shop_order_id}
                      onClick={() => handleExtend(gift.shop_order_id)}
                      className="shrink-0"
                    >
                      {extending === gift.shop_order_id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : exhausted ? (
                        'No more extensions'
                      ) : (
                        'Give another week'
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>

            {note && <p className="mt-3 text-sm text-[var(--success)]">{note}</p>}
            {failed && (
              <p className="mt-3 text-sm text-[var(--destructive)]">{failed}</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
