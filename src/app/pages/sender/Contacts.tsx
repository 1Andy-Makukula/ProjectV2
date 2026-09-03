import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, CakeSlice, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
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
  birthdayLabel,
  countdownLabel,
  daysInMonth,
  daysUntilBirthday,
  type Contact,
} from '../../types/contacts';
import { formatPhoneDisplay } from '../../../utils/phone';

/**
 * The people you send things to.
 *
 * Two lists, and the order matters: the ones already saved, then the ones the
 * app can see you have sent to before but never kept. That second list is the
 * whole trick — it is built from the caller's own orders, so a useful contact
 * book exists before anybody has typed anything or granted any permission.
 */
export function Contacts() {
  const navigate = useNavigate();
  const { contacts, suggestions, loading, busy, create, remove, saveSuggestion } = useContacts();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [month, setMonth] = useState<string>('');
  const [day, setDay] = useState<string>('');

  const reset = () => {
    setName('');
    setPhone('');
    setRelationship('');
    setMonth('');
    setDay('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    const created = await create({
      name,
      phone,
      relationship,
      birthMonth: month ? Number(month) : null,
      birthDay: month && day ? Number(day) : null,
    });

    if (created) {
      reset();
      setOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 border-b bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 md:px-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="flex-1 text-base font-medium tracking-tight">People</h1>
          <Button size="sm" onClick={() => setOpen(true)}>
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
            <ul className="kl-tile divide-y divide-border px-4">
              {contacts.map((contact) => (
                <ContactRow key={contact.id} contact={contact} onRemove={() => remove(contact.id)} />
              ))}
            </ul>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add someone</DialogTitle>
            <DialogDescription>
              A name and a number is enough. The birthday is optional — it is what puts them on
              your storefront before the day arrives.
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

              <div className="space-y-2">
                <Label>Birthday</Label>
                <div className="flex gap-2">
                  <Select
                    value={month}
                    onValueChange={(value) => {
                      setMonth(value);
                      setDay('');
                    }}
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

                  <Select value={day} onValueChange={setDay} disabled={!month}>
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="Day" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: month ? daysInMonth(Number(month)) : 0 }).map(
                        (_, index) => (
                          <SelectItem key={index} value={String(index + 1)}>
                            {index + 1}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs font-light text-muted-foreground">
                  No year asked for — the day is what gets somebody a present.
                </p>
              </div>
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
    </div>
  );
}

function ContactRow({ contact, onRemove }: { contact: Contact; onRemove: () => void }) {
  const birthday = birthdayLabel(contact);
  const days = daysUntilBirthday(contact);

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="kl-gradient-brand-br grid size-10 shrink-0 place-items-center rounded-[var(--radius-pill)]">
        <span className="text-sm font-light text-white">{contact.name.charAt(0).toUpperCase()}</span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{contact.name}</p>
        <p className="truncate text-xs font-light text-muted-foreground">
          {formatPhoneDisplay(contact.phone)}
        </p>
      </div>

      {birthday && (
        <span className="hidden items-center gap-1 text-xs font-light text-muted-foreground sm:inline-flex">
          <CakeSlice className="size-3.5" strokeWidth={2} />
          {birthday}
          {days !== null && days <= 30 && (
            <span className="font-medium text-primary"> · {countdownLabel(days)}</span>
          )}
        </span>
      )}

      {contact.relationship && <Badge variant="secondary">{contact.relationship}</Badge>}

      <button
        onClick={onRemove}
        aria-label={`Remove ${contact.name}`}
        className="rounded-[var(--radius-pill)] p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="size-3.5" strokeWidth={2} />
      </button>
    </li>
  );
}

export default Contacts;
