// A shop's own posts, and writing them.
//
// The storefront's `usePosts` is about reading and engaging; this is the other
// side — what a merchant sees and creates. It loads every status, not just
// published ones, because a draft the author cannot see is a draft they will
// write twice.

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabaseClient';
import { uploadItemImage } from '../../utils/uploadImage';
import { MAX_POST_IMAGES, type PostStatus } from '../types/posts';

/** A post as the merchant dashboard lists it. */
export interface MerchantPost {
  id: string;
  caption: string | null;
  location_label: string | null;
  status: PostStatus;
  published_at: string | null;
  created_at: string;
  like_count: number;
  save_count: number;
  images: { id: string; image_url: string; sort_order: number }[];
  attachments: { id: string; item_id: string | null; snapshot_name: string }[];
}

/** An item the composer can attach. */
export interface AttachableItem {
  id: string;
  name: string;
  image_url: string | null;
}

/**
 * One picture slot while editing.
 *
 * Either a file that has not been uploaded yet, or one already stored on the
 * post. `url` is what to show in the composer — an object URL for a new file,
 * the stored URL for an existing one — so the preview grid does not have to
 * care which it is looking at.
 */
export interface PostImageSlot {
  url: string;
  file?: File;
}

export interface EditPostDraft {
  caption: string;
  locationLabel: string;
  images: PostImageSlot[];
  itemIds: string[];
}

export interface NewPostDraft {
  caption: string;
  locationLabel: string;
  /** Files in the order they should appear; the first becomes the hero. */
  files: File[];
  itemIds: string[];
  publish: boolean;
}

export function useMerchantPosts(shopId: string | null) {
  const [posts, setPosts] = useState<MerchantPost[]>([]);
  const [items, setItems] = useState<AttachableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Each load takes a token and only the newest may write state. `load` runs
  // again after every create, edit, publish and delete, so a flag scoped to the
  // effect would leave those unguarded.
  const request = useRef(0);

  const load = useCallback(async () => {
    const token = ++request.current;

    if (!shopId) {
      setPosts([]);
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [postsRes, itemsRes] = await Promise.all([
        supabase
          .from('posts')
          .select(
            'id, caption, location_label, status, published_at, created_at, like_count, save_count, ' +
              'post_images(id, image_url, sort_order), ' +
              'post_items(id, item_id, snapshot_name)',
          )
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false })
          .limit(50),

        // Only this shop's items can be attached — the database enforces that
        // too, so the picker is a convenience rather than the rule.
        supabase
          .from('items')
          .select('id, name, image_url')
          .eq('shop_id', shopId)
          .eq('is_available', true)
          .order('name', { ascending: true })
          .limit(200),
      ]);

      if (token !== request.current) return;
      if (postsRes.error) throw postsRes.error;

      setPosts(
        (postsRes.data ?? []).map((row: any) => ({
          id: row.id,
          caption: row.caption ?? null,
          location_label: row.location_label ?? null,
          status: (row.status ?? 'draft') as PostStatus,
          published_at: row.published_at ?? null,
          created_at: row.created_at,
          like_count: row.like_count ?? 0,
          save_count: row.save_count ?? 0,
          images: (row.post_images ?? []).sort(
            (a: any, b: any) => a.sort_order - b.sort_order,
          ),
          attachments: row.post_items ?? [],
        })),
      );
      setItems((itemsRes.data ?? []) as AttachableItem[]);
    } catch (err: any) {
      console.error('[useMerchantPosts] load error:', err);
      toast.error('Could not load your posts', { description: err?.message });
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Create a post.
   *
   * The row is written first and the images after, because every image needs a
   * post_id to hang from. If an upload fails partway the post survives with the
   * images that made it — a draft missing a photograph is recoverable by
   * editing, whereas unwinding a half-made post risks deleting one that is
   * fine.
   */
  const createPost = useCallback(
    async (draft: NewPostDraft): Promise<boolean> => {
      if (!shopId) return false;
      if (draft.files.length === 0) {
        toast.error('A post needs at least one picture');
        return false;
      }
      if (draft.files.length > MAX_POST_IMAGES) {
        toast.error(`Up to ${MAX_POST_IMAGES} pictures`);
        return false;
      }

      setSaving(true);
      try {
        const { data: created, error: postError } = await supabase
          .from('posts')
          .insert({
            shop_id: shopId,
            caption: draft.caption.trim() || null,
            location_label: draft.locationLabel.trim() || null,
            // published_at is stamped by the database on this transition, so the
            // feed's ordering is never a client's clock.
            status: draft.publish ? 'published' : 'draft',
          })
          .select('id')
          .single();

        if (postError) throw postError;
        const postId = created.id;

        const uploaded = await Promise.all(
          draft.files.map(async (file, index) => {
            const { publicUrl } = await uploadItemImage(file, shopId);
            return { post_id: postId, image_url: publicUrl, sort_order: index };
          }),
        );

        const { error: imageError } = await supabase.from('post_images').insert(uploaded);
        if (imageError) throw imageError;

        if (draft.itemIds.length > 0) {
          const attachments = draft.itemIds.map((itemId, index) => {
            const item = items.find((candidate) => candidate.id === itemId);
            return {
              post_id: postId,
              item_id: itemId,
              // Snapshot so the line stays renderable if the item is later
              // delisted — same reason list_items carries one.
              snapshot_name: item?.name ?? 'Item',
              snapshot_image_url: item?.image_url ?? null,
              sort_order: index,
              is_primary: index === 0,
            };
          });
          const { error: attachError } = await supabase.from('post_items').insert(attachments);
          if (attachError) throw attachError;
        }

        toast.success(draft.publish ? 'Posted' : 'Saved as a draft');
        await load();
        return true;
      } catch (err: any) {
        console.error('[useMerchantPosts] create error:', err);
        toast.error('Could not save that post', { description: err?.message });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [shopId, items, load],
  );

  /**
   * Edit an existing post.
   *
   * Images are rewritten wholesale rather than diffed: `post_images` has a
   * unique slot per post, so shuffling sort_order in place collides with rows
   * that have not moved yet and needs a two-phase dance to avoid. Deleting the
   * rows and re-inserting the final order is one round trip and cannot collide.
   * New files are uploaded FIRST, so the delete only happens once there is a
   * complete set to put back.
   *
   * The storage objects behind removed images are deliberately left alone. A
   * post's picture may be an item's photograph — the seeded posts are exactly
   * that — and deleting the file to tidy up a post would blank the item.
   */
  const updatePost = useCallback(
    async (postId: string, draft: EditPostDraft): Promise<boolean> => {
      if (!shopId) return false;
      if (draft.images.length === 0) {
        toast.error('A post needs at least one picture');
        return false;
      }
      if (draft.images.length > MAX_POST_IMAGES) {
        toast.error(`Up to ${MAX_POST_IMAGES} pictures`);
        return false;
      }

      setSaving(true);
      try {
        const { error: postError } = await supabase
          .from('posts')
          .update({
            caption: draft.caption.trim() || null,
            location_label: draft.locationLabel.trim() || null,
          })
          .eq('id', postId);
        if (postError) throw postError;

        // Resolve every slot to a URL before anything is removed.
        const urls = await Promise.all(
          draft.images.map(async (image) =>
            image.file ? (await uploadItemImage(image.file, shopId)).publicUrl : image.url,
          ),
        );

        await supabase.from('post_images').delete().eq('post_id', postId);
        const { error: imageError } = await supabase.from('post_images').insert(
          urls.map((url, index) => ({ post_id: postId, image_url: url, sort_order: index })),
        );
        if (imageError) throw imageError;

        await supabase.from('post_items').delete().eq('post_id', postId);
        if (draft.itemIds.length > 0) {
          const { error: attachError } = await supabase.from('post_items').insert(
            draft.itemIds.map((itemId, index) => {
              const item = items.find((candidate) => candidate.id === itemId);
              return {
                post_id: postId,
                item_id: itemId,
                snapshot_name: item?.name ?? 'Item',
                snapshot_image_url: item?.image_url ?? null,
                sort_order: index,
                is_primary: index === 0,
              };
            }),
          );
          if (attachError) throw attachError;
        }

        toast.success('Post updated');
        await load();
        return true;
      } catch (err: any) {
        console.error('[useMerchantPosts] update error:', err);
        toast.error('Could not save those changes', { description: err?.message });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [shopId, items, load],
  );

  const setStatus = useCallback(
    async (postId: string, status: PostStatus) => {
      const { error } = await supabase.from('posts').update({ status }).eq('id', postId);
      if (error) {
        toast.error('Could not change that', { description: error.message });
        return;
      }
      toast.success(status === 'published' ? 'Published' : 'Taken down');
      await load();
    },
    [load],
  );

  const deletePost = useCallback(
    async (postId: string) => {
      const { error } = await supabase.from('posts').delete().eq('id', postId);
      if (error) {
        toast.error('Could not delete that', { description: error.message });
        return;
      }
      toast.success('Post deleted');
      await load();
    },
    [load],
  );

  return { posts, items, loading, saving, createPost, updatePost, setStatus, deletePost, reload: load };
}
