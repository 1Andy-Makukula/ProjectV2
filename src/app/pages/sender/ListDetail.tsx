import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Bookmark,
  Copy,
  Link2,
  ListChecks,
  Package,
  Plus,
  SlidersHorizontal,
  ShieldCheck,
  ShoppingCart,
  Star,
  Store,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { PageLoader } from '../../components/shared/PageLoader';
import { CustomizeListDialog } from '../../components/shared/CustomizeListDialog';
import { JourneyView } from '../../components/shared/JourneyView';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart, toProduct } from '../../hooks/useCart';
import { useListDetail } from '../../hooks/useListDetail';
import { useListActions } from '../../hooks/useLists';
import { shareLink } from '../../../utils/native';
import { formatCurrency } from '../../../utils/currency';
import {
  ENTRY_UNAVAILABLE_TEXT,
  entryDisplay,
  entryUnavailableReason,
  isBuyableEntry,
  listAuthorLabel,
  listBuyableTotal,
  listRating,
  listSavings,
  listShopCount,
  type ListEntry,
} from '../../types/lists';
import { discountPercentage } from '../../types/items';

/**
 * A shared list — the page a WhatsApp link opens.
 *
 * Entries that can no longer be bought are shown greyed with the reason rather
 * than dropped: someone sent a list of twelve things and the recipient has to
 * see twelve, otherwise the list silently shrinks and nobody knows why. The X
 * dismisses an entry from this viewer's screen only; the list itself is
 * unchanged for everyone else.
 */
export function ListDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { addToCart } = useCart();
  const { list, loading, saved, setSaved, myRating, setMyRating, isOwner, reload } =
    useListDetail(slug);
  const { busy, toggleSave, rate, copy } = useListActions();

  // Purely local: dismissing an unavailable entry tidies this screen and
  // nothing else.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [customizeOpen, setCustomizeOpen] = useState(false);

  if (loading) return <PageLoader />;

  if (!list) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h2 className="mb-2 text-2xl font-medium">List not found</h2>
          <p className="mb-6 text-muted-foreground">
            This list may have been deleted or made private.
          </p>
          <Button onClick={() => navigate('/')}>Go back home</Button>
        </div>
      </div>
    );
  }

  const visible = list.entries.filter((entry) => !dismissed.has(entry.id));
  // Shops on the list are places to visit, not things with a price, so they
  // are outside "buy all" and outside the total.
  const buyable = list.entries.filter(isBuyableEntry);
  const total = listBuyableTotal(list.entries);
  const shopCount = listShopCount(list.entries);
  const savings = listSavings(list.entries);
  const rating = listRating(list);

  const addEntry = (entry: ListEntry) => {
    if (!entry.item) return;
    addToCart(
      toProduct({
        id: entry.item.id,
        name: entry.item.name,
        price_zmw: entry.item.price_zmw,
        image_url: entry.item.image_url,
        is_available: entry.item.is_available ?? true,
        shop_id: entry.item.shop?.id ?? '',
      }),
    );
  };

  const buyAll = () => {
    if (buyable.length === 0) return;
    buyable.forEach(addEntry);
    toast.success(`${buyable.length} item${buyable.length === 1 ? '' : 's'} added to your cart`);
  };

  const share = async () => {
    // Native sheet on a phone, the browser's sheet on the web, clipboard when
    // there is neither — and the message matches whichever actually happened.
    const outcome = await shareLink({
      title: list.title,
      text: `${list.title} on KithLy`,
      url: `${window.location.origin}/list/${list.slug}`,
    });

    if (outcome === 'copied') toast.success('Link copied');
    else if (outcome === 'failed') toast.error('Could not share that link');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 border-b bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 md:px-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-medium tracking-tight">
            {list.title}
          </h1>
          <Button variant="ghost" size="icon" onClick={share} aria-label="Share this list">
            <Link2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 md:px-6 md:py-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-slate-100 bg-white p-5 sm:p-6"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {list.is_platform ? (
              <Badge variant="tint" className="gap-1">
                <ShieldCheck strokeWidth={2} />
                KithLy
              </Badge>
            ) : list.owner_shop_id ? (
              <Badge variant="secondary" className="gap-1">
                <Store strokeWidth={2} />
                {list.shop_name}
              </Badge>
            ) : null}
            <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              {listAuthorLabel(list)}
            </span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{list.title}</h2>
          {list.description && (
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{list.description}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <ListChecks className="size-4" strokeWidth={2} />
              {list.item_count} item{list.item_count === 1 ? '' : 's'}
            </span>
            {shopCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Store className="size-4" strokeWidth={2} />
                {shopCount} shop{shopCount === 1 ? '' : 's'}
              </span>
            )}
            {rating !== null && (
              <span className="inline-flex items-center gap-1.5">
                <Star className="size-4 fill-current text-amber-500" strokeWidth={0} />
                {rating.toFixed(1)} KithLy Rating ({list.rating_count})
              </span>
            )}
          </div>

          {/* One code covers every shop in the list — the merchant scanning it
              only ever redeems their own part. */}
          {shopCount > 1 && (
            <p className="mt-3 rounded-xl bg-secondary px-3 py-2 text-xs font-light text-secondary-foreground">
              This list spans {shopCount} shops. You pay once and get a single code — each shop
              scans it and hands over only their part.
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <div className="w-full sm:flex-1">
              <Button onClick={buyAll} disabled={buyable.length === 0} className="w-full">
                <ShoppingCart className="h-4 w-4" />
                {buyable.length === 0
                  ? 'Nothing available right now'
                  : `Add all ${buyable.length} · ${formatCurrency(total, 'ZMW')}`}
              </Button>
              {savings > 0 && (
                <p className="mt-1.5 text-center text-xs font-medium text-[var(--success)]">
                  Saves {formatCurrency(savings, 'ZMW')} against normal prices
                </p>
              )}
            </div>

            {profile && !isOwner && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => setSaved(await toggleSave(list.id, saved))}
                className="w-full sm:w-auto"
              >
                <Bookmark className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
                {saved ? 'Saved' : 'Save'}
              </Button>
            )}

            {/* Adding is done by browsing, not by a picker of its own: the
                storefront is already the place with the search, the filters and
                the save tag on every card. This is the door to it. */}
            {isOwner && (
              <Button variant="outline" onClick={() => navigate('/')} className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                Add items
              </Button>
            )}

            {isOwner && (
              <Button
                variant="outline"
                onClick={() => setCustomizeOpen(true)}
                className="w-full sm:w-auto"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Customize
              </Button>
            )}

            {profile && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  const result = await copy(list.id);
                  if (result) navigate('/lists');
                }}
                className="w-full sm:w-auto"
              >
                <Copy className="h-4 w-4" />
                Make a copy
              </Button>
            )}
          </div>

          {profile && !isOwner && (
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
              <span className="text-xs text-slate-500">Rate this list:</span>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  disabled={busy}
                  aria-label={`Rate ${value} out of 5`}
                  onClick={async () => {
                    if (await rate(list.id, value)) setMyRating(value);
                  }}
                  className="transition-transform hover:scale-110 disabled:opacity-50"
                >
                  <Star
                    className={`size-5 ${
                      myRating != null && value <= myRating
                        ? 'fill-current text-amber-500'
                        : 'text-slate-300'
                    }`}
                    strokeWidth={myRating != null && value <= myRating ? 0 : 1.5}
                  />
                </button>
              ))}
            </div>
          )}
        </motion.div>

        {list.template === 'storyboard' ? (
          <JourneyView
            list={list}
            onAdd={(entry) => {
              addEntry(entry);
              toast.success(`${entryDisplay(entry).name} added to cart`);
            }}
            onVisitShop={(shopId) => navigate(`/shop/${shopId}`)}
          />
        ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          {visible.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Package className="mx-auto mb-3 h-10 w-10 text-slate-300" strokeWidth={1} />
              {list.entries.length === 0 ? (
                <>
                  <p className="text-sm">
                    {isOwner
                      ? 'Nothing on this list yet — save things to it as you browse.'
                      : 'Nothing on this list yet.'}
                  </p>
                  {isOwner && (
                    <Button className="mt-4" onClick={() => navigate('/')}>
                      <Plus className="h-4 w-4" />
                      Add items
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-sm">Nothing left to show on this list.</p>
              )}
            </div>
          ) : (
            visible.map((entry) => {
              const reason = entryUnavailableReason(entry);
              const { name, imageUrl } = entryDisplay(entry);

              return (
                <div
                  key={entry.id}
                  className={`flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0
                              ${reason ? 'bg-slate-50/60' : ''}`}
                >
                  <div
                    className={`size-14 shrink-0 overflow-hidden rounded-xl bg-slate-50
                                ${reason ? 'opacity-45 grayscale' : ''}`}
                  >
                    {imageUrl ? (
                      <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Package className="h-5 w-5 text-slate-300" strokeWidth={1.5} />
                      </div>
                    )}
                  </div>

                  <div className={`min-w-0 flex-1 ${reason ? 'opacity-60' : ''}`}>
                    {entry.entry_kind === 'shop' ? (
                      <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                        Shop
                      </p>
                    ) : (
                      entry.item?.shop?.name && (
                        <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                          {entry.item.shop.name}
                        </p>
                      )
                    )}
                    <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                    {reason ? (
                      <p className="text-[11px] font-medium text-slate-500">
                        {ENTRY_UNAVAILABLE_TEXT[reason]}
                      </p>
                    ) : entry.entry_kind === 'shop' ? (
                      <p className="truncate text-[11px] font-light text-slate-500">
                        {entry.shop?.location ?? 'Browse everything they sell'}
                      </p>
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <p className="text-sm font-semibold tabular-nums text-slate-900">
                          {formatCurrency(entry.item!.price_zmw, 'ZMW')}
                        </p>
                        {/* What is on offer this month is most of why a budget
                            list is worth following, so the old price shows. */}
                        {discountPercentage(entry.item!) !== null && (
                          <>
                            <span className="text-[11px] text-slate-400 line-through">
                              {formatCurrency(entry.item!.original_price_zmw!, 'ZMW')}
                            </span>
                            <span className="rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              {discountPercentage(entry.item!)}% off
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {reason ? (
                    // Acknowledging it: clears it from this screen, leaves the
                    // list itself untouched for everyone else.
                    <button
                      onClick={() =>
                        setDismissed((current) => new Set(current).add(entry.id))
                      }
                      aria-label={`Dismiss ${name}`}
                      className="shrink-0 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                    >
                      <X className="size-4" strokeWidth={2} />
                    </button>
                  ) : entry.entry_kind === 'shop' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/shop/${entry.shop!.id}`)}
                    >
                      <Store className="size-3.5" strokeWidth={2} />
                      Visit
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        addEntry(entry);
                        toast.success(`${name} added to cart`);
                      }}
                    >
                      Add
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
        )}
      </div>

      {isOwner && (
        <CustomizeListDialog
          open={customizeOpen}
          onOpenChange={setCustomizeOpen}
          list={list}
          onChanged={reload}
        />
      )}
    </div>
  );
}

export default ListDetail;
