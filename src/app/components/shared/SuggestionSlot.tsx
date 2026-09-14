// SuggestionSlot — a suggestion that fades in where you already are.
//
// The point of this is not the recommendation, it is the dismissal. Explicit
// negative feedback is the rarest thing a ranker can be given, and it only
// exists if refusing is as easy as accepting. So "No thanks" is a real button
// with the same weight as the other one, not a small grey x in a corner.
//
// It renders NOTHING when there is nothing to suggest, and removes itself the
// moment it is answered. A slot that sits there empty, or that lingers after
// you have said no, is how a helpful feature becomes furniture people learn to
// scroll past.

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '../../../utils/currency';
import { useProposals, type Proposal } from '../../hooks/useProposals';
import { Button } from '../ui/button';

interface SuggestionSlotProps {
  /** Which surface's suggestions to show. Null shows any. */
  surface?: string;
  className?: string;
  /** Called after an accepted suggestion, so the host can refresh. */
  onAccepted?: (proposal: Proposal) => void;
}

export function SuggestionSlot({ surface, className = '', onAccepted }: SuggestionSlotProps) {
  const { proposals, answer, loading } = useProposals(surface);
  const [shown, setShown] = useState(false);

  const proposal = proposals[0] ?? null;

  // Fades in rather than appearing, so it reads as arriving beside what you
  // were already doing instead of interrupting it.
  useEffect(() => {
    if (!proposal) {
      setShown(false);
      return;
    }
    const id = window.setTimeout(() => setShown(true), 120);
    return () => window.clearTimeout(id);
  }, [proposal?.id]);

  if (loading || !proposal) return null;

  // An item that sold out between the proposal being written and being read
  // is dropped server-side, so a proposal can arrive with nothing left in it.
  if (proposal.items.length === 0) return null;

  const handle = async (accepted: boolean) => {
    setShown(false);
    await answer(proposal.id, accepted);
    if (accepted) {
      toast.success('Added');
      onAccepted?.(proposal);
    }
  };

  return (
    <section
      className={`kl-rim overflow-hidden rounded-[var(--radius-lg)] bg-[var(--primary-tint)]
                  transition-opacity duration-500 ${shown ? 'opacity-100' : 'opacity-0'} ${className}`}
      aria-label="Suggestion"
    >
      <div className="flex items-start gap-2.5 p-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">{proposal.reason_text}</p>

          <ul className="mt-2 space-y-1">
            {proposal.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="size-7 shrink-0 rounded object-cover" />
                ) : (
                  <span className="size-7 shrink-0 rounded bg-background/60" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{item.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(item.price_zmw)}
                </span>
              </li>
            ))}
          </ul>

          {proposal.items.length > 1 && proposal.total_zmw != null && (
            <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
              {formatCurrency(proposal.total_zmw)} together
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={() => handle(true)}>
              Add {proposal.items.length > 1 ? 'these' : 'it'}
            </Button>
            {/* Refusing has to be as easy as accepting, or the dismissal
                signal -- the whole reason this is a row in a table -- never
                arrives. */}
            <Button size="sm" variant="ghost" onClick={() => handle(false)}>
              No thanks
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default SuggestionSlot;
