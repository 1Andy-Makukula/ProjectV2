import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { DEFAULT_FEE_RATES, type PlatformFeeRates } from '../../utils/pricing';

/**
 * Live buyer-facing fee rates from `platform_settings`.
 *
 * Falls back to the column defaults if the read fails: the checkout screen
 * showing a slightly stale fee is far better than it showing nothing, and the
 * server recomputes the real figure at checkout either way.
 */
export function usePlatformPricing() {
  const [rates, setRates] = useState<PlatformFeeRates>(DEFAULT_FEE_RATES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data, error } = await supabase
          .from('platform_settings')
          .select('local_buyer_fee_percent, international_buyer_fee_percent')
          .eq('id', 1)
          .single();

        if (error) throw error;
        if (cancelled || !data) return;

        setRates({
          local: Number(data.local_buyer_fee_percent ?? DEFAULT_FEE_RATES.local),
          international: Number(
            data.international_buyer_fee_percent ?? DEFAULT_FEE_RATES.international,
          ),
        });
      } catch (err) {
        console.error('[usePlatformPricing] Falling back to default rates:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { rates, loading };
}
