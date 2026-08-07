import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { useAuth } from '../../utils/auth/AuthContext';

/**
 * The viewer's own KithLy Rating for a shop, and whether they may leave one.
 *
 * Eligibility is asked of the database rather than inferred from anything the
 * client already has: `can_rate_shop` looks for a redeemed order belonging to
 * this buyer, and the same rule is enforced again by the write policy. The
 * check here only decides whether to show the control.
 */
export function useShopRating(shopId: string | undefined) {
  const { user } = useAuth();
  const [canRate, setCanRate] = useState(false);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!shopId || !user?.id) {
      setCanRate(false);
      setMyRating(null);
      return;
    }

    let cancelled = false;

    Promise.all([
      supabase.rpc('can_rate_shop', { p_shop_id: shopId }),
      supabase
        .from('shop_ratings')
        .select('rating')
        .eq('shop_id', shopId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]).then(([eligibility, existing]) => {
      if (cancelled) return;
      setCanRate(Boolean(eligibility.data));
      setMyRating((existing.data as { rating: number } | null)?.rating ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [shopId, user?.id]);

  const rate = useCallback(
    async (rating: number) => {
      if (!shopId || !user?.id) return false;

      try {
        setSaving(true);
        const { error } = await supabase.from('shop_ratings').upsert(
          {
            shop_id: shopId,
            user_id: user.id,
            rating,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'shop_id,user_id' },
        );

        if (error) throw error;

        setMyRating(rating);
        toast.success('Thanks — your rating helps other buyers');
        return true;
      } catch (error: any) {
        console.error('[useShopRating] rate failed:', error);
        toast.error(parseAuthError(error));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [shopId, user?.id],
  );

  return { canRate, myRating, saving, rate };
}
