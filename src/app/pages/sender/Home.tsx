import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { Button } from '../../components/ui/button';
import { Settings, Store, LogOut } from 'lucide-react';
import { motion } from 'motion/react';

interface Shop {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  image_url: string | null;
  itemCount: number;
}

export function Home() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchShops();
  }, []);

  const fetchShops = async () => {
    try {
      // Fetch active shops with item count
      const { data, error } = await supabase
        .from('shops')
        .select(`
          id,
          name,
          description,
          location,
          image_url,
          items:items(count)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const shopsWithCounts = (data || []).map((shop: any) => ({
        ...shop,
        itemCount: shop.items?.[0]?.count || 0,
      }));

      setShops(shopsWithCounts);
    } catch (error) {
      console.error('Error fetching shops:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
              KithLy
            </h1>
            <span className="text-sm text-muted-foreground">
              Hi, {profile?.name?.split(' ')[0] || 'there'}!
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/settings')}
            >
              <Settings className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Page Title */}
        <div className="mb-6">
          <h2 className="text-2xl font-semibold mb-2">What would you like to send?</h2>
          <p className="text-muted-foreground">
            Choose from our curated local shops and send memorable experiences
          </p>
        </div>

        {/* Quick Access */}
        <div className="mb-8 flex gap-4">
          <Button
            variant="outline"
            onClick={() => navigate('/orders')}
            className="flex-1 h-auto py-3"
          >
            <div className="text-center">
              <p className="font-medium">My Orders</p>
              <p className="text-xs text-muted-foreground">View order history</p>
            </div>
          </Button>
        </div>

        {/* Shops List */}
        {shops.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border">
            <Store className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No Shops Available</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              There are currently no active shops. Check back soon for amazing gift
              options!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {shops.map((shop, index) => (
              <motion.div
                key={shop.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                onClick={() => navigate(`/shop/${shop.id}`)}
                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex gap-4 p-4">
                  {/* Shop Image */}
                  <div className="w-24 h-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    {shop.image_url ? (
                      <img
                        src={shop.image_url}
                        alt={shop.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Store className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                  </div>

                  {/* Shop Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg mb-1">{shop.name}</h3>
                    {shop.location && (
                      <p className="text-sm text-muted-foreground mb-2">
                        {shop.location}
                      </p>
                    )}
                    {shop.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {shop.description}
                      </p>
                    )}
                  </div>

                  {/* Item Count Badge */}
                  <div className="flex items-start">
                    <div className="bg-orange-100 text-primary px-3 py-1 rounded-full text-sm font-medium">
                      {shop.itemCount} {shop.itemCount === 1 ? 'item' : 'items'}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
