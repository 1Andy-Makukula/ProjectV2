// Budget goals, and the wallet figure they hold down.
//
// Reserving and releasing go through RPCs rather than a table write, because
// `kithly_wallets.reserved_zmw` is recomputed from the goals and both have to
// move in one transaction. Writing `reserved_zmw` straight onto a goal would
// work and would be the wrong habit: the RPC is also where "you only have K200
// free" is decided, and a client that skips it discovers the limit as a raised
// exception instead of a sentence.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import type { BudgetGoal } from '../types/budgets';

const GOAL_SELECT =
  'id, name, target_zmw, reserved_zmw, status, occasion_id, item_id, shop_id, due_on, created_at';

export function useBudgetGoals() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<BudgetGoal[]>([]);
  const [available, setAvailable] = useState(0);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setGoals([]);
      setAvailable(0);
      setBalance(0);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // The wallet is read rather than derived here: `available` is
      // balance - reserved on the server, and recomputing it client-side is how
      // the two drift apart.
      const [goalsResult, walletResult] = await Promise.all([
        supabase
          .from('budget_goals')
          .select(GOAL_SELECT)
          .eq('user_id', user.id)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false }),
        supabase
          .from('kithly_wallets')
          .select('balance, reserved_zmw')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      if (goalsResult.error) throw goalsResult.error;
      setGoals((goalsResult.data as BudgetGoal[]) ?? []);

      const wallet = walletResult.data as { balance: number; reserved_zmw: number } | null;
      setBalance(wallet?.balance ?? 0);
      setAvailable(Math.max(0, (wallet?.balance ?? 0) - (wallet?.reserved_zmw ?? 0)));
    } catch (err) {
      console.error('[useBudgetGoals] load failed:', err);
      toast.error('Could not load your budgets');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const createGoal = useCallback(
    async (input: {
      name: string;
      target_zmw: number;
      due_on?: string | null;
      occasion_id?: string | null;
      item_id?: string | null;
      shop_id?: string | null;
    }) => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('budget_goals')
        .insert({ ...input, user_id: user.id })
        .select(GOAL_SELECT)
        .single();

      if (error) {
        console.error('[useBudgetGoals] create failed:', error);
        toast.error('Could not create that goal');
        return null;
      }

      setGoals((prev) => [data as BudgetGoal, ...prev]);
      return data as BudgetGoal;
    },
    [user],
  );

  /** Positive to set aside, negative to give back. */
  const move = useCallback(
    async (goalId: string, amountZmw: number) => {
      if (amountZmw === 0) return;
      setBusyId(goalId);
      try {
        const fn = amountZmw > 0 ? 'reserve_to_goal' : 'release_from_goal';
        const { error } = await supabase.rpc(fn, {
          p_goal_id: goalId,
          p_amount: Math.abs(amountZmw),
        });

        if (error) {
          // The RPC raises with the real figure in the message -- "only 20000
          // available to set aside" -- which is more use than a generic error.
          toast.error(error.message.replace(/^.*?:\s*/, ''));
          return;
        }
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  /** Closing a goal releases its hold, because the trigger sums active goals only. */
  const closeGoal = useCallback(
    async (goalId: string, status: 'met' | 'spent' | 'cancelled') => {
      const { error } = await supabase.from('budget_goals').update({ status }).eq('id', goalId);
      if (error) {
        toast.error('Could not update that goal');
        return;
      }
      await load();
    },
    [load],
  );

  const totalReserved = useMemo(
    () => goals.filter((g) => g.status === 'active').reduce((sum, g) => sum + g.reserved_zmw, 0),
    [goals],
  );

  return {
    goals,
    activeGoals: useMemo(() => goals.filter((g) => g.status === 'active'), [goals]),
    balance,
    available,
    totalReserved,
    loading,
    busyId,
    createGoal,
    move,
    closeGoal,
    refresh: load,
  };
}
