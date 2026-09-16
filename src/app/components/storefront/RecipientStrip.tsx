import { useNavigate } from 'react-router';
import { UserPlus, X } from 'lucide-react';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useContacts } from '../../hooks/useContacts';
import { useSendFlowStore } from '../../../utils/sendFlowStore';

/**
 * Who this is for, asked before what it is.
 *
 * The inversion the whole intent layer is built around: a diaspora sender is
 * thinking about a person, not a product. Picking one here writes it into
 * useSendFlowStore, which Checkout already reads to prefill the recipient
 * fields — so the address book is filled in once, at the start, rather than
 * typed from memory at the end.
 *
 * Skipping is always allowed, and always the default. Nothing below this
 * requires a recipient to have been chosen; picking one only saves typing.
 */
export function RecipientStrip() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { contacts, loading } = useContacts();
  const { recipient, setRecipient, clearRecipient } = useSendFlowStore();

  // Contacts are per-account, so there is nothing to show a signed-out visitor
  // and a prompt to sign in would be a toll gate on the front door.
  if (!user || loading) return null;

  if (recipient?.name) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-light text-muted-foreground">Sending to</span>
        <span className="kl-rim inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-primary-tint py-1 pl-3 pr-1.5 text-sm font-medium text-primary">
          {recipient.name}
          <button
            onClick={clearRecipient}
            aria-label={`Stop sending to ${recipient.name}`}
            className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-primary/15"
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </span>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <button
        onClick={() => navigate('/contacts')}
        className="mb-4 flex items-center gap-1.5 text-sm font-light text-muted-foreground transition-colors hover:text-slate-900"
      >
        <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
        Save the people you send to, and they turn up here
      </button>
    );
  }

  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {contacts.slice(0, 8).map((contact) => (
        <button
          key={contact.id}
          onClick={() =>
            setRecipient({ name: contact.name, phone: contact.phone, message: '' })
          }
          className="kl-rim flex shrink-0 items-center gap-2 rounded-[var(--radius-pill)] bg-card py-1.5 pl-1.5 pr-3.5 text-left shadow-[var(--shadow-float)] transition-transform hover:-translate-y-0.5"
        >
          <span className="kl-gradient-brand-br flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white">
            {contact.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[0.8125rem] font-medium leading-tight text-slate-900">
              {contact.name}
            </span>
            {contact.relationship && (
              <span className="block truncate text-[0.6875rem] font-light leading-tight text-muted-foreground">
                {contact.relationship}
              </span>
            )}
          </span>
        </button>
      ))}

      <button
        onClick={() => navigate('/contacts')}
        className="kl-rim flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] bg-card px-3.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground shadow-[var(--shadow-float)] transition-transform hover:-translate-y-0.5"
      >
        <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
        Someone else
      </button>
    </div>
  );
}
