// Empty State Component

import { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Vector } from './Vector';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  /**
   * Opt in to the shopper character.
   *
   * The charter splits empty states in two: a surface that is the shopper's
   * OWN -- their bag, their wishes, their lists, their contacts -- gets the
   * shopper at L, and everywhere else gets an ink block and one line saying
   * what to do. So this defaults to off; a caller has to know the surface
   * belongs to the person looking at it.
   *
   * Never an apology either way. "Nothing here yet" is a state, not a fault,
   * and the copy stays whatever the caller passed.
   */
  vector?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  vector = false,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center px-4 py-16"
    >
      {vector ? (
        <div className="mb-6">
          <Vector name="shopper" size="L" tag={title} tone="ink" />
        </div>
      ) : (
        <>
          <div className="mb-5 grid size-20 place-items-center rounded-[var(--radius-panel)] bg-surface-paper">
            <Icon className="size-10 text-muted-foreground" strokeWidth={1.5} />
          </div>
          {/* An ink block, not a light grey heading. The point of an empty
              state is that the one thing on the screen is legible. */}
          <h3 className="mb-3 rounded-[var(--radius-block)] bg-ink px-2.5 py-1 text-[11px]
                         font-bold uppercase tracking-[0.06em] text-on-ink">
            {title}
          </h3>
        </>
      )}
      <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
        {description}
      </p>
      {action && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={action.onClick}
          className="rounded-[var(--radius-pill)] bg-primary px-6 py-3 font-semibold text-white
                     transition-colors hover:bg-primary/92
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}
