// PayoutDestinationPanel — where you get paid, and whether you can trade yet.
//
// This panel exists because of one rule in the settlement model: a shop whose
// payout destination is unverified cannot accept collections. That is a hard
// gate at the scanner, and a hard gate with no explanation is just a broken
// button. So the panel's first job is to say exactly why the scanner is off and
// exactly what fixes it.
//
// The second job is the incentive. The settlement tier sits directly under the
// destination because "get paid the moment a gift is collected" is what the
// merchant is working towards, and it is invisible if it lives on another
// screen. A tier the merchant cannot see the exit from is just a punishment.
//
// The name check is shown, never enforced. "Mary Banda" against "M BANDA" is
// routine; against someone else entirely it is fraud. Both strings go on screen
// and a person decides.

import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Clock,
  Landmark,
  Loader2,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import { usePayoutDestination } from '../../hooks/usePayoutDestination';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '../ui/utils';

interface PayoutDestinationPanelProps {
  shopId: string | null | undefined;
}

function formatZmw(ngwee: number | null | undefined): string {
  const value = (ngwee ?? 0) / 100;
  return `ZMW ${value.toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatHold(seconds: number): string {
  if (seconds <= 0) return 'instantly';
  if (seconds < 3600) return `after ${Math.round(seconds / 60)} minutes`;
  const hours = Math.round(seconds / 3600);
  return `after ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function PayoutDestinationPanel({ shopId }: PayoutDestinationPanelProps) {
  const {
    readiness,
    settlement,
    summary,
    loading,
    saving,
    verifying,
    error,
    saveDestination,
    verifyDestination,
  } = usePayoutDestination(shopId);

  const [editing, setEditing] = useState(false);
  const [rail, setRail] = useState<'airtel_money' | 'bank'>('airtel_money');
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [accountName, setAccountName] = useState('');
  const [bankName, setBankName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Checking your payout details…</span>
        </div>
      </div>
    );
  }

  const ready = readiness?.can_accept_redemptions === true;

  async function handleSave() {
    setFormError(null);
    if (!accountIdentifier.trim() || !accountName.trim()) {
      setFormError('We need both the number and the name on the account.');
      return;
    }
    if (rail === 'bank' && !bankName.trim()) {
      setFormError('Which bank is the account with?');
      return;
    }

    const result = await saveDestination({
      rail,
      accountIdentifier,
      accountName,
      bankName: rail === 'bank' ? bankName : undefined,
    });

    if (!result.ok) {
      setFormError(result.error ?? 'We could not save those details.');
      return;
    }
    setEditing(false);
    setVerifyNote(null);
  }

  async function handleVerify() {
    setVerifyNote(null);
    const result = await verifyDestination();

    if (!result.ok) {
      setVerifyNote(result.error ?? 'Those details could not be verified.');
      return;
    }
    if (result.nameMatches === false && result.verifiedName) {
      // Surfaced, not blocked. See the header.
      setVerifyNote(
        `Verified. Note that the account is registered as "${result.verifiedName}", ` +
          `which is not quite the name you gave us. If that is not you, change the number.`,
      );
      return;
    }
    setVerifyNote('Verified. You can now accept gift collections.');
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* ---------------------------------------------------------------- */}
      {/* The gate. Stated first because nothing else matters until it is   */}
      {/* open -- the merchant cannot take a single collection.             */}
      {/* ---------------------------------------------------------------- */}
      <div
        className={cn(
          'flex items-start gap-3 px-6 py-4 border-b border-border',
          ready ? 'bg-[var(--success)]/10' : 'bg-[var(--destructive)]/10',
        )}
      >
        {ready ? (
          <BadgeCheck className="size-5 shrink-0 text-[var(--success)] mt-0.5" />
        ) : (
          <TriangleAlert className="size-5 shrink-0 text-[var(--destructive)] mt-0.5" />
        )}
        <div className="min-w-0">
          <p className="font-medium">
            {ready ? 'You can accept gift collections' : 'You cannot accept collections yet'}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {error ??
              readiness?.message ??
              (ready
                ? 'Your payout details are verified.'
                : 'Add and verify your payout details to switch the scanner on.')}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* -------------------------------------------------------------- */}
        {/* The destination                                                 */}
        {/* -------------------------------------------------------------- */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Where you get paid</h3>
            {!editing && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                {readiness?.destination_id ? 'Change' : 'Add details'}
              </Button>
            )}
          </div>

          {!editing && readiness?.destination_id && (
            <div className="flex items-start gap-3 rounded-xl border border-border p-4">
              {readiness.rail === 'bank' ? (
                <Landmark className="size-5 text-muted-foreground mt-0.5" />
              ) : (
                <Smartphone className="size-5 text-muted-foreground mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">
                  {readiness.account_name ?? 'Unnamed account'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {readiness.account_identifier ?? '—'}
                  {readiness.rail === 'bank' ? ' · Bank transfer' : ' · Airtel Money'}
                </p>
                {readiness.rail === 'bank' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Bank transfers take 1–3 days. Airtel Money arrives in seconds.
                  </p>
                )}
              </div>
              {!ready && (
                <Button size="sm" onClick={handleVerify} disabled={verifying}>
                  {verifying ? <Loader2 className="size-4 animate-spin" /> : 'Verify'}
                </Button>
              )}
            </div>
          )}

          {!editing && !readiness?.destination_id && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">
                We have nowhere to send your money yet.
              </p>
              <Button className="mt-3" size="sm" onClick={() => setEditing(true)}>
                Add payout details
              </Button>
            </div>
          )}

          {editing && (
            <div className="rounded-xl border border-border p-4 space-y-4">
              {/* Airtel first and selected by default: it settles in seconds, */}
              {/* and the speed difference belongs at the point of choice      */}
              {/* rather than in a footnote nobody reads.                      */}
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['airtel_money', 'Airtel Money', 'Arrives in seconds', Smartphone],
                    ['bank', 'Bank account', 'Takes 1–3 days', Landmark],
                  ] as const
                ).map(([value, label, speed, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRail(value)}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                      rail === value
                        ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                        : 'border-border hover:bg-muted/50',
                    )}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">{speed}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="payout-identifier">
                  {rail === 'bank' ? 'Account number' : 'Airtel Money number'}
                </Label>
                <Input
                  id="payout-identifier"
                  value={accountIdentifier}
                  onChange={(e) => setAccountIdentifier(e.target.value)}
                  placeholder={rail === 'bank' ? '0123456789' : '0977 123 456'}
                  inputMode={rail === 'bank' ? 'numeric' : 'tel'}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="payout-name">Name on the account</Label>
                <Input
                  id="payout-name"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="As registered with your provider"
                />
              </div>

              {rail === 'bank' && (
                <div className="space-y-2">
                  <Label htmlFor="payout-bank">Bank</Label>
                  <Input
                    id="payout-bank"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. Zanaco"
                  />
                </div>
              )}

              {formError && (
                <p className="flex items-start gap-2 text-sm text-[var(--destructive)]">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  {formError}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                We will check these details with your provider before switching
                collections on. Changing them means checking again.
              </p>

              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save details'}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {verifyNote && (
            <p className="mt-3 text-sm text-muted-foreground">{verifyNote}</p>
          )}
        </section>

        {/* -------------------------------------------------------------- */}
        {/* The tier — the reason to care about a clean record              */}
        {/* -------------------------------------------------------------- */}
        {settlement && (
          <section className="rounded-xl border border-border p-4">
            <div className="flex items-start gap-3">
              <Clock className="size-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{settlement.label}</p>
                  {settlement.instant && (
                    <span className="rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[var(--success)]">
                      Instant
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {settlement.explanation}
                </p>

                {settlement.redemptions_to_next != null &&
                  settlement.redemptions_to_next > 0 &&
                  !settlement.under_review && (
                    <p className="mt-3 flex items-center gap-1.5 text-sm">
                      <ArrowRight className="size-3.5 text-[var(--primary)]" />
                      <span>
                        <strong>{settlement.redemptions_to_next} more</strong>{' '}
                        {settlement.redemptions_to_next === 1 ? 'collection' : 'collections'}{' '}
                        and you move to {settlement.next_tier_label}.
                      </span>
                    </p>
                  )}

                {settlement.under_review && settlement.flag_reason && (
                  <p className="mt-2 text-sm text-[var(--destructive)]">
                    {settlement.flag_reason}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* -------------------------------------------------------------- */}
        {/* What you are owed.                                              */}
        {/*                                                                 */}
        {/* Deliberately NOT called a balance. It is not money the merchant  */}
        {/* holds with KithLy -- there is no such thing any more -- it is    */}
        {/* money on its way to their own account.                          */}
        {/* -------------------------------------------------------------- */}
        {summary && (
          <section>
            <h3 className="font-medium mb-3">On its way to you</h3>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border p-3">
                <dt className="text-xs text-muted-foreground">Owed to you</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {formatZmw(summary.owed_ngwee)}
                </dd>
              </div>
              <div className="rounded-xl border border-border p-3">
                <dt className="text-xs text-muted-foreground">Paid, last 30 days</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {formatZmw(summary.paid_last_30_days_ngwee)}
                </dd>
              </div>
            </dl>

            {summary.next_payout_at && summary.scheduled_ngwee > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                Next payout {formatHold(
                  Math.max(
                    0,
                    Math.round(
                      (new Date(summary.next_payout_at).getTime() - Date.now()) / 1000,
                    ),
                  ),
                )}
                .
              </p>
            )}

            {/* A debt we failed to deliver is the merchant's business, and */}
            {/* hiding it would be the worst possible choice.               */}
            {summary.needs_attention_ngwee > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--destructive)]/10 p-3">
                <AlertCircle className="size-4 shrink-0 text-[var(--destructive)] mt-0.5" />
                <p className="text-sm">
                  <strong>{formatZmw(summary.needs_attention_ngwee)}</strong> could not
                  be sent to your account. The money is still yours and is safe. Check
                  the details above, then contact us so we can send it.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
