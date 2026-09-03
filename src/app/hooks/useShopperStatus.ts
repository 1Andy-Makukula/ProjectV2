import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';

export interface ShopperStatus {
  /** Paid for, prepared, and waiting for the recipient at the shop. */
  toCollect: number;
  /** Paid for and being got ready. */
  preparing: number;
  /** Orders this person sent that have not been collected yet. */
  inFlight: number;
}

const EMPTY: ShopperStatus = { toCollect: 0, preparing: 0, inFlight: 0 };

/** Claim states that still need something to happen. */
const READY = ['FULFILLED', 'PARTIAL_FULFILLMENT'];
const WORKING = ['PENDING', 'PROCESSING_FULFILLMENT'];
const OPEN = [...WORKING, ...READY];

/**
 * The few numbers worth showing a shopper the moment they arrive.
 *
 * Three counts, deliberately — this is a glance, not a dashboard, and every
 * extra figure is another query on the storefront's first paint. They are read
 * with `head: true`, so PostgREST returns the count and no rows at all.
 *
 * Orders arriving *for* you are keyed on phone number, because a gift is
 * addressed to a person rather than to an account — the recipient may not have
 * signed up yet. Orders *from* you are keyed on the buyer id on the
 * transaction.
 */
export function useShopperStatus() {
  const { user, profile } = useAuth();
  const [status, setStatus] = useState<ShopperStatus>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) {
      setStatus(EMPTY);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const phone = profile?.phone ?? null;

      const [ready, working, sent] = await Promise.all([
        phone
          ? supabase
              .from('shop_orders')
              .select('shop_order_id', { count: 'exact', head: true })
              .eq('recipient_phone', phone)
              .in('claim_status', READY)
          : Promise.resolve({ count: 0, error: null }),
        phone
          ? supabase
              .from('shop_orders')
              .select('shop_order_id', { count: 'exact', head: true })
              .eq('recipient_phone', phone)
              .in('claim_status', WORKING)
          : Promise.resolve({ count: 0, error: null }),
        supabase
          .from('shop_orders')
          .select('shop_order_id, transactions!inner(buyer_id)', {
            count: 'exact',
            head: true,
          })
          .eq('transactions.buyer_id', user.id)
          .in('claim_status', OPEN),
      ]);

      setStatus({
        toCollect: ready.count ?? 0,
        preparing: working.count ?? 0,
        inFlight: sent.count ?? 0,
      });
    } catch (error) {
      // A status glance is not worth a toast: the rail simply shows nothing
      // rather than interrupting someone who came here to browse.
      console.error('[useShopperStatus] load failed:', error);
      setStatus(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [user?.id, profile?.phone]);

  useEffect(() => {
    load();
  }, [load]);

  return { status, loading, reload: load };
}
