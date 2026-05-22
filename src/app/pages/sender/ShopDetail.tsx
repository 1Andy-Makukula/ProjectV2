import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase } from '../../../lib/supabaseClient';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ArrowLeft, Store, MapPin } from 'lucide-react';
import { motion } from 'motion/react';
import { formatCurrency } from '../../../utils/currency';

interface Shop {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  image_url: string | null;
}

interface Item {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  image_url: string | null;
  is_available: boolean;
}

export function ShopDetail() {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();
  const [shop, setShop] = useState<Shop | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchShopDetails();
  }, [shopId]);

  const fetchShopDetails = async () => {
    if (!shopId) return;

    try {
      // Fetch shop details
      const { data: shopData, error: shopError } = await supabase
        .from('shops')
        .select('*')
        .eq('id', shopId)
        .eq('is_active', true)
        .single();

      if (shopError) throw shopError;
      setShop(shopData);

      // Fetch items for this shop
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });

      if (itemsError) throw itemsError;
      setItems(itemsData || []);
    } catch (error) {
      console.error('Error fetching shop details:', error);
    } finally {
      setLoading(false);
    }
  };

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
          <Button onClick={() => navigate('/home')}>Go Back Home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/home')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-semibold">Shop Details</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Shop Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl overflow-hidden shadow-sm"
        >
          {/* Banner Image */}
          {shop.image_url && (
            <div className="w-full h-48 overflow-hidden bg-gray-100">
              <img
                src={shop.image_url}
                alt={shop.name}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Shop Info */}
          <div className="p-6">
            <div className="flex items-start gap-4">
              {!shop.image_url && (
                <div className="w-16 h-16 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <Store className="w-8 h-8 text-primary" />
                </div>
              )}
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-2">{shop.name}</h2>
                {shop.address && (
                  <div className="flex items-center gap-2 text-muted-foreground mb-3">
                    <MapPin className="w-4 h-4" />
                    <p className="text-sm">{shop.address}</p>
                  </div>
                )}
                {shop.description && (
                  <p className="text-muted-foreground">{shop.description}</p>
                )}
              </div>
            </div>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <div className="relative w-full h-48 bg-gray-100">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
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
                          {formatCurrency(item.price, item.currency)}
                        </span>
                        <Button
                          onClick={() => navigate(`/send/${item.id}`)}
                          disabled={!item.is_available}
                          className="bg-gradient-to-r from-primary to-primary-light"
                        >
                          Send
                        </Button>
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
