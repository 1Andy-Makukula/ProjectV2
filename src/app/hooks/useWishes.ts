// Wishes: marking a post as wanted, and seeing what people close to you want.
//
// This is the only user-authored content in the whole posts feature, which is
// why the moderation surface for merchant-only posting stays as small as it
// does — one note, visible to a handful of people.
//
// Reading other people's wishes goes through `wishes_from_my_contacts`, not a
// table scan with a policy on it. Evaluating the visibility rule per row of a
// browse query would put a correlated subquery on the hottest path in the app;
// asking once, for a short list, keeps it off.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import type { ContactWish, MyWish, WishVisibility } from '../types/posts';

export function useWishes() {
  const { profile } = useAuth();
  const [mine, setMine] = useState<Record<string, MyWish>>({});
  const [fromContacts, setFromContacts] = useState<ContactWish[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile) {
      setMine({});
      setFromContacts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [mineRes, theirsRes] = await Promise.all([
        supabase
          .from('post_wishes')
          .select('id, post_id, note, visibility, post_wish_audience(phone)')
          .eq('user_id', profile.id),
        supabase.rpc('wishes_from_my_contacts', { p_limit: 10 }),
      ]);

      const byPost: Record<string, MyWish> = {};
      for (const row of (mineRes.data ?? []) as any[]) {
        byPost[row.post_id] = {
          id: row.id,
          post_id: row.post_id,
          note: row.note ?? null,
          visibility: (row.visibility ?? 'all') as WishVisibility,
          audience: (row.post_wish_audience ?? []).map((entry: any) => entry.phone),
        };
      }
      setMine(byPost);
      setFromContacts((theirsRes.data ?? []) as ContactWish[]);
    } catch (err) {
      console.error('[useWishes] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Make or change a wish.
   *
   * The audience is replaced rather than merged: it is a list the person just
   * chose from a picker, so what they left out is a removal, not an omission.
   */
  const saveWish = useCallback(
    async (
      postId: string,
      note: string,
      visibility: WishVisibility,
      audience: string[],
    ): Promise<boolean> => {
      if (!profile) {
        toast.error('Sign in first');
        return false;
      }

      try {
        const { data: saved, error } = await supabase
          .from('post_wishes')
          .upsert(
            {
              post_id: postId,
              user_id: profile.id,
              note: note.trim() || null,
              visibility,
            },
            { onConflict: 'post_id,user_id' },
          )
          .select('id')
          .single();

        if (error) throw error;

        await supabase.from('post_wish_audience').delete().eq('wish_id', saved.id);

        // Only 'except' and 'only' read the list; storing one for 'all' would
        // be a rule nothing applies, waiting to surprise somebody later.
        if (visibility !== 'all' && audience.length > 0) {
          const { error: audienceError } = await supabase
            .from('post_wish_audience')
            .insert(audience.map((phone) => ({ wish_id: saved.id, phone })));
          if (audienceError) throw audienceError;
        }

        toast.success('Wish saved', {
          description:
            visibility === 'only'
              ? 'Only the people you picked can see it.'
              : 'People who have you saved can see it.',
        });
        await load();
        return true;
      } catch (err: any) {
        console.error('[useWishes] save error:', err);
        toast.error('Could not save that wish', { description: err?.message });
        return false;
      }
    },
    [profile, load],
  );

  const removeWish = useCallback(
    async (postId: string) => {
      const wish = mine[postId];
      if (!wish) return;
      const { error } = await supabase.from('post_wishes').delete().eq('id', wish.id);
      if (error) {
        toast.error('Could not remove that', { description: error.message });
        return;
      }
      toast.success('Wish removed');
      await load();
    },
    [mine, load],
  );

  return { mine, fromContacts, loading, saveWish, removeWish, reload: load };
}
