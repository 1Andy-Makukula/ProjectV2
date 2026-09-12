// A post in the feed.
//
// A shop advertising inside KithLy: photographs, a caption, and — once P3 wires
// the Buy sheet — a way to buy what it is about, for yourself or for somebody
// else. The card itself is presentational: it takes a PostSummary and a set of
// handlers, and renders nothing it was not given a handler for. That is what
// lets P3 and P4 light up Buy and Secret Santa without this file changing
// shape.
//
// There is no price anywhere on it, deliberately. A post outlives the price it
// was written against; the sheet resolves money at the moment somebody taps
// Buy, through the same basket path the cart uses.

import {
  BadgeCheck,
  Bookmark,
  Gift,
  Heart,
  ImageOff,
  MapPin,
  Send,
  ShoppingCart,
  Store,
} from 'lucide-react';
import type { PostImage, PostSummary } from '../../types/posts';
import { relativeTime } from '../../../utils/relativeTime';

interface PostCardProps {
  post: PostSummary;
  onOpenShop: (shopId: string) => void;
  onLike?: () => void;
  onSave?: () => void;
  onShare?: () => void;
  /** Wired in P3. Absent until then, and absent for a post selling nothing. */
  onBuy?: () => void;
  /** Wired in P4. */
  onWish?: () => void;
  /**
   * What Buy is called here. The shop decides, not the shopper's mode: this is
   * the shop's own surface, and a restaurant takes orders whoever is looking.
   */
  buyLabel?: string;
}

/**
 * The collage.
 *
 * One photograph fills the frame; several become a hero with the rest beside
 * it, which is the shape the reference designs use and the shape people already
 * read as "a post". Anything past the fifth is counted rather than shown —
 * a tile too small to make out is worse than a number saying how many more
 * there are.
 */
function Collage({ images, caption }: { images: PostImage[]; caption: string | null }) {
  const alt = (image: PostImage) => image.alt_text ?? caption ?? '';

  if (images.length === 0) {
    return (
      <div className="grid aspect-[4/3] w-full place-items-center rounded-[var(--radius-md)] bg-muted">
        <ImageOff className="size-8 text-muted-foreground/30" strokeWidth={1.25} />
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <img
        src={images[0].image_url}
        alt={alt(images[0])}
        loading="lazy"
        className="aspect-[4/3] w-full rounded-[var(--radius-md)] object-cover"
      />
    );
  }

  if (images.length === 2) {
    return (
      <div className="grid aspect-[2/1] w-full grid-cols-2 gap-1.5 overflow-hidden rounded-[var(--radius-md)]">
        {images.map((image) => (
          <img
            key={image.id}
            src={image.image_url}
            alt={alt(image)}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ))}
      </div>
    );
  }

  // Three tiles fit: the hero, and two stacked beside it. The count of what is
  // left over has to be measured against those two, not against some larger
  // slice — it was `rest.slice(0, 4)`, so with five images `hidden` came out as
  // zero, no badge rendered at all, and two photographs simply vanished.
  const [hero, ...rest] = images;
  const shown = rest.slice(0, 2);
  // The second tile carries the overlay, so its own image is obscured too and
  // counts among the ones you are being told about.
  const extra = images.length - 2;

  return (
    <div className="grid aspect-[3/2] w-full grid-cols-3 gap-1.5 overflow-hidden rounded-[var(--radius-md)]">
      <img
        src={hero.image_url}
        alt={alt(hero)}
        loading="lazy"
        className="col-span-2 h-full w-full object-cover"
      />
      <div className="grid grid-rows-2 gap-1.5">
        {shown.map((image, index) => {
          const isLast = index === shown.length - 1 && rest.length > shown.length;
          return (
            <div key={image.id} className="relative overflow-hidden">
              <img
                src={image.image_url}
                alt={alt(image)}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              {isLast && (
                <div className="absolute inset-0 grid place-items-center bg-foreground/55 text-sm font-medium text-background">
                  +{extra}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One action under a post. Count omitted when there is nothing to say yet. */
function Action({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: typeof Heart;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[var(--radius-md)] py-1.5
                  text-[0.6875rem] transition-colors hover:bg-accent
                  ${active ? 'text-primary' : 'text-muted-foreground'}`}
    >
      <Icon className="size-[1.15rem]" strokeWidth={1.75} fill={active ? 'currentColor' : 'none'} />
      <span className="truncate font-medium">
        {label}
        {count !== undefined && count > 0 ? ` ${count}` : ''}
      </span>
    </button>
  );
}

export function PostCard({
  post,
  onOpenShop,
  onLike,
  onSave,
  onShare,
  onBuy,
  onWish,
  buyLabel = 'Buy',
}: PostCardProps) {
  const { author } = post;

  return (
    <article className="kl-tile overflow-hidden p-4">
      <header className="flex items-start gap-2.5">
        <button
          onClick={() => onOpenShop(author.id)}
          className="size-10 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-muted"
          aria-label={author.name}
        >
          {author.logo_url ? (
            <img src={author.logo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <Store className="size-4 text-muted-foreground/40" strokeWidth={1.5} />
            </div>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <button
            onClick={() => onOpenShop(author.id)}
            className="flex max-w-full items-center gap-1 text-left"
          >
            <span className="truncate text-sm font-medium">{author.name}</span>
            {author.is_verified && (
              <BadgeCheck
                className="size-3.5 shrink-0 text-primary"
                strokeWidth={2}
                aria-label="Verified shop"
              />
            )}
          </button>
          <p className="truncate text-[0.6875rem] font-light text-muted-foreground">
            {post.published_at ? relativeTime(post.published_at) : 'Draft'}
            {author.location ? ` · ${author.location}` : ''}
          </p>
        </div>

        {post.location_label && (
          <span className="kl-rim inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-pill)] bg-card px-2 py-1 text-[0.6875rem] text-muted-foreground">
            <MapPin className="size-3" strokeWidth={1.75} />
            <span className="max-w-[7rem] truncate">{post.location_label}</span>
          </span>
        )}
      </header>

      <div className="mt-3">
        <Collage images={post.images} caption={post.caption} />
      </div>

      {post.caption && (
        <p className="mt-3 whitespace-pre-line text-[0.8125rem] leading-relaxed">{post.caption}</p>
      )}

      <div className="mt-3 flex items-stretch gap-0.5 border-t border-border pt-2">
        {onLike && (
          <Action
            icon={Heart}
            label="Like"
            count={post.like_count}
            active={post.liked_by_me}
            onClick={onLike}
          />
        )}
        {onSave && (
          <Action
            icon={Bookmark}
            label="Save"
            count={post.save_count}
            active={post.saved_by_me}
            onClick={onSave}
          />
        )}
        {onShare && <Action icon={Send} label="Share" onClick={onShare} />}
        {onBuy && <Action icon={ShoppingCart} label={buyLabel} onClick={onBuy} />}
        {onWish && <Action icon={Gift} label="Secret Santa" onClick={onWish} />}
      </div>
    </article>
  );
}
