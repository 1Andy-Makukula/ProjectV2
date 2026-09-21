// One post, on its own page.
//
// Where a shared link lands, and where the rail's "X made a wish" goes. It
// renders the same PostCard the feed does rather than a second presentation —
// a post that looks different depending on how you arrived at it is two posts.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { Header } from '../components/layout/Header';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { PostCard } from '../components/storefront/PostCard';
import { PostBuySheet } from '../components/storefront/PostBuySheet';
import { WishDialog } from '../components/storefront/WishDialog';
import { usePosts } from '../hooks/usePosts';
import { useWishes } from '../hooks/useWishes';
import { isPurchasable, postActionLabel, type PostSummary } from '../types/posts';
import { mapPostRow, POST_SELECT } from '../hooks/useStorefrontData';

export function PostDetail() {
  const { postId } = useParams();
  const navigate = useNavigate();

  const [source, setSource] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const { posts, toggleLike, toggleSave, sharePost } = usePosts(source);
  const { mine: myWishes, saveWish, removeWish } = useWishes();
  const [buying, setBuying] = useState(false);
  const [wishing, setWishing] = useState(false);

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .eq('id', postId)
      .maybeSingle();

    const mapped = !error && data ? mapPostRow(data) : null;
    setSource(mapped ? [mapped] : []);
    setMissing(!mapped);
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    load();
  }, [load]);

  const post = posts[0] ?? null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-8">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/browse')}>
          <ArrowLeft className="mr-1.5 size-4" /> Back
        </Button>

        {loading ? (
          <Skeleton className="h-96 w-full rounded-[var(--radius-lg)]" />
        ) : missing || !post ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border py-16 text-center text-muted-foreground">
            <p className="text-sm">This post is no longer available.</p>
          </div>
        ) : (
          <>
            <PostCard
              post={post}
              onOpenShop={(shopId) => navigate(`/shop/${shopId}`)}
              onLike={() => toggleLike(post.id)}
              onSave={() => toggleSave(post.id)}
              onShare={() => sharePost(post)}
              onBuy={isPurchasable(post) ? () => setBuying(true) : undefined}
              buyLabel={postActionLabel(post.author)}
              onWish={() => setWishing(true)}
            />

            <PostBuySheet
              post={post}
              open={buying}
              onOpenChange={setBuying}
              actionLabel={postActionLabel(post.author)}
            />

            <WishDialog
              open={wishing}
              onOpenChange={setWishing}
              postId={post.id}
              existing={myWishes[post.id] ?? null}
              onSave={saveWish}
              onRemove={removeWish}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default PostDetail;
