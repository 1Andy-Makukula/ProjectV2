// Liking, saving and sharing a post.
//
// The storefront fetches posts once; this holds that list locally so a tap can
// take effect immediately rather than waiting on a round trip. Counters on the
// row are maintained by database triggers, so the number shown here after a tap
// is this hook's arithmetic — it converges on the real one at the next load.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { shareLink } from '../../utils/native';
import type { PostSummary } from '../types/posts';

/**
 * Apply a like or save to one post in a list, without mutating the original.
 *
 * Kept as one function because the two differ only in which pair of fields they
 * touch, and a second near-identical copy is how they drift apart.
 */
function applyToggle(
  posts: PostSummary[],
  postId: string,
  field: 'liked_by_me' | 'saved_by_me',
  countField: 'like_count' | 'save_count',
  next: boolean,
): PostSummary[] {
  return posts.map((post) =>
    post.id === postId
      ? {
          ...post,
          [field]: next,
          // Never below zero: the count came from the server and the tap may be
          // racing another device.
          [countField]: Math.max(0, post[countField] + (next ? 1 : -1)),
        }
      : post,
  );
}

export function usePosts(source: PostSummary[]) {
  const { profile } = useAuth();
  const [posts, setPosts] = useState<PostSummary[]>(source);

  // The storefront refetches on its own schedule; adopt whatever it last got.
  useEffect(() => {
    setPosts(source);
  }, [source]);

  const toggle = useCallback(
    async (
      postId: string,
      table: 'post_likes' | 'post_saves',
      field: 'liked_by_me' | 'saved_by_me',
      countField: 'like_count' | 'save_count',
    ) => {
      if (!profile) {
        toast.error('Sign in first', { description: 'You need an account to do that.' });
        return;
      }

      const current = posts.find((post) => post.id === postId);
      if (!current) return;

      const next = !current[field];
      const previous = posts;
      setPosts((list) => applyToggle(list, postId, field, countField, next));

      const { error } = next
        ? await supabase.from(table).insert({ post_id: postId, user_id: profile.id })
        : await supabase.from(table).delete().eq('post_id', postId).eq('user_id', profile.id);

      if (error) {
        // Put it back. A like that silently did not happen is worse than one
        // that visibly failed.
        setPosts(previous);
        toast.error('That did not save', { description: error.message });
      }
    },
    [posts, profile],
  );

  const toggleLike = useCallback(
    (postId: string) => toggle(postId, 'post_likes', 'liked_by_me', 'like_count'),
    [toggle],
  );

  const toggleSave = useCallback(
    (postId: string) => toggle(postId, 'post_saves', 'saved_by_me', 'save_count'),
    [toggle],
  );

  /**
   * Share a post.
   *
   * Goes through the one share path the app already has, so it uses the native
   * sheet on a phone and falls back to copying the link on a desktop browser.
   * The link unfurls properly because `supabase/functions/og` describes it —
   * see docs/og-previews.md.
   */
  const sharePost = useCallback(async (post: PostSummary) => {
    const url = `${window.location.origin}/post/${post.id}`;
    const outcome = await shareLink({
      title: post.author.name,
      text: post.caption ?? `${post.author.name} on KithLy`,
      url,
    });
    if (outcome === 'copied') toast.success('Link copied');
    if (outcome === 'failed') toast.error('Could not share that');
  }, []);

  return { posts, toggleLike, toggleSave, sharePost };
}
