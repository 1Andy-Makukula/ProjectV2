// Shared vocabulary for money set aside, and for things worth watching.
//
// A budget goal is an earmark over the wallet somebody already has. Nothing
// moves when you set money aside -- the balance is untouched and no ledger row
// is written -- so a goal is a label on part of a balance, not a second purse.
// What makes it real is that checkout subtracts it: `wallet_available_zmw` is
// balance minus reserved, and that is the figure a shopper may spend.
//
// Every amount here is in ngwee, like every other price in this codebase.

export type BudgetGoalStatus = 'active' | 'met' | 'spent' | 'cancelled';

export interface BudgetGoal {
  id: string;
  name: string;
  target_zmw: number;
  reserved_zmw: number;
  status: BudgetGoalStatus;
  /** Any combination, including none. See the migration for why. */
  occasion_id: string | null;
  item_id: string | null;
  shop_id: string | null;
  due_on: string | null;
  created_at: string;
}

/**
 * How full the meter is, 0-100.
 *
 * Clamped at both ends: a goal can be over-funded if its target is lowered
 * after the fact, and a bar past 100% reads as a rendering fault rather than
 * good news.
 */
export function goalProgress(goal: Pick<BudgetGoal, 'reserved_zmw' | 'target_zmw'>): number {
  if (goal.target_zmw <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((goal.reserved_zmw / goal.target_zmw) * 100)));
}

/** What is still to find. Never negative. */
export function goalRemaining(goal: Pick<BudgetGoal, 'reserved_zmw' | 'target_zmw'>): number {
  return Math.max(0, goal.target_zmw - goal.reserved_zmw);
}

export function isGoalMet(goal: Pick<BudgetGoal, 'reserved_zmw' | 'target_zmw'>): boolean {
  return goal.reserved_zmw >= goal.target_zmw;
}

/**
 * Days until a goal is due, or null when it has no date.
 *
 * Deliberately whole days from midnight, matching how `daysUntil` in
 * types/contacts.ts counts, so a goal tied to an occasion and the occasion
 * itself never disagree by one.
 */
export function daysUntilDue(goal: Pick<BudgetGoal, 'due_on'>, today: Date = new Date()): number | null {
  if (!goal.due_on) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = goal.due_on.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

/**
 * What the shopper is told about pacing.
 *
 * Only said when there is a date and something still to find -- "K80 a week"
 * against a goal already met is noise, and against no deadline it is invented.
 */
export function weeklyPace(goal: Pick<BudgetGoal, 'reserved_zmw' | 'target_zmw' | 'due_on'>): number | null {
  const days = daysUntilDue(goal);
  if (days === null || days <= 0) return null;
  const remaining = goalRemaining(goal);
  if (remaining <= 0) return null;
  return Math.ceil(remaining / Math.max(1, days / 7));
}

// ---------------------------------------------------------------------------
// Watches
// ---------------------------------------------------------------------------

export interface PriceWatch {
  id: string;
  item_id: string | null;
  shop_id: string | null;
  /** Only alert at or below this. Null means any drop. */
  target_zmw: number | null;
  last_alerted_on: string | null;
  created_at: string;
}

/** What a watch is on, for a UI that shows one list of both kinds. */
export type WatchTarget =
  | { kind: 'item'; id: string; name: string }
  | { kind: 'shop'; id: string; name: string };

export function watchTargetId(watch: PriceWatch): string {
  return watch.item_id ?? watch.shop_id ?? '';
}
