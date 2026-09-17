import { useParams, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ArrowLeft, Store, MapPin, ShoppingCart, Gift, ConciergeBell, ShieldCheck, PackageCheck, Sparkles, Clock, Navigation, Mail, Phone, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { useCart, toProduct } from '../../hooks/useCart';
import { useShopDetail } from '../../hooks/useShopDetail';
import { PageLoader } from '../../components/shared/PageLoader';
import { ShopOfferingBadge } from '../../components/shared/ShopOfferingBadge';
import { ListCard } from '../../components/shared/ListCard';
import { SaveToListButton } from '../../components/shared/SaveToListButton';
import { useShopLists } from '../../hooks/useLists';
import { PostCard } from '../../components/storefront/PostCard';
import { EdgeDrawer } from '../../components/storefront/EdgeDrawer';
import { usePosts } from '../../hooks/usePosts';
import { isPurchasable, postActionLabel } from '../../types/posts';
import { useShopRating } from '../../hooks/useShopRating';
import { shopRating } from '../../types/shops';
import { toast } from 'sonner';
import { discountPercentage, isService, requiresConversation } from '../../types/items';
import { useShopItemGroups } from '../../hooks/useShopItemGroups';
import { parseOpeningHours, shopOpenState, WEEKDAYS } from '../../../utils/openingHours';

/** Services and quote-first listings need their terms shown before purchase. */
const opensDetail = (item: Parameters<typeof isService>[0] & Parameters<typeof requiresConversation>[0]) =>
  isService(item) || requiresConversation(item);

export function ShopDetail() {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const { shop, items, posts: shopPosts, loading } = useShopDetail(shopId);
  // Collections if the shopkeeper made any, else categories, else one flat
  // list -- decided by shop_item_groups() so every surface agrees.
  const { groups } = useShopItemGroups(shopId, items);
  // Same engagement behaviour as the storefront feed — one hook, so a like
  // here and a like there do not become two implementations.
  const { posts, toggleLike, toggleSave, sharePost } = usePosts(shopPosts);
  const { lists: shopLists } = useShopLists(shopId);
  const { canRate, myRating, saving: savingRating, rate: rateShop } = useShopRating(shopId);

  if (loading) {
    return <PageLoader />;
  }

  if (!shop) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-medium mb-2">Shop Not Found</h2>
          <p className="text-muted-foreground mb-6">
            This shop doesn't exist or is no longer available.
          </p>
          <Button onClick={() => navigate('/')}>Go Back Home</Button>
        </div>
      </div>
    );
  }

  // Evaluated in the shop's own timezone rather than the visitor's — see
  // openingHours.ts. Null means no hours were published, which must render as
  // nothing at all rather than as "Closed".
  const publishedShopLists = shopLists.filter((list) => list.visibility !== 'private');
  const rating = shopRating(shop);
  const openState = shopOpenState(shop.opening_hours);
  const hours = parseOpeningHours(shop.opening_hours);
  const hasContactPanel = Boolean(shop.maps_link || shop.public_phone || shop.public_email || hours);

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header — carries the shop's own identity rather than a generic label,
          so the page still says where you are once the banner scrolls away. */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-white/85 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </Button>

          {(shop.logo_url || shop.image_url) ? (
            <img
              src={shop.logo_url || shop.image_url || ''}
              alt=""
              className="size-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
            />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-tint">
              <Store className="size-4 text-primary" strokeWidth={1.5} />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-medium tracking-tight">{shop.name}</h1>
            {(shop.location || shop.address) && (
              <p className="truncate text-xs font-light text-muted-foreground">
                {shop.location || shop.address}
              </p>
            )}
          </div>

          {shop.verification_status === 'approved' && (
            <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-tint px-2.5 py-1 text-[0.6875rem] font-medium text-primary">
              <ShieldCheck className="size-3" strokeWidth={2} />
              Verified
            </span>
          )}

          {/* A shop is worth keeping in its own right — you go back to a butcher,
              not to one cut of meat. */}
          <SaveToListButton
            variant="inline"
            className="shrink-0"
            target={{
              kind: 'shop',
              id: shop.id,
              name: shop.name,
              image_url: shop.cover_image_url ?? shop.logo_url ?? shop.image_url ?? null,
            }}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">
        {/* Shop Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl overflow-hidden shadow-sm relative pb-6"
        >
          {/* Banner Image */}
          {(shop.cover_image_url || shop.image_url) ? (
            <div className="w-full h-48 sm:h-64 overflow-hidden bg-ink-100 relative">
              <img
                src={shop.cover_image_url || shop.image_url || ''}
                alt={shop.name}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="kl-wash-ember relative w-full h-32 sm:h-48 opacity-90">
              <div className="absolute inset-0 flex items-center justify-center">
                <Store className="size-10 text-white/25" strokeWidth={1.25} />
              </div>
            </div>
          )}

          {/* Shop Info (Overlapping Profile Pic) */}
          <div className="px-6 relative">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 -mt-16 sm:-mt-12 relative z-10 mb-4">
              {(shop.logo_url || shop.image_url) ? (
                <img
                  src={shop.logo_url || shop.image_url || ''}
                  alt={shop.name}
                  loading="lazy"
                  decoding="async"
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover flex-shrink-0 bg-white border-4 border-white shadow-md"
                />
              ) : (
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-primary-tint flex items-center justify-center flex-shrink-0 border-4 border-white shadow-md">
                  <Store className="w-10 h-10 sm:w-12 sm:h-12 text-primary" strokeWidth={1.5} />
                </div>
              )}
              <div className="flex-1 text-center sm:text-left mt-2 sm:mt-0 sm:mb-2">
                <h2 className="text-2xl sm:text-3xl font-bold mb-1">{shop.name}</h2>
                {shop.address && (
                  <div className="flex items-center justify-center sm:justify-start gap-2 text-muted-foreground">
                    <MapPin className="w-4 h-4" />
                    <p className="text-sm">{shop.address}</p>
                  </div>
                )}
              </div>
            </div>
            {shop.description && (
              <p className="text-muted-foreground mt-4 text-center sm:text-left max-w-2xl font-light leading-relaxed">
                {shop.description}
              </p>
            )}

            {/* Trust strip — every figure here was already in the shop record;
                it had simply never been surfaced to the buyer. */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {shop.verification_status === 'approved' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-3 py-1.5 text-xs font-medium text-primary">
                  <ShieldCheck className="size-3.5" strokeWidth={2} />
                  KithLy Verified
                </span>
              )}

              {rating !== null && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">
                  <Star className="size-3.5 fill-current text-warn-500" strokeWidth={0} />
                  {rating.toFixed(1)} KithLy Rating
                  <span className="font-normal opacity-75">({shop.rating_count})</span>
                </span>
              )}

              {(shop.successful_deliveries ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">
                  <PackageCheck className="size-3.5 text-[var(--success)]" strokeWidth={2} />
                  {shop.successful_deliveries!.toLocaleString()} order
                  {shop.successful_deliveries === 1 ? '' : 's'} fulfilled
                </span>
              )}

              {/* Replaces a services-only pill: a products shop and a shop that
                  does both were previously indistinguishable here. */}
              <ShopOfferingBadge
                offersProducts={shop.offers_products}
                offersServices={shop.offers_services}
                className="px-3 py-1.5 text-xs font-medium normal-case tracking-normal [&>svg]:size-3.5"
              />

              {openState && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                    openState.isOpen
                      ? 'bg-[var(--success)]/10 text-[var(--success)]'
                      : 'bg-secondary text-secondary-foreground'
                  }`}
                >
                  <Clock className="size-3.5" strokeWidth={2} />
                  {openState.label}
                  {openState.detail && (
                    <span className="font-normal opacity-75">· {openState.detail}</span>
                  )}
                </span>
              )}

              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">
                <Sparkles className="size-3.5" strokeWidth={2} />
                {items.length} item{items.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* Only offered to someone who actually collected an order from
                here — can_rate_shop decides, and the write policy enforces the
                same rule again. */}
            {canRate && (
              <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl bg-secondary px-4 py-3">
                <span className="text-xs font-medium text-secondary-foreground">
                  {myRating ? 'Your KithLy Rating:' : 'Rate this shop:'}
                </span>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    disabled={savingRating}
                    aria-label={`Rate ${value} out of 5`}
                    onClick={() => rateShop(value)}
                    className="transition-transform hover:scale-110 disabled:opacity-50"
                  >
                    <Star
                      className={`size-5 ${
                        myRating != null && value <= myRating
                          ? 'fill-current text-warn-500'
                          : 'text-ink-300'
                      }`}
                      strokeWidth={myRating != null && value <= myRating ? 0 : 1.5}
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Directions, contact and trading hours. Every field is optional,
                so a shop that has published none of them renders exactly as it
                did before this panel existed. */}
            {hasContactPanel && (
              <div className="mt-6 border-t border-[var(--border)] pt-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {shop.maps_link && (
                      <Button asChild variant="outline" size="sm">
                        {/* Merchant-supplied outbound link on a public page:
                            noopener/noreferrer is not optional, and the URL is
                            constrained to Google Maps hosts by both
                            isValidMapsLink and shops_maps_link_check. */}
                        <a
                          href={shop.maps_link}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          <Navigation className="size-3.5" strokeWidth={2} />
                          Get Directions
                        </a>
                      </Button>
                    )}

                    {shop.public_phone && (
                      <Button asChild variant="outline" size="sm">
                        <a href={`tel:${shop.public_phone.replace(/[^\d+]/g, '')}`}>
                          <Phone className="size-3.5" strokeWidth={2} />
                          {shop.public_phone}
                        </a>
                      </Button>
                    )}

                    {shop.public_email && (
                      <Button asChild variant="outline" size="sm">
                        <a href={`mailto:${shop.public_email}`}>
                          <Mail className="size-3.5" strokeWidth={2} />
                          {shop.public_email}
                        </a>
                      </Button>
                    )}
                  </div>

                  {hours && (
                    <div className="shrink-0 sm:min-w-[13rem]">
                      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                        Opening Hours
                      </h3>
                      <dl className="space-y-1">
                        {WEEKDAYS.map(({ key, label }) => (
                          <div key={key} className="flex items-baseline justify-between gap-6 text-xs">
                            <dt className="font-light text-muted-foreground">{label}</dt>
                            <dd className="tabular-nums font-light">
                              {hours[key]
                                ? `${hours[key]!.open} – ${hours[key]!.close}`
                                : <span className="text-muted-foreground/60">Closed</span>}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Two columns from `lg` up: what the shop is saying and selling on the
            left, what it has put together beside it. Below that the aside has
            nowhere to go, so it becomes the same edge drawer the storefront
            uses rather than a third pattern to learn. */}
        <div className="lg:flex lg:items-start lg:gap-8">
          <div className="min-w-0 space-y-6 md:space-y-8 lg:flex-1">

        {/* What the shop has posted. */}
        {posts.length > 0 && (
          <div>
            <div className="mb-4">
              <h3 className="kl-display text-xl font-semibold">From this shop</h3>
              <p className="mt-1 text-sm font-light text-muted-foreground/80">
                What they are telling people about.
              </p>
            </div>
            <div className="space-y-5">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onOpenShop={() => undefined}
                  onLike={() => toggleLike(post.id)}
                  onSave={() => toggleSave(post.id)}
                  onShare={() => sharePost(post)}
                  onBuy={isPurchasable(post) ? () => navigate(`/post/${post.id}`) : undefined}
                  buyLabel={postActionLabel(post.author)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Items Grid */}
        <div>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Available Items
              </h3>
              <p className="mt-1 text-sm font-light text-muted-foreground/80">
                Send any of these as a gift, redeemable in store.
              </p>
            </div>
          </div>

          {items.length === 0 ? (
            <Card className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-tint">
                <Store className="size-6 text-primary" strokeWidth={1.5} />
              </div>
              <h4 className="text-base font-medium tracking-tight">Nothing listed just yet</h4>
              <p className="mt-1 max-w-xs text-sm font-light text-muted-foreground">
                This shop is still setting up its catalogue. Check back soon.
              </p>
            </Card>
          ) : (
            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.key}>
                  {/* A heading only where the grouping named one. The flat
                      grouping has no label, and inventing "All items" for a
                      shop with six things would be noise. */}
                  {group.label && (
                    <h4 className="mb-3 text-sm font-medium tracking-tight text-foreground">
                      {group.label}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {group.items.length}
                      </span>
                    </h4>
                  )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.items.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.05, 0.4) }}
                  className="h-full"
                >
                  <Card
                    className={`group h-full overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-panel)] ${
                      !item.is_available ? 'opacity-60' : ''
                    }`}
                  >
                    {/* Item Image */}
                    <div className="relative w-full h-40 sm:h-48 overflow-hidden bg-secondary">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Store className="size-10 text-muted-foreground/40" strokeWidth={1.25} />
                        </div>
                      )}

                      {/* Corner badges — discount takes precedence, then the
                          service marker, so the two never stack on top of
                          each other. */}
                      {discountPercentage(item) !== null ? (
                        <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[0.6875rem] font-semibold text-primary-foreground shadow-sm">
                          -{discountPercentage(item)}%
                        </span>
                      ) : opensDetail(item) ? (
                        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[0.6875rem] font-semibold text-primary shadow-sm backdrop-blur-sm">
                          <ConciergeBell className="size-3" strokeWidth={2} />
                          {item.requires_scheduling ? 'Bookable' : 'Service'}
                        </span>
                      ) : null}

                      {!item.is_available && (
                        <div className="absolute inset-0 flex items-center justify-center bg-foreground/50 backdrop-blur-[1px]">
                          <span className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold tracking-tight">
                            Unavailable
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Item Details */}
                    <div className="p-4 space-y-3">
                      <div>
                        <h4 className="font-medium tracking-tight mb-1 line-clamp-1">{item.name}</h4>
                        {item.description && (
                          <p className="text-sm font-light text-muted-foreground line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-end justify-between gap-3 pt-1">
                        <div className="flex flex-col">
                          <span className="text-lg font-medium tracking-tight text-primary tabular-nums">
                            ZMW {item.price_zmw != null ? (item.price_zmw / 100).toFixed(2) : '—'}
                          </span>
                          {discountPercentage(item) !== null && item.original_price_zmw != null && (
                            <span className="text-xs font-light text-muted-foreground line-through tabular-nums">
                              ZMW {(item.original_price_zmw / 100).toFixed(2)}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {/* Services carry terms the card cannot show, so they
                              open their detail view rather than the cart. */}
                          {opensDetail(item) ? (
                            <Button
                              size="sm"
                              onClick={() => navigate(`/item/${item.id}`)}
                              disabled={!item.is_available}
                              className="kl-gradient-brand"
                            >
                              <ConciergeBell className="w-4 h-4 mr-1" />
                              {item.requires_scheduling ? 'Book' : 'View'}
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  addToCart(toProduct(item));
                                  toast.success(`${item.name} added to cart`);
                                }}
                                disabled={!item.is_available}
                                className="border-primary/25 text-primary hover:bg-primary-tint"
                              >
                                <ShoppingCart className="w-4 h-4 mr-1" />
                                Add
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => navigate(`/send/${item.id}`)}
                                disabled={!item.is_available}
                                className="kl-gradient-brand"
                              >
                                <Gift className="w-4 h-4 mr-1" />
                                Gift
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
                </section>
              ))}
            </div>
          )}
        </div>

          </div>

          <SideColumn />
        </div>
      </div>

      {/* The aside, on the widths where it cannot be a column. */}
      <EdgeDrawer
        title="About this shop"
        description="What they have put together."
        hiddenFrom="lg"
      >
        <SideColumn inDrawer />
      </EdgeDrawer>
    </div>
  );

  /**
   * What sits beside the catalogue.
   *
   * Declared once and rendered twice — as a sticky column on a wide screen and
   * inside the drawer on a narrow one — so the two can never end up showing
   * different things.
   */
  function SideColumn({ inDrawer = false }: { inDrawer?: boolean }) {
    if (publishedShopLists.length === 0) return null;

    return (
      <aside
        className={
          inDrawer
            ? 'space-y-3'
            : 'kl-scroll sticky top-24 hidden max-h-[calc(100vh-8rem)] w-[20rem] shrink-0 space-y-3 overflow-y-auto lg:block'
        }
      >
        <h3 className="kl-display text-lg font-semibold">Lists from this shop</h3>
        <p className="-mt-2 text-sm font-light text-muted-foreground/80">
          Save one to your own, or buy the whole thing at once.
        </p>
        {publishedShopLists.map((list) => (
          <ListCard key={list.id} list={list} onOpen={() => navigate(`/list/${list.slug}`)} />
        ))}
      </aside>
    );
  }
}
