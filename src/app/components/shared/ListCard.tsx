import { Bookmark, ListChecks, ShieldCheck, Star, Store } from 'lucide-react';
import { Badge } from '../ui/badge';
import { listAuthorLabel, listRating, type ListSummary } from '../../types/lists';

interface ListCardProps {
  list: ListSummary;
  onOpen: () => void;
  /** Shop count, when the caller has loaded the entries to work it out. */
  shopCount?: number;
}

/**
 * A list in a feed.
 *
 * A list has no single picture and no single price, so the tile is a collage of
 * the first few item images — reusing pictures the source items already carry,
 * which is why creating a list never asks anyone to upload anything.
 *
 * The count line leads with how many businesses the list draws from: that is
 * what separates a list from a shop's own collection, and it is the reason the
 * one-code checkout matters.
 */
export function ListCard({ list, onOpen, shopCount }: ListCardProps) {
  const rating = listRating(list);
  const author = listAuthorLabel(list);
  const images = list.preview_images;

  return (
    <button
      onClick={onOpen}
      className="kl-tile kl-lift group flex flex-col overflow-hidden text-left"
    >
      {/* Collage — one large image with a stack beside it, degrading to
          whatever the list actually has. */}
      <div className="grid aspect-[4/3] w-full grid-cols-3 gap-0.5 bg-ink-50">
        {images.length === 0 ? (
          <div className="col-span-3 flex items-center justify-center">
            <ListChecks className="size-10 text-ink-200" strokeWidth={1} />
          </div>
        ) : (
          <>
            <div className="col-span-2 overflow-hidden">
              <img
                src={images[0]}
                alt=""
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            </div>
            <div className="grid grid-rows-2 gap-0.5">
              {[images[1], images[2]].map((url, index) =>
                url ? (
                  <img key={url} src={url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div key={`empty-${index}`} className="bg-ink-100" />
                ),
              )}
            </div>
          </>
        )}
      </div>

      {/* Ruled paper under the text, so a list reads as a list before a word
          of it has been read. Only the body carries it — behind the collage it
          would be invisible anyway. */}
      <div className="kl-ornament-list flex flex-1 flex-col gap-1 px-4 py-3">
        <div className="flex items-center gap-1.5">
          {/* Authorship as FACT BLOCKS -- KithLy in brass, a shop in ink.
              Which one renders is still driven by is_platform /
              owner_shop_id and neither branch has moved. */}
          {list.is_platform ? (
            <Badge variant="block" className="gap-1 bg-brass text-ink">
              <ShieldCheck strokeWidth={2.75} />
              KithLy
            </Badge>
          ) : list.owner_shop_id ? (
            <Badge variant="block" className="gap-1">
              <Store strokeWidth={2.75} />
              Shop
            </Badge>
          ) : null}
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {author}
          </span>
        </div>

        <h3 className="truncate text-[0.8125rem] font-semibold leading-snug text-foreground">
          {list.title}
        </h3>

        {/* The shop count leads the difference between a list and a shop
            collection -- it stays, and it stays second. */}
        <p className="text-[11px] text-muted-foreground">
          <span className="kl-money">{list.item_count}</span> item{list.item_count === 1 ? '' : 's'}
          {shopCount != null && shopCount > 0 && (
            <> · <span className="kl-money">{shopCount}</span> shop{shopCount === 1 ? '' : 's'}</>
          )}
        </p>

        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
          {rating !== null ? (
            <span className="inline-flex items-center gap-1">
              <Star className="size-3 fill-current text-brass" strokeWidth={0} />
              <span className="kl-money text-foreground">{rating.toFixed(1)}</span>
              <span className="kl-money text-muted-foreground">({list.rating_count})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Not rated yet</span>
          )}

          {list.save_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Bookmark className="size-3" strokeWidth={2} />
              {list.save_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
