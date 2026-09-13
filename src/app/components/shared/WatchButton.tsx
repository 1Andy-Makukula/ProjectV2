// WatchButton — "tell me when this drops".
//
// Deliberately built like SaveToListButton, because it sits beside it on the
// same cards and the two gestures should feel like siblings: same overlay
// treatment, same stopPropagation so a card that is itself a button does not
// also open, same sign-in redirect.
//
// The distinction it has to carry is that saving is about *wanting* something
// and watching is about *waiting* for it. Hence the tag rather than a bookmark,
// and a filled state that reads as armed rather than collected.

import { Tag } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useWatchState } from '../../hooks/usePriceWatches';

interface WatchButtonProps {
  /** One or the other. A shop watch covers everything the shop sells. */
  itemId?: string;
  shopId?: string;
  /**
   * `overlay` sits on a card's image with its own backdrop; `inline` is a plain
   * button for a toolbar or a detail page.
   */
  variant?: 'overlay' | 'inline';
  className?: string;
  label?: string;
}

export function WatchButton({
  itemId,
  shopId,
  variant = 'overlay',
  className = '',
  label,
}: WatchButtonProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isWatching, toggle, busy } = useWatchState({ itemId, shopId });

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();

    if (!user) {
      toast.info('Sign in to watch this price');
      navigate('/login');
      return;
    }
    void toggle();
  };

  // Announced by what it will do, not by its current state, so a screen reader
  // hears the same thing a sighted user reads from the fill.
  const accessibleName = isWatching
    ? 'Stop watching this price'
    : shopId
      ? 'Watch this shop for price drops'
      : 'Watch this price';

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-pressed={isWatching}
        aria-label={accessibleName}
        className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5
                    text-sm font-medium transition-colors disabled:opacity-60
                    ${
                      isWatching
                        ? 'border-transparent bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    } ${className}`}
      >
        <Tag className="size-4" strokeWidth={2} fill={isWatching ? 'currentColor' : 'none'} />
        {label ?? (isWatching ? 'Watching' : 'Watch price')}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-pressed={isWatching}
      aria-label={accessibleName}
      className={`grid size-8 place-items-center rounded-full backdrop-blur-sm transition-colors
                  disabled:opacity-60
                  ${
                    isWatching
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background/80 text-muted-foreground hover:text-foreground'
                  } ${className}`}
    >
      <Tag className="size-4" strokeWidth={2} fill={isWatching ? 'currentColor' : 'none'} />
    </button>
  );
}

export default WatchButton;
