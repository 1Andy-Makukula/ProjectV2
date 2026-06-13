import { useParams, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ArrowLeft, Store, MapPin, ShoppingCart, Gift } from 'lucide-react';
import { motion } from 'motion/react';
import { useCart, toProduct } from '../../hooks/useCart';
import { useShopDetail } from '../../hooks/useShopDetail';
import { toast } from 'sonner';

export function ShopDetail() {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();
  const { addToCart, setCartSliderOpen } = useCart();
  const { shop, items, loading } = useShopDetail(shopId);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
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
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-semibold">Shop Details</h1>
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
            <div className="w-full h-32 sm:h-48 bg-gradient-to-r from-orange-100 to-amber-50"></div>
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
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 border-4 border-white shadow-md">
                  <Store className="w-10 h-10 sm:w-12 sm:h-12 text-primary" />
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
              <p className="text-muted-foreground mt-4 text-center sm:text-left max-w-2xl">{shop.description}</p>
            )}
          </div>
        </motion.div>

        {/* Items Grid */}
        <div>
          <h3 className="text-xl font-semibold mb-4">Available Items</h3>

          {items.length === 0 ? (
            <Card className="p-12 text-center">
              <Store className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h4 className="text-lg font-medium mb-2">No Items Available</h4>
              <p className="text-muted-foreground max-w-md mx-auto">
                This shop doesn't have any items listed yet. Check back soon!
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Card
                    className={`overflow-hidden ${
                      !item.is_available ? 'opacity-60' : ''
                    }`}
                  >
                    {/* Item Image */}
                    <div className="relative w-full h-40 sm:h-48 bg-gray-100">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Store className="w-12 h-12 text-gray-400" />
                        </div>
                      )}
                      {!item.is_available && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <span className="bg-white px-4 py-2 rounded-lg font-medium">
                            Unavailable
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Item Details */}
                    <div className="p-4 space-y-3">
                      <div>
                        <h4 className="font-semibold text-lg mb-1">{item.name}</h4>
                        {item.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {item.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold text-primary">
                          ZMW {item.price_zmw != null ? (item.price_zmw / 100).toFixed(2) : '—'}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              addToCart(toProduct(item));
                              toast.success(`${item.name} added to cart`);
                              setCartSliderOpen(true);
                            }}
                            disabled={!item.is_available}
                            className="border-orange-200 text-orange-600 hover:bg-orange-50"
                          >
                            <ShoppingCart className="w-4 h-4 mr-1" />
                            Add
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => navigate(`/send/${item.id}`)}
                            disabled={!item.is_available}
                            className="bg-gradient-to-r from-primary to-primary-light"
                          >
                            <Gift className="w-4 h-4 mr-1" />
                            Gift
                          </Button>
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
