import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { currentWeight, type PulseStatement } from '../reco/pulse';

/**
 * What the platform has actually been doing, as counts, ordered by how alive
 * each fact still is.
 *
 * This is the rail's Market Pulse panel. It is a second reader of
 * `pulse_statements` alongside PulseStrip, and deliberately not a second
 * source: the strip witnesses one statement at a time and paces them, while
 * the panel shows the top few at once. Same rows, same honesty, different
 * reading speed.
 *
 * NOTHING HERE CAN INVENT A NUMBER. The server counts rows that exist and
 * refuses any cohort below three, because a count plus a precise time
 * identifies a person in a town where the shopkeeper knows their customers.
 * This hook only sorts and truncates what it was handed. If the platform did
 * nothing, `statements` is empty and the panel renders nothing -- which is
 * correct, and the honest way to look busier is to be busier.
 *
 * Age is taken once per fetch and shared by every row, which is right: the
 * counts are windowed server-side, and pretending to know when each one
 * happened would be inventing precision the query never had.
 */
export function useMarketPulse(limit = 4) {
  const [statements, setStatements] = useState<PulseStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedAt = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.rpc('pulse_statements', { p_limit: 8 });
      if (cancelled) return;

      if (error) {
        // Silent, as PulseStrip is. This is ambience: a shopper is never told
        // that the decoration failed to load, the panel simply does not
        // appear.
        console.error('[useMarketPulse] failed:', error);
        setLoading(false);
        return;
      }

      fetchedAt.current = Date.now();
      setStatements((data as PulseStatement[]) ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const age = Date.now() - fetchedAt.current;
  const top = [...statements]
    .sort((a, b) => currentWeight(b, age) - currentWeight(a, age))
    .slice(0, limit);

  return { statements: top, loading };
}
