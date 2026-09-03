import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, CalendarPlus, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { PhoneInput } from '../../components/shared/PhoneInput';
import { useContacts } from '../../hooks/useContacts';
import {
  MONTHS,
  OCCASION_KINDS,
  countdownLabel,
  daysInMonth,
  daysUntil,
  occasionTitle,
  occasionWhen,
  type Contact,
  type OccasionDraft,
  type OccasionKind,
  type Recurrence,
} from '../../types/contacts';
import { formatPhoneDisplay } from '../../../utils/phone';

/**
 * The people you send things to, and the dates that matter about them.
 *
 * Two lists, and the order matters: the ones already saved, then the ones the
 * app can see you have sent to before but never kept. That second list is
 * built from your own orders, so a useful contact book exists before anybody
 * has typed anything or granted any permission.
 */
export function Contacts() {
  const navigate = useNavigate();
  const {
    contacts,
    suggestions,
    loading,
    busy,
    create,
    remove,
    addOccasion,
    removeOccasion,
    saveSuggestion,
  } = useContacts();

  const [addOpen, setAddOpen] = useState(false);
  const [occasionFor, setOccasionFor] = useState<Contact | null>(null);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 border-b bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 md:px-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="flex-1 text-base font-medium tracking-tight">People</h1>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" />
            Add someone
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 md:px-6 md:py-8">
        <p className="text-sm font-light text-muted-foreground">
          Saved here so you never have to remember a number again. Only you can see this list,
          and nothing is ever read from your phone.
        </p>

        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Saved
          </h2>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : contacts.length === 0 ? (
            <div className="kl-tile py-12 text-center">
              <Users className="mx-auto mb-3 size-9 text-slate-300" strokeWidth={1} />
              <p className="text-sm text-slate-500">Nobody saved yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  busy={busy}
                  onRemove={() => remove(contact.id)}
                  onAddOccasion={() => setOccasionFor(contact)}
                  onRemoveOccasion={removeOccasion}
                />
              ))}
            </div>
          )}
        </section>

        {suggestions.length > 0 && (
          <section>
            <h2 className="mb-1 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
              People you have sent to
            </h2>
            <p className="mb-3 text-xs font-light text-muted-foreground">
              From your own orders. Save one and it will be waiting next time you send.
            </p>

            <ul className="kl-tile divide-y divide-border px-4">
              {suggestions.map((suggestion) => (
                <li key={suggestion.phone} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{suggestion.name}</p>
                    <p className="truncate text-xs font-light text-muted-foreground">
                      {formatPhoneDisplay(suggestion.phone)}
                      {suggestion.timesSent > 1 && ` · sent ${suggestion.timesSent} times`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => saveSuggestion(suggestion)}
                  >
                    <UserPlus className="size-3.5" />
                    Save
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <AddContactDialog open={addOpen} onOpenChange={setAddOpen} busy={busy} onCreate={create} />

      {occasionFor && (
        <AddOccasionDialog
          contact={occasionFor}
          busy={busy}
          onOpenChange={(open) => !open && setOccasionFor(null)}
          onSave={async (draft) => {
            const ok = await addOccasion(occasionFor.id, draft);
            if (ok) setOccasionFor(null);
          }}
        />
      )}
    </div>
  );
}

// ── One person ─────────────────────────────────────────────────────────────

function ContactCard({
  contact,
  busy,
  onRemove,
  onAddOccasion,
  onRemoveOccasion,
}: {
  contact: Contact;
  busy: boolean;
  onRemove: () => void;
  onAddOccasion: () => void;
  onRemoveOccasion: (id: string) => void;
}) {
  return (
    <article className="kl-tile p-4">
      <header className="flex items-center gap-3">
        <div className="kl-gradient-brand-br grid size-10 shrink-0 place-items-center rounded-[var(--radius-pill)]">
          <span className="text-sm font-light text-white">
            {contact.name.charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{contact.name}</p>
          <p className="truncate text-xs font-light text-muted-foreground">
            {formatPhoneDisplay(contact.phone)}
          </p>
        </div>

        {contact.relationship && <Badge variant="secondary">{contact.relationship}</Badge>}

        <button
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${contact.name}`}
          className="rounded-[var(--radius-pill)] p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="size-3.5" strokeWidth={2} />
        </button>
      </header>

      <div className="mt-3 space-y-1.5 border-t border-border pt-3">
        {contact.occasions.length === 0 ? (
          <p className="text-xs font-light text-muted-foreground">
            No dates yet — add one and it turns up on your storefront before it arrives.
          </p>
        ) : (
          contact.occasions
            .map((occasion) => ({ occasion, days: daysUntil(occasion) }))
            .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
            .map(({ occasion, days }) => (
              <div key={occasion.id} className="flex items-baseline gap-2">
                <span className="truncate text-[0.8125rem] font-medium">
                  {occasionTitle(occasion)}
                </span>
                <span className="shrink-0 text-[0.6875rem] font-light text-muted-foreground">
                  {occasionWhen(occasion)}
                </span>

                {days !== null && days <= 60 && (
                  <span
                    className={`shrink-0 text-[0.6875rem] font-medium ${
                      days <= 7 ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    {countdownLabel(days)}
                  </span>
                )}

                <button
                  onClick={() => onRemoveOccasion(occasion.id)}
                  disabled={busy}
                  aria-label={`Remove ${occasionTitle(occasion)}`}
                  className="ml-auto shrink-0 rounded-[var(--radius-pill)] p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="size-3" strokeWidth={2} />
                </button>
              </div>
            ))
        )}

        {contact.occasions.some((occasion) => occasion.notes) && (
          <ul className="pt-1">
            {contact.occasions
              .filter((occasion) => occasion.notes)
              .map((occasion) => (
                <li key={`${occasion.id}-note`} className="text-[0.6875rem] font-light text-muted-foreground">
                  <span className="font-medium">{occasionTitle(occasion)}:</span> {occasion.notes}
                </li>
              ))}
          </ul>
        )}

        <Button variant="outline" size="sm" className="mt-2" onClick={onAddOccasion}>
          <CalendarPlus className="size-3.5" />
          Add a date
        </Button>
      </div>
    </article>
  );
}

// ── Adding a person ────────────────────────────────────────────────────────

function AddContactDialog({
  open,
  onOpenChange,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onCreate: (
    draft: { name: string; phone: string; relationship?: string },
    source?: 'manual' | 'order' | 'import',
    firstOccasion?: OccasionDraft,
  ) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [withDate, setWithDate] = useState(false);
  const [draft, setDraft] = useState<OccasionDraft>(blankOccasion());

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    await onCreate(
      { name, phone, relationship },
      'manual',
      withDate && isComplete(draft) ? draft : undefined,
    );

    setName('');
    setPhone('');
    setRelationship('');
    setWithDate(false);
    setDraft(blankOccasion());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add someone</DialogTitle>
          <DialogDescription>
            A name and a number is enough. A date is what puts them on your storefront before
            it arrives.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Name *</Label>
              <Input
                id="contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mum"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-phone">Phone *</Label>
              <PhoneInput id="contact-phone" value={phone} onChange={setPhone} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-relationship">How you know them</Label>
              <Input
                id="contact-relationship"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="e.g. Mum, cousin, my landlord"
              />
            </div>

            {withDate ? (
              <OccasionFields draft={draft} onChange={setDraft} />
            ) : (
              <Button type="button" variant="outline" onClick={() => setWithDate(true)}>
                <CalendarPlus className="size-3.5" />
                Add a date too
              </Button>
            )}
          </DialogBody>

          <Button
            type="submit"
            disabled={busy || !name.trim() || !phone.trim()}
            className="mt-4 w-full"
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Adding a date to somebody already saved ────────────────────────────────

function AddOccasionDialog({
  contact,
  busy,
  onOpenChange,
  onSave,
}: {
  contact: Contact;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: OccasionDraft) => void;
}) {
  const [draft, setDraft] = useState<OccasionDraft>(blankOccasion());

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>A date for {contact.name}</DialogTitle>
          <DialogDescription>
            What it is, when it falls, and anything worth remembering about it.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (isComplete(draft)) onSave(draft);
          }}
        >
          <DialogBody>
            <OccasionFields draft={draft} onChange={setDraft} />
          </DialogBody>

          <Button
            type="submit"
            disabled={busy || !isComplete(draft)}
            className="mt-4 w-full"
          >
            {busy ? 'Saving…' : 'Save the date'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The occasion form.
 *
 * Choosing a kind sets the recurrence it almost always has, so picking
 * "monthly groceries" stops the form asking for a month it will never use.
 * The choice stays editable underneath — the default is a shortcut, not a rule.
 */
function OccasionFields({
  draft,
  onChange,
}: {
  draft: OccasionDraft;
  onChange: (draft: OccasionDraft) => void;
}) {
  const kind = OCCASION_KINDS.find((entry) => entry.value === draft.kind);
  const needsMonth = draft.recurrence !== 'monthly';
  const needsYear = draft.recurrence === 'once';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>What is it *</Label>
        <Select
          value={draft.kind}
          onValueChange={(value) => {
            const chosen = OCCASION_KINDS.find((entry) => entry.value === value);
            onChange({
              ...draft,
              kind: value as OccasionKind,
              recurrence: chosen?.defaultRecurrence ?? 'annual',
              month: chosen?.defaultRecurrence === 'monthly' ? null : draft.month,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OCCASION_KINDS.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {kind && <p className="text-xs font-light text-muted-foreground">{kind.hint}</p>}
      </div>

      {(draft.kind === 'other' || draft.label) && (
        <div className="space-y-2">
          <Label htmlFor="occasion-label">
            Call it {draft.kind === 'other' ? '*' : '(optional)'}
          </Label>
          <Input
            id="occasion-label"
            value={draft.label ?? ''}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            placeholder="e.g. Mum's 60th, Naming ceremony"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>How often</Label>
        <Select
          value={draft.recurrence}
          onValueChange={(value) =>
            onChange({
              ...draft,
              recurrence: value as Recurrence,
              month: value === 'monthly' ? null : (draft.month ?? 1),
              year: value === 'once' ? (draft.year ?? new Date().getFullYear()) : null,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="annual">Every year</SelectItem>
            <SelectItem value="monthly">Every month</SelectItem>
            <SelectItem value="once">Just once</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>When *</Label>
        <div className="flex gap-2">
          {needsMonth && (
            <Select
              value={draft.month ? String(draft.month) : ''}
              onValueChange={(value) => onChange({ ...draft, month: Number(value) })}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((label, index) => (
                  <SelectItem key={label} value={String(index + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select
            value={draft.day ? String(draft.day) : ''}
            onValueChange={(value) => onChange({ ...draft, day: Number(value) })}
          >
            <SelectTrigger className={needsMonth ? 'w-28' : 'flex-1'}>
              <SelectValue placeholder="Day" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({
                length: needsMonth && draft.month ? daysInMonth(draft.month) : 31,
              }).map((_, index) => (
                <SelectItem key={index} value={String(index + 1)}>
                  {index + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {needsYear && (
            <Input
              type="number"
              inputMode="numeric"
              className="w-24"
              placeholder="Year"
              value={draft.year ?? ''}
              onChange={(e) => onChange({ ...draft, year: Number(e.target.value) || null })}
            />
          )}
        </div>
        {draft.recurrence === 'monthly' && (
          <p className="text-xs font-light text-muted-foreground">
            No month needed — this comes round every month.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="occasion-notes">Notes</Label>
        <Textarea
          id="occasion-notes"
          rows={2}
          value={draft.notes ?? ''}
          onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          placeholder="e.g. she likes the yellow roses; K800 to the bursar, not the school account"
        />
      </div>
    </div>
  );
}

function blankOccasion(): OccasionDraft {
  return { kind: 'birthday', recurrence: 'annual', month: null, day: 0 };
}

/** Enough to save: a day, plus whatever else the recurrence needs. */
function isComplete(draft: OccasionDraft): boolean {
  if (!draft.day) return false;
  if (draft.kind === 'other' && !draft.label?.trim()) return false;
  if (draft.recurrence !== 'monthly' && !draft.month) return false;
  if (draft.recurrence === 'once' && !draft.year) return false;
  return true;
}

export default Contacts;
