import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';

/**
 * What a sender's money is doing, now that they do not have a wallet.
 *
 * The distinction this hook exists to preserve: none of these figures is a
 * balance. `awaiting_collection` is committed to specific gifts the recipient
 * has not picked up yet; `refund_on_the_way` is already heading back to the
 * card they paid with; `refund_needs_details` is money we owe them and could
 * not deliver. The sender can spend none of it, and the UI must not imply
 * otherwise -- which is why `is_spendable` comes back from the server as a
 * flag rather than being something the component decides.
 */

export interface SenderEscrow {
  awaiting_collection_ngwee: number;
  refund_on_the_way_ngwee: number;
  refund_needs_details_ngwee: number;
  total_in_escrow_ngwee: number;
  is_spendable: boolean;
}

export interface ExpiringGift {
  shop_order_id: string;
  claim_code: string | null;
  recipient_name: string | null;
  expires_at: string;
  expiry_extensions: number;
  shop_name: string | null;
}

export function useSenderEscrow() {
  const { profile } = useAuth();
  const [escrow, setEscrow] = useState<SenderEscrow | null>(null);
  const [expiring, setExpiring] = useState<ExpiringGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [extending, setExtending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [summaryRes, giftsRes] = await Promise.all([
        supabase.rpc('sender_escrow_summary', { p_user_id: profile.id }),
        // Gifts close enough to expiry that the sender can still do something
        // about it. Fourteen days out is too early to nag; a day is too late
        // to act. Seven is the reminder cadence the dispatcher already uses.
        supabase
          .from('shop_orders')
          .select(
            'shop_order_id, claim_code, recipient_name, expires_at, expiry_extensions, shops(name), transactions!inner(buyer_id)',
          )
          .eq('transactions.buyer_id', profile.id)
          .eq('claim_status', 'PENDING')
          .not('expires_at', 'is', null)
          .lt('expires_at', new Date(Date.now() + 7 * 864e5).toISOString())
          .gt('expires_at', new Date().toISOString())
          .order('expires_at', { ascending: true })
          .limit(10),
      ]);

      if (!summaryRes.error) {
        setEscrow(summaryRes.data as unknown as SenderEscrow);
      }

      if (!giftsRes.error && giftsRes.data) {
        setExpiring(
          giftsRes.data.map((row: Record<string, unknown>) => ({
            shop_order_id: row.shop_order_id as string,
            claim_code: (row.claim_code as string) ?? null,
            recipient_name: (row.recipient_name as string) ?? null,
            expires_at: row.expires_at as string,
            expiry_extensions: (row.expiry_extensions as number) ?? 0,
            shop_name:
              ((row.shops as { name?: string } | null)?.name as string) ?? null,
          })),
        );
      }
    } catch (err) {
      console.error('[useSenderEscrow] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Buy the recipient more time. Moves a date, not money -- which is why the
   * sender can call this RPC directly rather than through an Edge Function.
   */
  const extendGift = useCallback(
    async (shopOrderId: string): Promise<{ ok: boolean; error?: string; expiresAt?: string }> => {
      if (!profile?.id) return { ok: false, error: 'You are not signed in.' };

      setExtending(shopOrderId);
      try {
        const { data, error } = await supabase.rpc('extend_voucher_window', {
          p_shop_order_id: shopOrderId,
          p_actor_user_id: profile.id,
        });

        if (error) return { ok: false, error: error.message };

        await refresh();
        return {
          ok: true,
          expiresAt: (data as Record<string, unknown>)?.expires_at as string,
        };
      } finally {
        setExtending(null);
      }
    },
    [profile?.id, refresh],
  );

  return { escrow, expiring, loading, extending, refresh, extendGift };
}
