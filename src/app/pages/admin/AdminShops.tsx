import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Plus, Edit, Search, MapPin, Store } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { supabase } from '../../../lib/supabaseClient';
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
    <PageShell>
      <AdminPageHeader
        title="Manage Shops"
        subtitle="View and manage all storefronts"
        onBack={() => navigate('/admin')}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-white/60" />
              <Input
                placeholder="Search shops…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 w-48 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus-visible:ring-white/30"
              />
            </div>
            <Button
              onClick={() => navigate('/admin/shops/new')}
              className="bg-white text-primary hover:bg-white/90 h-8"
            >
              <Plus className="size-3.5" />
              Add Shop
            </Button>
          </div>
        }
      />
      <PageBody>
        {loading ? (
          <div className="text-center py-12 text-sm text-muted-foreground">Loading shops…</div>
        ) : filteredShops.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-sm text-muted-foreground mb-4">
                {searchQuery ? 'No shops match your search' : 'No shops yet'}
              </p>
              {!searchQuery && (
                <Button onClick={() => navigate('/admin/shops/new')}>
                  <Plus className="size-3.5" />
                  Add Your First Shop
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
      </PageBody>
    </PageShell>
  );
}

// Shop Card Component
function ShopCard({ shop, onEdit, onToggleActive, onClick }: any) {
  return (
    <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        transition={{ duration: 0.18 }}
      >
        <Card className="overflow-hidden cursor-pointer">
          <div onClick={onClick}>
            {/* Image */}
            <div className="aspect-video bg-gradient-to-br from-primary-tint to-primary-tint-mid relative overflow-hidden">
              {shop.logo_url || shop.image_url ? (
                <img
                  src={shop.logo_url || shop.image_url}
                  alt={shop.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-3xl font-light text-primary/40">{shop.name.charAt(0)}</span>
                </div>
              )}
            </div>

            {/* Content */}
            <CardContent className="pt-3">
              <div className="flex items-start justify-between mb-1.5">
                <h3 className="font-medium text-sm tracking-tight">{shop.name}</h3>
                <Badge variant={shop.is_active ? 'tint' : 'secondary'}>
                  {shop.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              {shop.location && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                  <MapPin className="size-3" />
                  <span>{shop.location}</span>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                {shop.item_count || 0} active {shop.item_count === 1 ? 'item' : 'items'}
              </div>
            </CardContent>
          </div>

          {/* Actions */}
          <div className="px-4 pb-4 pt-3 flex items-center justify-between border-t border-border">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="text-primary hover:bg-primary-tint h-7 px-2"
              >
                <Edit className="size-3.5 mr-1" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(`/shop/${shop.id}`, '_blank');
                }}
                className="text-slate-600 hover:bg-slate-100 h-7 px-2"
              >
                <Store className="size-3.5 mr-1" />
                Public View
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[0.6875rem] text-muted-foreground">
                {shop.is_active ? 'Active' : 'Inactive'}
              </span>
              <Switch
                checked={shop.is_active}
                onCheckedChange={() => { onToggleActive(); }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        </Card>
      </motion.div>
  );
}
