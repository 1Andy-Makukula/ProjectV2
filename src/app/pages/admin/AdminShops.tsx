import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Plus, Edit, Search, ArrowLeft, MapPin } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { supabase } from '../../../utils/supabase/client';
import { toast } from 'sonner';

interface Shop {
  id: string;
  name: string;
  description: string;
  location: string;
  image_url: string;
  is_active: boolean;
  item_count?: number;
}

export function AdminShops() {
  const navigate = useNavigate();
  const [shops, setShops] = useState<Shop[]>([]);
  const [filteredShops, setFilteredShops] = useState<Shop[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShops();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const filtered = shops.filter(shop =>
        shop.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        shop.location?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredShops(filtered);
    } else {
      setFilteredShops(shops);
    }
  }, [searchQuery, shops]);

  const loadShops = async () => {
    try {
      setLoading(true);

      const { data: shopsData, error: shopsError } = await supabase
        .from('shops')
        .select('*')
        .order('created_at', { ascending: false });

      if (shopsError) throw shopsError;

      // Get item counts for each shop
      const shopsWithCounts = await Promise.all(
        (shopsData || []).map(async (shop) => {
          const { count } = await supabase
            .from('items')
            .select('*', { count: 'exact', head: true })
            .eq('shop_id', shop.id)
            .eq('is_available', true);

          return {
            ...shop,
            item_count: count || 0,
          };
        })
      );

      setShops(shopsWithCounts);
      setFilteredShops(shopsWithCounts);
    } catch (error: any) {
      console.error('Error loading shops:', error);
      toast.error('Failed to load shops');
    } finally {
      setLoading(false);
    }
  };

  const toggleShopActive = async (shopId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('shops')
        .update({ is_active: !currentStatus })
        .eq('id', shopId);

      if (error) throw error;

      toast.success(`Shop ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      loadShops();
    } catch (error: any) {
      console.error('Error toggling shop status:', error);
      toast.error('Failed to update shop status');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/90 text-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/admin')}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-light">Manage Shops</h1>
              <p className="text-sm opacity-90 font-light">View and manage all shops</p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                placeholder="Search shops by name or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-white/60"
              />
            </div>
            <Button
              onClick={() => navigate('/admin/shops/new')}
              className="bg-white text-primary hover:bg-white/90"
            >
              <Plus className="w-5 h-5" />
              Add New Shop
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-12">
            <div className="text-muted-foreground">Loading shops...</div>
          </div>
        ) : filteredShops.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-muted-foreground mb-4">
                {searchQuery ? 'No shops found matching your search' : 'No shops yet'}
              </p>
              {!searchQuery && (
                <Button onClick={() => navigate('/admin/shops/new')}>
                  <Plus className="w-5 h-5" />
                  Add Your First Shop
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredShops.map((shop) => (
              <ShopCard
                key={shop.id}
                shop={shop}
                onEdit={() => navigate(`/admin/shops/${shop.id}/edit`)}
                onToggleActive={() => toggleShopActive(shop.id, shop.is_active)}
                onClick={() => navigate(`/admin/shops/${shop.id}/items`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Shop Card Component
function ShopCard({ shop, onEdit, onToggleActive, onClick }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
        <div onClick={onClick}>
          {/* Image */}
          <div className="aspect-video bg-gradient-to-br from-orange-100 to-orange-200 relative overflow-hidden">
            {shop.image_url ? (
              <img
                src={shop.image_url}
                alt={shop.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-4xl font-light text-orange-400">{shop.name.charAt(0)}</span>
              </div>
            )}
          </div>

          {/* Content */}
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-medium text-lg">{shop.name}</h3>
              <Badge variant={shop.is_active ? 'default' : 'secondary'} className="font-light">
                {shop.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>

            {shop.location && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
                <MapPin className="w-4 h-4" />
                <span className="font-light">{shop.location}</span>
              </div>
            )}

            <div className="text-sm text-muted-foreground font-light mb-4">
              {shop.item_count || 0} active {shop.item_count === 1 ? 'item' : 'items'}
            </div>
          </CardContent>
        </div>

        {/* Actions */}
        <div className="px-4 pb-4 pt-0 flex items-center justify-between border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="text-primary hover:bg-orange-50"
          >
            <Edit className="w-4 h-4" />
            Edit
          </Button>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-light">
              {shop.is_active ? 'Active' : 'Inactive'}
            </span>
            <Switch
              checked={shop.is_active}
              onCheckedChange={() => {
                onToggleActive();
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
