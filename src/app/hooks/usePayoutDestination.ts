import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

/**
 * A shop's payout destination, its verification state, and its settlement tier.
 *
 * These three belong together because they answer one question the merchant
 * actually has: "can I take a collection right now, and when do I get paid?"
 * Splitting them across two hooks would let the panel render a contradiction --
 * a tier promising instant payouts above a destination that cannot receive one.
 *
 * Reads go through RPCs rather than table selects so the answer the UI shows is
 * the same answer the redemption path enforces. A UI predicate that agrees with
 * the server "usually" is how a cashier ends up arguing with a scanner.
 */

export interface PayoutReadiness {
  can_accept_redemptions: boolean;
  reason: string;
  message?: string;
  destination_id?: string;
  rail?: 'airtel_money' | 'bank';
  account_identifier?: string;
  account_name?: string;
  verified_at?: string;
  error?: string | null;
}

export interface SettlementStatus {
  tier: string;
  label: string;
  hold_seconds: number;
  instant: boolean;
  explanation: string;
  under_review: boolean;
  flag_reason: string | null;
  successful_redemptions: number;
  next_tier: string | null;
  next_tier_label: string | null;
  redemptions_to_next: number | null;
  since: string | null;
}

export interface PayoutSummary {
  owed_ngwee: number;
  scheduled_ngwee: number;
  in_flight_ngwee: number;
  needs_attention_ngwee: number;
  paid_last_30_days_ngwee: number;
  next_payout_at: string | null;
}

export function usePayoutDestination(shopId: string | null | undefined) {
  const [readiness, setReadiness] = useState<PayoutReadiness | null>(null);
  const [settlement, setSettlement] = useState<SettlementStatus | null>(null);
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [readinessRes, settlementRes, summaryRes] = await Promise.all([
        supabase.rpc('shop_payout_readiness', { p_shop_id: shopId }),
        supabase.rpc('merchant_settlement_status', { p_shop_id: shopId }),
        supabase.rpc('merchant_payout_summary', { p_shop_id: shopId }),
      ]);

      if (readinessRes.error) throw readinessRes.error;

      setReadiness(readinessRes.data as unknown as PayoutReadiness);
      if (!settlementRes.error) {
        setSettlement(settlementRes.data as unknown as SettlementStatus);
      }
      if (!summaryRes.error) {
        setSummary(summaryRes.data as unknown as PayoutSummary);
      }
      setError(null);
    } catch (err) {
      console.error('[usePayoutDestination] load failed:', err);
      // Deliberately does NOT fall back to "ready". A panel that guesses the
      // merchant can trade when it could not check is worse than one that says
      // it does not know: the first sends them to the till.
      setReadiness(null);
      setError('We could not check your payout details just now.');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Saves a new destination. Always lands unverified, by design -- there is no
   * path that sets details and marks them proven in one step.
   */
  const saveDestination = useCallback(
    async (input: {
      rail: 'airtel_money' | 'bank';
      accountIdentifier: string;
      accountName: string;
      bankName?: string;
      bankBranch?: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (!shopId) return { ok: false, error: 'No shop selected.' };

      setSaving(true);
      try {
        const { data: session } = await supabase.auth.getSession();
        const userId = session?.session?.user?.id;
        if (!userId) return { ok: false, error: 'You are not signed in.' };

        const { error: rpcError } = await supabase.rpc('set_payout_destination', {
          p_shop_id: shopId,
          p_actor_user_id: userId,
          p_rail: input.rail,
          p_account_identifier: input.accountIdentifier,
          p_account_name: input.accountName,
          p_bank_name: input.bankName ?? null,
          p_bank_branch: input.bankBranch ?? null,
        });

        if (rpcError) return { ok: false, error: rpcError.message };

        await refresh();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        setSaving(false);
      }
    },
    [shopId, refresh],
  );

  /**
   * Asks the rail whether the destination is real. The Edge Function holds the
   * provider credentials; the browser never does.
   */
  const verifyDestination = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
    verifiedName?: string | null;
    nameMatches?: boolean | null;
  }> => {
    if (!shopId) return { ok: false, error: 'No shop selected.' };

    setVerifying(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'verify-payout-destination',
        { body: { shop_id: shopId, destination_id: readiness?.destination_id } },
      );

      await refresh();

      if (fnError) {
        return { ok: false, error: 'We could not reach the verification service.' };
      }
      const result = data as { verification_status?: string; error?: string; verified_account_name?: string | null; name_matches_claim?: boolean | null };

      if (result?.verification_status === 'verified') {
        return {
          ok: true,
          verifiedName: result.verified_account_name ?? null,
          nameMatches: result.name_matches_claim ?? null,
        };
      }
      if (result?.verification_status === 'pending') {
        return { ok: true, verifiedName: null, nameMatches: null };
      }
      return { ok: false, error: result?.error ?? 'Those details could not be verified.' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      setVerifying(false);
    }
  }, [shopId, readiness?.destination_id, refresh]);

  return {
    readiness,
    settlement,
    summary,
    loading,
    saving,
    verifying,
    error,
    refresh,
    saveDestination,
    verifyDestination,
  };
}
