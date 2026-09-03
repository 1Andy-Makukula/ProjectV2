import { useState } from 'react';
import { Search, UserPlus, Users } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useContacts } from '../../hooks/useContacts';
import {
  countdownLabel,
  daysUntil,
  occasionTitle,
  type Contact,
  type ContactSuggestion,
} from '../../types/contacts';
import { formatPhoneDisplay } from '../../../utils/phone';

interface ContactPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen person's name and number. */
  onPick: (person: { name: string; phone: string }) => void;
}

/**
 * Choose who this is going to.
 *
 * The send flow has always asked people to type a phone number from memory,
 * every time, for the same handful of people. This offers the ones already
 * saved — and, underneath them, the ones they have sent to before but never
 * saved, which can be picked and kept in the same tap.
 */
export function ContactPickerDialog({ open, onOpenChange, onPick }: ContactPickerDialogProps) {
  const { contacts, suggestions, loading, busy, saveSuggestion } = useContacts();
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const matches = (name: string, phone: string) =>
    !needle || name.toLowerCase().includes(needle) || phone.includes(needle);

  const savedShown = contacts.filter((c) => matches(c.name, c.phone));
  const suggestedShown = suggestions.filter((s) => matches(s.name, s.phone));

  const pick = (name: string, phone: string) => {
    onPick({ name, phone });
    onOpenChange(false);
  };

  const keepAndPick = async (suggestion: ContactSuggestion) => {
    await saveSuggestion(suggestion);
    pick(suggestion.name, suggestion.phone);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who is this for?</DialogTitle>
          <DialogDescription>
            Pick someone you have saved, or someone you have sent to before.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or number"
            className="pl-9"
          />
        </div>

        <DialogBody>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : savedShown.length === 0 && suggestedShown.length === 0 ? (
            <div className="py-8 text-center">
              <Users className="mx-auto mb-2 size-8 text-slate-300" strokeWidth={1} />
              <p className="text-sm text-muted-foreground">
                {needle
                  ? 'Nobody matches that.'
                  : 'No saved contacts yet — type the number below and it can be saved as you send.'}
              </p>
            </div>
          ) : (
            <>
              {savedShown.length > 0 && (
                <ul className="divide-y divide-border">
                  {savedShown.map((contact) => (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      onClick={() => pick(contact.name, contact.phone)}
                    />
                  ))}
                </ul>
              )}

              {suggestedShown.length > 0 && (
                <div className="pt-4">
                  <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Sent to before
                  </p>
                  <ul className="divide-y divide-border">
                    {suggestedShown.map((suggestion) => (
                      <li
                        key={suggestion.phone}
                        className="flex items-center gap-3 py-2.5"
                      >
                        <button
                          onClick={() => pick(suggestion.name, suggestion.phone)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-medium">{suggestion.name}</p>
                          <p className="truncate text-xs font-light text-muted-foreground">
                            {formatPhoneDisplay(suggestion.phone)}
                            {suggestion.timesSent > 1 && ` · ${suggestion.timesSent} times`}
                          </p>
                        </button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => keepAndPick(suggestion)}
                        >
                          <UserPlus className="size-3.5" />
                          Keep
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function ContactRow({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  // The soonest thing coming up, if anything is close enough to mention.
  const next = contact.occasions
    .map((occasion) => ({ occasion, days: daysUntil(occasion) }))
    .filter((entry): entry is { occasion: (typeof contact.occasions)[number]; days: number } =>
      entry.days !== null && entry.days <= 30,
    )
    .sort((a, b) => a.days - b.days)[0];

  return (
    <li>
      <button
        onClick={onClick}
        className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-accent"
      >
        <div className="kl-gradient-brand-br grid size-9 shrink-0 place-items-center rounded-[var(--radius-pill)]">
          <span className="text-sm font-light text-white">
            {contact.name.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{contact.name}</p>
          <p className="truncate text-xs font-light text-muted-foreground">
            {formatPhoneDisplay(contact.phone)}
            {next && ` · ${occasionTitle(next.occasion)} ${countdownLabel(next.days).toLowerCase()}`}
          </p>
        </div>
        {contact.relationship && <Badge variant="secondary">{contact.relationship}</Badge>}
      </button>
    </li>
  );
}
