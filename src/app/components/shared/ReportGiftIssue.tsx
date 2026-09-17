import { useState } from 'react';
import { AlertCircle, CheckCircle2, LifeBuoy } from 'lucide-react';

import {
  GIFT_ISSUE_TYPES,
  useGiftIssueReport,
  type GiftIssueType,
} from '../../hooks/useGiftIssueReport';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';

/**
 * "Something went wrong" for the person standing at the counter.
 *
 * Deliberately reachable without an account, because the recipient does not
 * have one. Everything about the wording assumes someone who is mid-problem,
 * possibly on a slow connection, possibly embarrassed, and who has just been
 * told by a shopkeeper that their gift cannot be collected.
 */
export function ReportGiftIssue({ claimCode }: { claimCode: string }) {
  const [open, setOpen] = useState(false);
  const [issueType, setIssueType] = useState<GiftIssueType | null>(null);
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');

  const { submitReport, submitting, error, submitted, reset } = useGiftIssueReport();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Reset on close so reopening does not show a stale success or error.
      reset();
      setIssueType(null);
      setDescription('');
      setPhone('');
    }
  };

  const handleSubmit = async () => {
    if (!issueType) return;
    await submitReport({ claimCode, issueType, description, contactPhone: phone });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="text-ink-500 hover:text-ink-800 text-sm font-medium"
        >
          <LifeBuoy className="mr-2 h-4 w-4" strokeWidth={1.5} />
          Something went wrong?
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md rounded-3xl">
        {submitted ? (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-ok-50">
              <CheckCircle2 className="h-7 w-7 text-ok-600" strokeWidth={1.5} />
            </div>
            <DialogTitle className="text-lg">Thank you — we have this</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-ink-500">
              Someone will look into it, and the person who sent your gift has been told.
              Your gift is not lost.
            </DialogDescription>
            <Button className="mt-6 w-full rounded-2xl" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Tell us what happened</DialogTitle>
              <DialogDescription>
                You do not need an account. We will look into it and let the person who
                sent your gift know.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>What went wrong?</Label>
                {/* Plain buttons rather than a select: this is a one-handed
                    interaction on a phone, often outdoors, and a native select
                    on a low-end Android is a worse target than a stack. */}
                <div className="grid gap-2">
                  {GIFT_ISSUE_TYPES.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setIssueType(option.value)}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                        issueType === option.value
                          ? 'border-ink-800 bg-ink-50 font-medium text-ink-900'
                          : 'border-ink-200 text-ink-600 hover:border-ink-300'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="issue-description">Anything else? (optional)</Label>
                <Textarea
                  id="issue-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="For example: the shop said the code was already used."
                  className="rounded-2xl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="issue-phone">Your phone number (optional)</Label>
                <Input
                  id="issue-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={32}
                  inputMode="tel"
                  placeholder="So we can call you back"
                  className="rounded-2xl"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-2xl bg-danger-50 p-3 text-sm text-danger-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                className="w-full rounded-2xl"
                onClick={handleSubmit}
                disabled={!issueType || submitting}
              >
                {submitting ? 'Sending…' : 'Send report'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
