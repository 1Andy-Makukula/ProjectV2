// The weekly price run.
//
// Every KithLy bundle line, what it cost in town when it was last priced, what
// it is selling for, and how stale that is. One screen, one publish.
//
// WHY THIS IS THE LOAD-BEARING PIECE
// ----------------------------------
// The price lock is a promise made every week, forever. If keeping it means a
// spreadsheet and hand-written SQL every Sunday, it will be kept for about six
// weeks and then quietly stop being true -- and a stale locked price is not a
// cosmetic problem, it is a live financial commitment nobody remembers making.
// The catalogue is the shop window; this is the thing that keeps it honest.
//
// SCOPED TO KITHLY, DELIBERATELY
// ------------------------------
// Shops price their own goods and are not asked to do anything weekly. Only
// lines sourced by KithLy appear here -- which is what makes the run small
// enough to actually do. That narrowing was Andy's, and it is most of why this
// is maintainable.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';

export interface PriceBookLine {
  id: string;
  experienceId: string;
  experienceName: string;
  validUntil: string | null;
  itemId: string;
  itemName: string;
  quantity: number;
  /** All in ngwee. */
  livePrice: number;
  lockedPrice: number | null;
  sourcedCost: number | null;
  pricedAt: string | null;
}

interface RawLine {
  id: string;
  experience_id: string;
  item_id: string;
  quantity: number;
  locked_price_zmw: number | null;
  sourced_cost_zmw: number | null;
  priced_at: string | null;
  experience: { name: string; price_valid_until: string | null } | { name: string; price_valid_until: string | null }[] | null;
  item: { name: string; price_zmw: number; shop_id: string | null } | { name: string; price_zmw: number; shop_id: string | null }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** A line nobody has priced, or priced before its bundle's window closed. */
export function isStale(line: PriceBookLine): boolean {
  if (line.lockedPrice === null) return true;
  if (!line.validUntil) return false;
  return new Date(line.validUntil).getTime() < Date.now();
}

export function usePriceBook() {
  const [lines, setLines] = useState<PriceBookLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  // null until the accessor answers. Deliberately NOT a default: this value
  // multiplies into items.price_zmw on publish, and checkout charges from that
  // column -- so a fallback is not a stale display, it is a real mispriced sale.
  // It used to initialise to 500, and because the read below discarded its
  // error, every publish since 2026-09-21 silently applied 5%.
  const [markupBps, setMarkupBps] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Through an admin-gated accessor, not a column read: experience_markup_bps
      // is a commercial term and is not granted to `authenticated`. See
      // migration 20260924000000.
      const { data: markup, error: markupError } = await supabase.rpc(
        'admin_experience_markup_bps',
      );
      if (markupError) throw markupError;
      setMarkupBps(markup);

      // The house shop is found by name, the same way create_quotation finds
      // it. One identity, one lookup, no id hard-coded in two places.
      const { data: house } = await supabase
        .from('shops').select('id').eq('name', 'KithLy').maybeSingle();

      const { data, error } = await supabase
        .from('experience_items')
        .select(`
          id, experience_id, item_id, quantity,
          locked_price_zmw, sourced_cost_zmw, priced_at,
          experience:experience_id (name, price_valid_until),
          item:item_id (name, price_zmw, shop_id)
        `)
        .order('experience_id')
        .limit(500);
      if (error) throw error;

      const rows = ((data ?? []) as unknown as RawLine[])
        .map((r): PriceBookLine | null => {
          const exp = one(r.experience);
          const item = one(r.item);
          if (!exp || !item) return null;
          // Only what KithLy sources. A shop's own line prices itself.
          if (house?.id && item.shop_id !== house.id) return null;
          return {
            id: r.id,
            experienceId: r.experience_id,
            experienceName: exp.name,
            validUntil: exp.price_valid_until,
            itemId: r.item_id,
            itemName: item.name,
            quantity: r.quantity,
            livePrice: item.price_zmw,
            lockedPrice: r.locked_price_zmw,
            sourcedCost: r.sourced_cost_zmw,
            pricedAt: r.priced_at,
          };
        })
        .filter((r): r is PriceBookLine => r !== null);

      setLines(rows);
    } catch (err) {
      console.error('[usePriceBook] load:', err);
      toast.error(parseAuthError(err));
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Publish a week.
   *
   * Takes the costs entered against each line, applies the markup, and stamps
   * every one with the same `priced_at` and the same `price_valid_until` on
   * its bundle. **One timestamp for the whole run**, because a week that was
   * published across forty separate moments has forty different expiry dates
   * and the promise stops being checkable.
   *
   * Lines the operator did not touch are left exactly as they were rather than
   * being re-stamped with today's date -- re-stamping would silently extend a
   * price nobody actually re-checked, which is the one thing a price run must
   * never do.
   */
  const publish = useCallback(
    async (costs: Record<string, number>, validUntil: string) => {
      const touched = Object.entries(costs).filter(([, v]) => Number.isFinite(v) && v >= 0);
      if (touched.length === 0) {
        toast.error('Nothing to publish — no costs were entered.');
        return false;
      }

      // Without the markup there is no sell price to write, and guessing one
      // would put a real wrong number through the till.
      if (markupBps === null) {
        toast.error('The platform markup could not be read, so nothing can be published. Reload and try again.');
        return false;
      }

      setPublishing(true);
      const pricedAt = new Date().toISOString();
      try {
        for (const [lineId, cost] of touched) {
          const sell = Math.round(cost * (1 + markupBps / 10_000));
          const line = lines.find((l) => l.id === lineId);

          const { error } = await supabase
            .from('experience_items')
            .update({
              sourced_cost_zmw: Math.round(cost),
              locked_price_zmw: sell,
              priced_at: pricedAt,
            })
            .eq('id', lineId);
          if (error) throw error;

          // AND the item itself, which is what actually gets charged.
          //
          // checkout_init_atomic prices server-side from items.price_zmw via
          // unit_price_for and ignores anything the client sends -- correctly,
          // because a client-supplied price is a client-supplied discount. So
          // writing only locked_price_zmw would put the promised figure on the
          // shelf and a different one through the till, which is precisely the
          // kind of silent mismatch this product cannot afford.
          //
          // These are KithLy's own items in the house shop, so setting their
          // price IS the lock: we choose it weekly and do not move it midweek.
          // locked_price_zmw stays as the audit record of what was published
          // and when, and experience_price_health compares the two so drift
          // is visible rather than assumed away.
          if (line) {
            const { error: itemError } = await supabase
              .from('items')
              .update({ price_zmw: sell })
              .eq('id', line.itemId);
            if (itemError) throw itemError;
          }
        }

        // Only the bundles that actually had a line repriced get their window
        // moved. A bundle nobody looked at keeps its old expiry and keeps
        // showing as stale, which is the correct and useful outcome.
        const bundles = [...new Set(
          touched
            .map(([id]) => lines.find((l) => l.id === id)?.experienceId)
            .filter((v): v is string => Boolean(v)),
        )];
        for (const experienceId of bundles) {
          const { error } = await supabase
            .from('experiences')
            .update({ price_valid_until: validUntil })
            .eq('id', experienceId);
          if (error) throw error;
        }

        toast.success(`Priced ${touched.length} line${touched.length === 1 ? '' : 's'}, held until ${validUntil}.`);
        await load();
        return true;
      } catch (err) {
        toast.error(parseAuthError(err));
        return false;
      } finally {
        setPublishing(false);
      }
    },
    [markupBps, lines, load],
  );

  const staleCount = useMemo(() => lines.filter(isStale).length, [lines]);

  return { lines, loading, publishing, markupBps, staleCount, publish, reload: load };
}
