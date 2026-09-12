// Where a shop writes its posts.
//
// A post is an advert that can be bought from: photographs, a caption, and the
// items it is about. The items are the part that matters — a post with nothing
// attached still likes, saves and shares, but there is nothing for a shopper to
// buy, so the composer says so rather than letting it go out silently empty.
//
// No price is entered anywhere here, and that is deliberate. Prices live on the
// items; a post that carried its own would be a second pricing path around the
// tier rules and the FX quote lock.

import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Heart, Bookmark, ImagePlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Header } from '../../components/layout/Header';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Skeleton } from '../../components/ui/skeleton';
import { useMerchantShop } from '../../hooks/useMerchantShop';
import {
  useMerchantPosts,
  type MerchantPost,
  type PostImageSlot,
} from '../../hooks/useMerchantPosts';
import { MAX_POST_IMAGES } from '../../types/posts';
import { relativeTime } from '../../../utils/relativeTime';

export function MerchantPosts() {
  const navigate = useNavigate();
  // Just the shop, not the whole dashboard: this page needs an id, and
  // useMerchantDashboard reaches one via six queries and a realtime channel.
  const { shop, loading: shopLoading } = useMerchantShop();
  const { posts, items, loading, saving, createPost, updatePost, setStatus, deletePost } =
    useMerchantPosts(shop?.id ?? null);

  const [composing, setComposing] = useState(false);
  /** Null while writing a new post; the post's id while changing an old one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [images, setImages] = useState<PostImageSlot[]>([]);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    // Only the object URLs this composer minted are ours to revoke; the stored
    // ones belong to images that still exist on the post.
    images.forEach((image) => image.file && URL.revokeObjectURL(image.url));
    setCaption('');
    setLocationLabel('');
    setImages([]);
    setItemIds([]);
    setEditingId(null);
    setComposing(false);
  }, [images]);

  /** Open an existing post in the composer, seeded with what it already says. */
  const startEditing = (post: MerchantPost) => {
    setEditingId(post.id);
    setCaption(post.caption ?? '');
    setLocationLabel(post.location_label ?? '');
    setImages(post.images.map((image) => ({ url: image.image_url })));
    setItemIds(
      post.attachments
        .map((attachment) => attachment.item_id)
        .filter((id): id is string => id !== null),
    );
    setComposing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const room = MAX_POST_IMAGES - images.length;
    setImages((current) => [
      ...current,
      ...Array.from(incoming)
        .slice(0, room)
        .map((file) => ({ url: URL.createObjectURL(file), file })),
    ]);
  };

  const submit = async (publish: boolean) => {
    const ok = editingId
      ? await updatePost(editingId, { caption, locationLabel, images, itemIds })
      : await createPost({
          caption,
          locationLabel,
          files: images.map((image) => image.file).filter((f): f is File => !!f),
          itemIds,
          publish,
        });
    if (ok) reset();
  };

  const toggleItem = (id: string) =>
    setItemIds((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id],
    );

  // A merchant account with no shop behind it would otherwise get a composer
  // that cannot save anything — every write here is scoped to a shop_id, and
  // RLS would refuse it. Say so instead.
  if (!shopLoading && !shop) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-8">
          <h1 className="text-xl font-semibold">No shop yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Posts belong to a shop. Once yours is set up you can advertise from here.
          </p>
          <Button className="mt-6" onClick={() => navigate('/merchant')}>
            Back to your dashboard
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Posts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {shop ? `What ${shop.name} is telling people about.` : 'What your shop is telling people about.'}
            </p>
          </div>
          {!composing && (
            <Button onClick={() => setComposing(true)} className="shrink-0">
              <Plus className="mr-1.5 size-4" /> New post
            </Button>
          )}
        </div>

        {composing && (
          <section className="kl-tile mb-8 space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{editingId ? 'Edit post' : 'New post'}</h2>
              <button
                onClick={reset}
                aria-label="Discard"
                className="grid size-7 place-items-center rounded-[var(--radius-pill)] text-muted-foreground hover:bg-accent"
              >
                <X className="size-4" />
              </button>
            </div>

            <div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {images.map((image, index) => (
                  <div key={image.url} className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] bg-muted">
                    <img src={image.url} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() =>
                        setImages((current) => {
                          const going = current[index];
                          if (going?.file) URL.revokeObjectURL(going.url);
                          return current.filter((_, i) => i !== index);
                        })
                      }
                      aria-label={`Remove picture ${index + 1}`}
                      className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-foreground/70 text-background"
                    >
                      <X className="size-3" />
                    </button>
                    {index === 0 && (
                      <span className="absolute bottom-1 left-1 rounded-[var(--radius-pill)] bg-foreground/70 px-1.5 py-0.5 text-[0.625rem] text-background">
                        Hero
                      </span>
                    )}
                  </div>
                ))}
                {images.length < MAX_POST_IMAGES && (
                  <button
                    onClick={() => fileInput.current?.click()}
                    className="grid aspect-square place-items-center rounded-[var(--radius-md)] border border-dashed border-border text-muted-foreground hover:bg-accent"
                  >
                    <ImagePlus className="size-5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
                Up to {MAX_POST_IMAGES}. The first one leads the post.
              </p>
            </div>

            <Textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Say what this is about…"
              maxLength={2000}
              rows={3}
            />

            <Input
              value={locationLabel}
              onChange={(event) => setLocationLabel(event.target.value)}
              placeholder="Where, if it matters — e.g. Levy Junction"
              maxLength={120}
            />

            <div>
              <p className="mb-2 text-xs font-medium">
                What it sells{' '}
                <span className="font-normal text-muted-foreground">
                  — attach items so people can buy from the post
                </span>
              </p>
              {items.length === 0 ? (
                <p className="text-[0.6875rem] text-muted-foreground">
                  No items yet.{' '}
                  <button onClick={() => navigate('/merchant/items/new')} className="underline">
                    Add one first
                  </button>
                  .
                </p>
              ) : (
                <div className="kl-scroll flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {items.map((item) => {
                    const on = itemIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        onClick={() => toggleItem(item.id)}
                        aria-pressed={on}
                        className={`rounded-[var(--radius-pill)] border px-2.5 py-1 text-[0.6875rem] transition-colors
                                    ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent'}`}
                      >
                        {item.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {itemIds.length === 0 && items.length > 0 && (
                <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
                  Nothing attached — this will post as an advert with no way to buy from it.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              {/* Publishing is a status change, and an existing post already has
                  one — offering "save draft" while editing a live post would
                  quietly unpublish it. Use Take down for that. */}
              {editingId ? (
                <Button onClick={() => submit(false)} disabled={saving || images.length === 0}>
                  {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                  Save changes
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
                    Save draft
                  </Button>
                  <Button onClick={() => submit(true)} disabled={saving || images.length === 0}>
                    {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                    Post it
                  </Button>
                </>
              )}
            </div>
          </section>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-[var(--radius-lg)]" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-border py-16 text-center text-muted-foreground">
            <p className="text-sm">Nothing posted yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {posts.map((post) => (
              <li key={post.id} className="kl-tile flex items-start gap-3 p-3">
                <div className="size-16 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-muted">
                  {post.images[0] && (
                    <img src={post.images[0].image_url} alt="" className="h-full w-full object-cover" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {post.caption || <span className="text-muted-foreground">No caption</span>}
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                    {post.status === 'published' && post.published_at
                      ? relativeTime(post.published_at)
                      : post.status}
                    {' · '}
                    {post.images.length} picture{post.images.length === 1 ? '' : 's'}
                    {' · '}
                    {post.attachments.length} item{post.attachments.length === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 flex items-center gap-3 text-[0.6875rem] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Heart className="size-3" /> {post.like_count}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Bookmark className="size-3" /> {post.save_count}
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 flex-col gap-1">
                  <Button size="sm" variant="outline" onClick={() => startEditing(post)}>
                    <Pencil className="mr-1 size-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setStatus(post.id, post.status === 'published' ? 'archived' : 'published')
                    }
                  >
                    {post.status === 'published' ? 'Take down' : 'Publish'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deletePost(post.id)}
                    aria-label="Delete post"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

export default MerchantPosts;
