// BudgetMeter — how far along a goal is.
//
// The bar is the whole point of the feature, so it is drawn to say something
// true rather than just look full: the fill is the share actually set aside,
// and the figures beside it are what is held and what is still to find.
//
// A meter that only showed a percentage would be the wrong abstraction. People
// save in kwacha, not in percent, and "K80 to go" is what decides whether they
// add something this week.

import { formatCurrency } from '../../../utils/currency';
import {
  daysUntilDue,
  goalProgress,
  goalRemaining,
  isGoalMet,
  weeklyPace,
  type BudgetGoal,
} from '../../types/budgets';

interface BudgetMeterProps {
  goal: Pick<BudgetGoal, 'name' | 'target_zmw' | 'reserved_zmw' | 'due_on'>;
  /** `full` shows the pacing line; `compact` is for a rail tile. */
  size?: 'full' | 'compact';
  className?: string;
}

export function BudgetMeter({ goal, size = 'full', className = '' }: BudgetMeterProps) {
  const percent = goalProgress(goal);
  const remaining = goalRemaining(goal);
  const met = isGoalMet(goal);
  const days = daysUntilDue(goal);
  const pace = weeklyPace(goal);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground">{goal.name}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {formatCurrency(goal.reserved_zmw)}
          <span className="text-muted-foreground/70"> / {formatCurrency(goal.target_zmw)}</span>
        </span>
      </div>

      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${goal.name}: ${percent}% set aside`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out
                      ${met ? 'bg-[var(--success)]' : 'kl-gradient-brand'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {size === 'full' && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {met ? (
            <span className="font-medium text-[var(--success)]">Ready.</span>
          ) : (
            <>
              <span className="tabular-nums">{formatCurrency(remaining)}</span> to go
              {/* Pacing is only offered when it is real: there has to be a date,
                  and it has to still be ahead. Otherwise it would be invented. */}
              {pace !== null && (
                <>
                  {' · '}
                  <span className="tabular-nums">{formatCurrency(pace)}</span> a week
                </>
              )}
              {days !== null && days >= 0 && (
                <>
                  {' · '}
                  {days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `${days} days left`}
                </>
              )}
              {days !== null && days < 0 && <> · date passed</>}
            </>
          )}
        </p>
      )}
    </div>
  );
}

export default BudgetMeter;
