// What a post costs, resolved at the moment somebody asks.
//
// A post stores no price — see the header of 20260912000000_posts.sql for why.
// This is the other half of that decision: when the Buy sheet opens, it reads
// the live item rows and asks the database for the total. Nothing about the
// price was decided when the post was written.
//
// It is not a second checkout. The sheet ends by putting the chosen items in
// the ordinary cart and handing over to the ordinary checkout, which is where
// stock is reserved and the authoritative total is computed inside
// checkout_init_atomic. This exists to show a shopper what they are about to
// commit to, not to decide it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useCart, toProduct } from './useCart';
import { useSendFlowStore } from '../../utils/sendFlowStore';
import type { PostSummary } from '../types/posts';

/** One buyable line in the sheet. */
export interface BasketLine {
  item_id: string;
  name: string;
  image_url: string | null;
  /** Unit price as listed. Bulk breaks are applied to the total, not here. */
  price_zmw: number;
  quantity: number;
  /** Item gone, delisted, or out of stock — shown, but not buyable. */
  unavailable: boolean;
  reason: string | null;
}

export function usePostBasket(post: PostSummary | null, open: boolean) {
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [pricing, setPricing] = useState(false);

  const itemIds = useMemo(
    () =>
      (post?.attachments ?? [])
        .map((attachment) => attachment.item_id)
        .filter((id): id is string => id !== null),
    [post],
  );

  // Live read, every time the sheet opens. Stale prices are the whole thing
  // this design exists to avoid, so nothing here is cached between openings.
  useEffect(() => {
    if (!open || !post) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data, error } = itemIds.length
          ? await supabase
              .from('items')
              .select('id, name, image_url, price_zmw, is_available, stock_quantity, is_quote_only')
              .in('id', itemIds)
          : { data: [], error: null };

        if (error) throw error;
        if (cancelled) return;

        const byId = new Map((data ?? []).map((item: any) => [item.id, item]));

        setLines(
          (post?.attachments ?? []).map((attachment) => {
            const live = attachment.item_id ? byId.get(attachment.item_id) : undefined;

            // The item is gone. post_items keeps the snapshot precisely so the
            // line can still say what it was rather than vanishing.
            if (!live) {
              return {
                item_id: attachment.item_id ?? attachment.id,
                name: attachment.snapshot_name,
                image_url: attachment.snapshot_image_url,
                price_zmw: 0,
                quantity: 0,
                unavailable: true,
                reason: 'No longer available',
              };
            }

            const outOfStock = live.stock_quantity !== null && live.stock_quantity <= 0;
            const unavailable = live.is_available === false || outOfStock || live.is_quote_only;

            return {
              item_id: live.id,
              name: live.name,
              image_url: live.image_url ?? attachment.snapshot_image_url,
              price_zmw: live.price_zmw,
              quantity: unavailable ? 0 : 1,
              unavailable,
              reason: outOfStock
                ? 'Out of stock'
                : live.is_quote_only
                  ? 'Priced on request'
                  : live.is_available === false
                    ? 'No longer available'
                    : null,
            };
          }),
        );
      } catch (err) {
        console.error('[usePostBasket] load error:', err);
        if (!cancelled) setLines([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, post, itemIds]);

  const chosen = useMemo(
    () => lines.filter((line) => !line.unavailable && line.quantity > 0),
    [lines],
  );

  /** The naive sum, for comparison against what the database says. */
  const listTotal = useMemo(
    () => chosen.reduce((sum, line) => sum + line.price_zmw * line.quantity, 0),
    [chosen],
  );

  // The real total comes from price_basket_zmw, which applies wholesale
  // quantity breaks. Summing the listed prices here would quietly overcharge on
  // exactly the baskets where a break applies, and then disagree with checkout.
  useEffect(() => {
    if (!open || !post || chosen.length === 0) {
      setTotal(null);
      return;
    }
    let cancelled = false;

    async function price() {
      setPricing(true);
      try {
        // One entry per unit: the resolver counts elements rather than reading
        // a quantity field.
        const itemIdList = chosen.flatMap((line) =>
          Array.from({ length: line.quantity }, () => line.item_id),
        );
        const { data, error } = await supabase.rpc('price_basket_zmw', {
          p_vendors: [{ shop_id: post!.author.id, item_ids: itemIdList }],
        });
        if (!cancelled) setTotal(error ? null : (data as number));
      } finally {
        if (!cancelled) setPricing(false);
      }
    }

    price();
    return () => {
      cancelled = true;
    };
  }, [open, post, chosen]);

  const setQuantity = useCallback((itemId: string, quantity: number) => {
    setLines((current) =>
      current.map((line) =>
        line.item_id === itemId ? { ...line, quantity: Math.max(0, quantity) } : line,
      ),
    );
  }, []);

  /**
   * Hand the basket to the ordinary checkout.
   *
   * `forSelf` only decides who the recipient is. Buying for yourself in an
   * escrow model still produces a claim code — you are simply the person who
   * collects it — so the same order shape covers both and there is no second
   * path to keep in step.
   */
  const handOver = useCallback(
    (forSelf: boolean, me: { name: string; phone: string } | null) => {
      const { addToCart } = useCart.getState();
      chosen.forEach((line) => {
        addToCart(
          toProduct({
            id: line.item_id,
            name: line.name,
            price_zmw: line.price_zmw,
            image_url: line.image_url,
            shop_id: post?.author.id ?? '',
          }),
          line.quantity,
        );
      });

      if (forSelf && me) {
        useSendFlowStore.getState().setRecipient({ name: me.name, phone: me.phone, message: '' });
      }
    },
    [chosen, post],
  );

  return { lines, chosen, loading, total, listTotal, pricing, setQuantity, handOver };
}
