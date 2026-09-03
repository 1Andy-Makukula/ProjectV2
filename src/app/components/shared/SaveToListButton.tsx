// SaveToListButton — the "save" affordance that every card and detail page shares.
//
// Saving anywhere on KithLy means the same thing: it goes on one of your lists.
// Products, services and whole shops all route through here so the gesture is
// learned once, and the button owns its own dialog state so a card only has to
// say what it is.

import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '../../../utils/auth/AuthContext';
import { AddToListDialog } from './AddToListDialog';
import type { ListTarget } from '../../types/lists';

interface SaveToListButtonProps {
  target: ListTarget;
  /**
   * `overlay` sits on top of a card's image and carries its own backdrop;
   * `inline` is a plain button for a toolbar or detail page.
   */
  variant?: 'overlay' | 'inline';
  className?: string;
  label?: string;
}

export function SaveToListButton({
  target,
  variant = 'overlay',
  className = '',
  label,
}: SaveToListButtonProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  // Cards are themselves buttons — saving must never also open the thing.
  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();

    if (!user) {
      toast.info('Sign in to save this to a list');
      navigate('/login');
      return;
    }

    setOpen(true);
  };

  // Both shapes are pills wearing the same gradient rim as every other
  // control; only the proportions differ.
  const base =
    variant === 'overlay'
      ? `kl-rim kl-float grid size-9 place-items-center rounded-[var(--radius-pill)]
         bg-background/85 text-muted-foreground backdrop-blur-sm
         transition-colors hover:text-primary`
      : `kl-rim kl-float inline-flex items-center gap-1.5 rounded-[var(--radius-pill)]
         bg-background px-4 h-9 text-[0.8125rem] font-medium text-foreground
         transition-colors hover:text-primary`;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={label ?? `Save ${target.name} to a list`}
        title={label ?? 'Save to a list'}
        className={`${base} ${className}`}
      >
        <Bookmark className={variant === 'overlay' ? 'h-4 w-4' : 'h-3.5 w-3.5'} strokeWidth={2} />
        {variant === 'inline' && (label ?? 'Save')}
      </button>

      {/* Mounted only once opened: each dialog loads the viewer's lists, and a
          grid of cards must not fire one query per card on render. */}
      {open && <AddToListDialog open={open} onOpenChange={setOpen} target={target} />}
    </>
  );
}
