// BudgetPanel — the dashboard's third thing.
//
// The dashboard already splits into sending and receiving. Budgeting is
// neither: it is *preparing*, which is why it gets its own panel rather than
// being squeezed into one of the two.
//
// It belongs here and not on the storefront by the test that separates the two
// surfaces: does it change while you are not looking? A goal fills, a watched
// price drops, a date approaches. Things with state live in the dashboard; the
// storefront only prompts about them.

import { useState } from 'react';
import { PiggyBank, Plus, Tag, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { formatCurrency } from '../../../utils/currency';
import { useBudgetGoals } from '../../hooks/useBudgetGoals';
import { usePriceWatches } from '../../hooks/usePriceWatches';
import { BudgetMeter } from './BudgetMeter';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { EmptyState } from './EmptyState';

/** Kwacha in the box, ngwee in the database. Converted in exactly one place. */
const toNgwee = (kwacha: string): number => Math.round(Number(kwacha) * 100);

export function BudgetPanel() {
  const navigate = useNavigate();
  const { activeGoals, available, totalReserved, loading, busyId, createGoal, move, closeGoal } =
    useBudgetGoals();
  const { watches, loading: watchesLoading, stopWatching } = usePriceWatches();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addAmount, setAddAmount] = useState('');

  const handleCreate = async () => {
    const targetNgwee = toNgwee(target);
    if (!name.trim() || !Number.isFinite(targetNgwee) || targetNgwee <= 0) return;

    const created = await createGoal({
      name: name.trim(),
      target_zmw: targetNgwee,
      due_on: dueOn || null,
    });
    if (created) {
      setName('');
      setTarget('');
      setDueOn('');
      setCreating(false);
    }
  };

  const handleAdd = async (goalId: string) => {
    const amount = toNgwee(addAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await move(goalId, amount);
    setAddAmount('');
    setAddingTo(null);
  };

  return (
    <div className="space-y-8">
      {/* ── What is spendable ──────────────────────────────────────────── */}
      <section className="kl-tile p-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Available to spend
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {formatCurrency(available)}
            </p>
          </div>
          {totalReserved > 0 && (
            <p className="text-right text-xs text-muted-foreground">
              <span className="tabular-nums">{formatCurrency(totalReserved)}</span>
              <br />
              set aside
            </p>
          )}
        </div>
        {/* Said plainly, because the alternative is a shopper discovering at
            checkout that their balance is not all theirs to use. */}
        {totalReserved > 0 && (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            Money in a goal cannot be spent at checkout until you release it.
          </p>
        )}
      </section>

      {/* ── Goals ─────────────────────────────────────────────────────── */}
      <section>
        <header className="mb-3 flex items-center gap-1.5">
          <PiggyBank className="size-3.5 text-primary" strokeWidth={2} />
          <h3 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Saving for
          </h3>
          <button
            onClick={() => setCreating((v) => !v)}
            className="ml-auto inline-flex items-center gap-0.5 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="size-3" strokeWidth={2} />
            New goal
          </button>
        </header>

        {creating && (
          <div className="kl-rim mb-3 space-y-2 rounded-[var(--radius-lg)] bg-background p-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What is it for?"
              aria-label="Goal name"
            />
            <div className="flex gap-2">
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                inputMode="decimal"
                placeholder="Amount"
                aria-label="Target amount in kwacha"
              />
              <Input
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                type="date"
                aria-label="Due date, optional"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={!name.trim() || !target}>
                Create
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : activeGoals.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="Nothing set aside yet"
            description="Put money towards something before you need it, and checkout will leave it alone."
          />
        ) : (
          <div className="space-y-3">
            {activeGoals.map((goal) => (
              <div key={goal.id} className="kl-tile p-4">
                <BudgetMeter goal={goal} />

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {addingTo === goal.id ? (
                    <>
                      <Input
                        value={addAmount}
                        onChange={(e) => setAddAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder="Amount"
                        aria-label={`Amount to set aside for ${goal.name}`}
                        className="h-8 w-28"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleAdd(goal.id)}
                        disabled={busyId === goal.id || !addAmount}
                      >
                        Set aside
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAddingTo(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAddingTo(goal.id)}
                        disabled={available <= 0}
                      >
                        Set money aside
                      </Button>
                      {goal.reserved_zmw > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => move(goal.id, -goal.reserved_zmw)}
                          disabled={busyId === goal.id}
                        >
                          Release all
                        </Button>
                      )}
                      <button
                        onClick={() => closeGoal(goal.id, 'cancelled')}
                        className="ml-auto text-xs text-muted-foreground transition-colors hover:text-destructive"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>

                {available <= 0 && addingTo !== goal.id && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Nothing available to set aside right now.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Watches ───────────────────────────────────────────────────── */}
      <section>
        <header className="mb-3 flex items-center gap-1.5">
          <Tag className="size-3.5 text-primary" strokeWidth={2} />
          <h3 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Watching
          </h3>
        </header>

        {watchesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : watches.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="Not watching anything"
            description="Watch an item or a shop and we will tell you when the price drops."
          />
        ) : (
          <ul className="space-y-1">
            {watches.map((watch) => (
              <li
                key={watch.id}
                className="flex items-center gap-2.5 rounded-[var(--radius-lg)] p-1.5 transition-colors hover:bg-accent"
              >
                <button
                  onClick={() =>
                    navigate(
                      watch.subject_kind === 'item'
                        ? `/item/${watch.item_id}`
                        : `/shop/${watch.shop_id}`,
                    )
                  }
                  className="flex-1 truncate text-left text-sm text-foreground"
                >
                  {watch.subject_name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {watch.subject_kind === 'shop'
                      ? 'whole shop'
                      : watch.current_price_zmw !== null
                        ? formatCurrency(watch.current_price_zmw)
                        : ''}
                    {watch.target_zmw !== null && (
                      <> · alert under {formatCurrency(watch.target_zmw)}</>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => stopWatching(watch.id)}
                  aria-label={`Stop watching ${watch.subject_name}`}
                  className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default BudgetPanel;
