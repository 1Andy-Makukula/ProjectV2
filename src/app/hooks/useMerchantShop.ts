// Which shop the signed-in merchant runs.
//
// One query, answering one question. `useMerchantDashboard` can answer it too,
// but it arrives at the answer by loading orders twice, the wallet, experience
// links, the shop row and the merchant_shops row, then opening a realtime
// channel — which is right for the dashboard and absurd for a page that only
// needs an id to hang a query off.
//
// The ordering matches the dashboard's (oldest membership first) so a merchant
// belonging to more than one shop sees the same shop in both places. If
// multi-shop merchants ever become a real case, this is where the picker goes.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';

export interface MerchantShop {
  id: string;
  name: string;
  offers_products: boolean;
  offers_services: boolean;
  is_active: boolean;
}

export function useMerchantShop() {
  const { profile } = useAuth();
  const [shop, setShop] = useState<MerchantShop | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) {
      setShop(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from('merchant_shops')
        .select('shop:shops(id, name, offers_products, offers_services, is_active)')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      const row = (data as any)?.shop ?? null;
      setShop(
        error || !row
          ? null
          : {
              id: row.id,
              name: row.name,
              offers_products: row.offers_products ?? true,
              offers_services: row.offers_services ?? false,
              is_active: row.is_active ?? false,
            },
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  return { shop, loading };
}
