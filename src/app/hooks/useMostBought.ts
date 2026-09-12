// What people actually bought.
//
// The one trending number this platform can state honestly today. There is no
// view, impression or session tracking anywhere in the schema, so "most
// visited" — which the reference designs show — is not available and is not
// faked. This is counted from real SUCCESS transactions.
//
// The floor matters as much as the count. A module reading "1 bought" says
// "nothing happens here" more loudly than no module at all, which is the same
// reasoning StatusModule already applies to its zeroes. The list comes back
// empty until something clears the minimum, and an empty list renders nothing.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export interface BoughtItem {
  item_id: string;
  name: string;
  image_url: string | null;
  shop_id: string;
  shop_name: string;
  bought_count: number;
}

export function useMostBought(limit = 3, days = 30, min = 3) {
  const [items, setItems] = useState<BoughtItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase.rpc('most_bought_items', {
        p_limit: limit,
        p_days: days,
        p_min: min,
      });
      if (cancelled) return;
      // A failure here is not worth surfacing: the module simply does not
      // appear, which is the same thing that happens when nothing qualifies.
      setItems(error ? [] : ((data ?? []) as BoughtItem[]));
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [limit, days, min]);

  return { items, loading };
}
