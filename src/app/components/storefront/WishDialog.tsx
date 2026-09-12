// Making a wish on a post.
//
// "Secret Santa" on the card: somebody says they want this, and people close to
// them can see it and buy it for them.
//
// The visibility control is the whole reason this is a dialog rather than a
// one-tap toggle. `contacts` are one-directional and phone-keyed — anybody can
// save anybody's number without asking — so contact-possession alone must never
// be what grants access to what somebody has asked for. The copy is deliberate
// too: "Anyone who has me saved" rather than "Everyone", because "everyone" is
// exactly what people misread as the public internet.

import { useEffect, useState } from 'react';
import { Gift, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { useContacts } from '../../hooks/useContacts';
import { WISH_VISIBILITIES, type MyWish, type WishVisibility } from '../../types/posts';

interface WishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string | null;
  existing: MyWish | null;
  onSave: (
    postId: string,
    note: string,
    visibility: WishVisibility,
    audience: string[],
  ) => Promise<boolean>;
  onRemove: (postId: string) => Promise<void>;
}

export function WishDialog({
  open,
  onOpenChange,
  postId,
  existing,
  onSave,
  onRemove,
}: WishDialogProps) {
  const { contacts } = useContacts();
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<WishVisibility>('all');
  const [audience, setAudience] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Re-seed whenever the dialog opens on a different post, so editing an
  // existing wish starts from what it actually says.
  useEffect(() => {
    if (!open) return;
    setNote(existing?.note ?? '');
    setVisibility(existing?.visibility ?? 'all');
    setAudience(existing?.audience ?? []);
  }, [open, existing]);

  if (!postId) return null;

  const togglePhone = (phone: string) =>
    setAudience((current) =>
      current.includes(phone) ? current.filter((p) => p !== phone) : [...current, phone],
    );

  const save = async () => {
    setSaving(true);
    const ok = await onSave(postId, note, visibility, audience);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  const needsPicker = visibility !== 'all';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="size-4 text-primary" />
            {existing ? 'Your wish' : 'Make a wish'}
          </DialogTitle>
          <DialogDescription>
            Say you want this, and let people close to you buy it for you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything worth saying — a size, a colour, why you want it…"
            maxLength={500}
            rows={3}
          />

          <div>
            <p className="mb-2 text-xs font-medium">Who can see it</p>
            <div className="space-y-1.5">
              {WISH_VISIBILITIES.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setVisibility(option.value)}
                  aria-pressed={visibility === option.value}
                  className={`w-full rounded-[var(--radius-md)] border p-2.5 text-left transition-colors
                              ${
                                visibility === option.value
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:bg-accent'
                              }`}
                >
                  <p className="text-[0.8125rem] font-medium">{option.label}</p>
                  <p className="text-[0.6875rem] text-muted-foreground">{option.description}</p>
                </button>
              ))}
            </div>
          </div>

          {needsPicker && (
            <div>
              <p className="mb-2 text-xs font-medium">
                {visibility === 'only' ? 'Only these people' : 'Everyone except these people'}
              </p>
              {contacts.length === 0 ? (
                <p className="text-[0.6875rem] text-muted-foreground">
                  You have no contacts saved yet.
                </p>
              ) : (
                <div className="kl-scroll flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                  {contacts.map((contact) => {
                    const on = audience.includes(contact.phone);
                    return (
                      <button
                        key={contact.id}
                        onClick={() => togglePhone(contact.phone)}
                        aria-pressed={on}
                        className={`rounded-[var(--radius-pill)] border px-2.5 py-1 text-[0.6875rem] transition-colors
                                    ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent'}`}
                      >
                        {contact.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {audience.length === 0 && contacts.length > 0 && (
                <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
                  {visibility === 'only'
                    ? 'Nobody picked — nobody will see this wish.'
                    : 'Nobody picked — everyone who has you saved will see it.'}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {existing ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await onRemove(postId);
                onOpenChange(false);
              }}
            >
              <Trash2 className="mr-1.5 size-4" /> Remove
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {existing ? 'Save' : 'Make the wish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
