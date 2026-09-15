import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export type EscrowMode = 'legacy' | 'dual_write' | 'escrow_v2';

/**
 * Which money model is live.
 *
 *   legacy / dual_write  sender wallets and merchant float still exist and
 *                        still work. `dual_write` additionally records every
 *                        movement in the double-entry ledger, changing nothing
 *                        the user can see.
 *   escrow_v2            there is no stored value. No wallet balance, no
 *                        spendable credit, no withdrawal.
 *
 * WHY THE FALLBACK IS `dual_write` AND NOT `escrow_v2`
 * ----------------------------------------------------
 * If this read fails, the UI has to guess. Guessing `escrow_v2` would hide a
 * balance a user genuinely holds and can genuinely spend, which looks exactly
 * like their money vanishing. Guessing `dual_write` at worst offers a credit
 * the server then refuses -- recoverable, and honest about what went wrong.
 *
 * The server is the authority either way: `refuse_stored_value` blocks the
 * write regardless of what the browser believes.
 */
export function useEscrowMode() {
  const [mode, setMode] = useState<EscrowMode>('dual_write');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data, error } = await supabase
          .from('platform_settings')
          .select('escrow_mode')
          .eq('id', 1)
          .single();

        if (error) throw error;
        if (cancelled || !data?.escrow_mode) return;
        setMode(data.escrow_mode as EscrowMode);
      } catch (err) {
        console.error('[useEscrowMode] Falling back to dual_write:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    mode,
    loading,
    /** True once stored value is retired: no wallet, no credits, no withdrawals. */
    storedValueRetired: mode === 'escrow_v2',
  };
}
