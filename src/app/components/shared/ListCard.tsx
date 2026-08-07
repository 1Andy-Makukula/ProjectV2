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
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white text-left
                 transition-all duration-300 hover:border-slate-200 hover:shadow-md"
    >
      {/* Collage — one large image with a stack beside it, degrading to
          whatever the list actually has. */}
      <div className="grid aspect-[4/3] w-full grid-cols-3 gap-0.5 bg-slate-50">
        {images.length === 0 ? (
          <div className="col-span-3 flex items-center justify-center">
            <ListChecks className="size-10 text-slate-200" strokeWidth={1} />
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
                  <div key={`empty-${index}`} className="bg-slate-100" />
                ),
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-4 py-3">
        <div className="flex items-center gap-1.5">
          {list.is_platform ? (
            <Badge variant="tint" className="gap-1">
              <ShieldCheck strokeWidth={2} />
              KithLy
            </Badge>
          ) : list.owner_shop_id ? (
            <Badge variant="secondary" className="gap-1">
              <Store strokeWidth={2} />
              Shop
            </Badge>
          ) : null}
          <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {author}
          </span>
        </div>

        <h3 className="truncate text-sm font-semibold leading-snug text-slate-900">
          {list.title}
        </h3>

        <p className="text-[11px] text-slate-500">
          {list.item_count} item{list.item_count === 1 ? '' : 's'}
          {shopCount != null && shopCount > 0 && (
            <> · {shopCount} shop{shopCount === 1 ? '' : 's'}</>
          )}
        </p>

        <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
          {rating !== null ? (
            <span className="inline-flex items-center gap-1">
              <Star className="size-3 fill-current text-amber-500" strokeWidth={0} />
              <span className="font-medium text-slate-700">{rating.toFixed(1)}</span>
              <span className="text-slate-400">({list.rating_count})</span>
            </span>
          ) : (
            <span className="text-slate-400">Not rated yet</span>
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
