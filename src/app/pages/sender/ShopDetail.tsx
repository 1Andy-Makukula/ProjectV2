import { useParams, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ArrowLeft, Store, MapPin, ShoppingCart, Gift, ConciergeBell, ShieldCheck, PackageCheck, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useCart, toProduct } from '../../hooks/useCart';
import { useShopDetail } from '../../hooks/useShopDetail';
import { PageLoader } from '../../components/shared/PageLoader';
import { toast } from 'sonner';
import { discountPercentage, isService, requiresConversation } from '../../types/items';

/** Services and quote-first listings need their terms shown before purchase. */
const opensDetail = (item: Parameters<typeof isService>[0] & Parameters<typeof requiresConversation>[0]) =>
  isService(item) || requiresConversation(item);

export function ShopDetail() {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();
  const { addToCart, setCartSliderOpen } = useCart();
  const { shop, items, loading } = useShopDetail(shopId);

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

  return (
    <div className="min-h-screen bg-gray-50">
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
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">
        {/* Shop Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl overflow-hidden shadow-sm relative pb-6"
        >
          {/* Banner Image */}
          {(shop.cover_image_url || shop.image_url) ? (
            <div className="w-full h-48 sm:h-64 overflow-hidden bg-gray-100 relative">
              <img
                src={shop.cover_image_url || shop.image_url || ''}
                alt={shop.name}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="kl-gradient-brand relative w-full h-32 sm:h-48 opacity-90">
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

              {(shop.successful_deliveries ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">
                  <PackageCheck className="size-3.5 text-[var(--success)]" strokeWidth={2} />
                  {shop.successful_deliveries!.toLocaleString()} order
                  {shop.successful_deliveries === 1 ? '' : 's'} fulfilled
                </span>
              )}

              {shop.offers_services && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">
                  <ConciergeBell className="size-3.5" strokeWidth={2} />
                  Bookable services
                </span>
              )}

              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">
                <Sparkles className="size-3.5" strokeWidth={2} />
                {items.length} item{items.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </motion.div>

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item, index) => (
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
                                  setCartSliderOpen(true);
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
          )}
        </div>
      </div>
    </div>
  );
}
