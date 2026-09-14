// PulseStrip — one true thing at a time.
//
// A quiet line that says what the platform has actually been doing, one
// statement at a time, paced so a visitor witnesses one rather than scrolling
// past a wall of them.
//
// Renders NOTHING when there is nothing to say. That is the whole discipline of
// this feature: the server only counts rows that exist, the pacing buffer only
// delays, and this refuses to fill a gap. An empty week looks like an empty
// week, and the honest way to look busier is to be busier.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import {
  nextDelayMs,
  pickNext,
  statementKey,
  statementText,
  type PulseStatement,
} from '../../reco/pulse';

/** How many statements to remember not repeating. */
const RECENT_MEMORY = 4;

export function PulseStrip({ className = '' }: { className?: string }) {
  const [pool, setPool] = useState<PulseStatement[]>([]);
  const [current, setCurrent] = useState<PulseStatement | null>(null);
  const [visible, setVisible] = useState(false);

  const fetchedAt = useRef<number>(Date.now());
  const recent = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.rpc('pulse_statements', { p_limit: 12 });
      if (cancelled) return;
      if (error) {
        // Silent. This is ambience; a visitor should never be told that the
        // decoration failed to load.
        console.error('[PulseStrip] failed:', error);
        return;
      }
      fetchedAt.current = Date.now();
      setPool((data as PulseStatement[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const advance = useCallback(() => {
    // Everything in one fetch shares an age, which is right: the counts are
    // windowed on the server, and pretending to know when each happened would
    // be inventing precision the query never had.
    const age = () => Date.now() - fetchedAt.current;
    const next = pickNext(pool, new Set(recent.current), age);

    if (!next) {
      setVisible(false);
      setCurrent(null);
      return;
    }

    setVisible(false);
    // Let the fade out finish before the text swaps, so a reader never sees a
    // sentence change under them mid-word.
    window.setTimeout(() => {
      setCurrent(next);
      setVisible(true);
    }, 400);

    recent.current = [statementKey(next), ...recent.current].slice(0, RECENT_MEMORY);
  }, [pool]);

  useEffect(() => {
    if (pool.length === 0) return;

    advance();
    const schedule = () => {
      timer.current = setTimeout(() => {
        advance();
        schedule();
      }, nextDelayMs(pool.length));
    };
    schedule();

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pool, advance]);

  // Nothing happened. Render nothing.
  if (!current) return null;

  return (
    <div
      className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`}
      // Announced once, politely. A live region that interrupts a screen reader
      // every few seconds to report ambience would be hostile.
      aria-live="polite"
      aria-atomic="true"
    >
      <Activity
        className="size-3.5 shrink-0 text-primary"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span
        className={`truncate transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        {statementText(current)}
      </span>
    </div>
  );
}

export default PulseStrip;
