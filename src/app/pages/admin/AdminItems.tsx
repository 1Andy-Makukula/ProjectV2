import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { Plus, Edit } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { supabase } from '../../../lib/supabaseClient';
import { toast } from 'sonner';

interface Item {
  id: string;
  name: string;
  description: string;
  price_zmw: number;
  image_url: string;
  is_available: boolean;
}

interface Shop {
  id: string;
  name: string;
}

interface AdminItemsProps {
  merchantShopId?: string;
  baseRoute?: string;
}

export function AdminItems({ merchantShopId, baseRoute = '/admin' }: AdminItemsProps) {
  const navigate = useNavigate();
  const { shopId: paramShopId } = useParams();
  const activeShopId = merchantShopId || paramShopId;
  const isMerchantMode = !!merchantShopId;

  const [shop, setShop] = useState<Shop | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeShopId) {
      loadShopAndItems();
    }
  }, [activeShopId]);

  const loadShopAndItems = async () => {
    try {
      setLoading(true);

      // Load shop details
      const { data: shopData, error: shopError } = await supabase
        .from('shops')
        .select('id, name')
        .eq('id', activeShopId)
        .single();

      if (shopError) throw shopError;
      setShop(shopData);

      // Load items
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select('*')
        .eq('shop_id', activeShopId)
        .order('created_at', { ascending: false });

      if (itemsError) throw itemsError;
      setItems(itemsData || []);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Failed to load items');
      navigate('/admin/shops');
    } finally {
      setLoading(false);
    }
  };

  const toggleItemAvailability = async (itemId: string, currentStatus: boolean) => {
    try {
      let query = supabase
        .from('items')
        .update({ is_available: !currentStatus })
        .eq('id', itemId);
        
      if (merchantShopId) {
        query = query.eq('shop_id', merchantShopId);
      }

      const { error } = await query;

      if (error) throw error;

      toast.success(`Item ${!currentStatus ? 'enabled' : 'disabled'} successfully`);
      loadShopAndItems();
    } catch (error: any) {
      console.error('Error toggling item availability:', error);
      toast.error('Failed to update item availability');
    }
  };

  return (
    <PageShell>
      {!isMerchantMode && (
        <AdminPageHeader
          title={`${shop?.name || 'Shop'} Items`}
          subtitle="Manage items for this storefront"
          onBack={() => navigate('/admin/shops')}
          actions={
            <Button
              onClick={() => navigate(`${baseRoute}/shops/${activeShopId}/items/new`)}
              className="bg-white text-primary hover:bg-white/90 h-8"
            >
              <Plus className="size-3.5" />
              Add Item
            </Button>
          }
        />
      )}

      <PageBody contained={!isMerchantMode}>
        {loading ? (
          <div className="text-center py-12 text-sm text-muted-foreground">Loading items…</div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-sm text-muted-foreground mb-4">No items yet</p>
              <Button onClick={() => navigate(baseRoute === '/merchant' ? `${baseRoute}/items/new` : `${baseRoute}/shops/${activeShopId}/items/new`)}>
                <Plus className="size-3.5" />
                Add Your First Item
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onEdit={() => navigate(`${baseRoute}/items/${item.id}/edit`)}
                onToggleAvailability={() => toggleItemAvailability(item.id, item.is_available)}
              />
            ))}
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}

// Item Card Component
function ItemCard({ item, onEdit, onToggleAvailability }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}>
      <Card className="overflow-hidden">
        {/* Image */}
        <div className="aspect-square bg-gradient-to-br from-primary-tint to-primary-tint-mid relative overflow-hidden">
          {item.image_url ? (
            <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-3xl font-light text-primary/40">{item.name.charAt(0)}</span>
            </div>
          )}
          <div className="absolute top-2 right-2">
            <Badge variant={item.is_available ? 'tint' : 'secondary'}>
              {item.is_available ? 'Available' : 'Unavailable'}
            </Badge>
          </div>
        </div>

        {/* Content */}
        <CardContent className="pt-3">
          <h3 className="font-medium text-sm tracking-tight mb-1">{item.name}</h3>
          {item.description && (
            <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{item.description}</p>
          )}
          <div className="text-base font-medium text-primary mb-3">
            ZMW {item.price_zmw != null ? (item.price_zmw / 100).toFixed(2) : '—'}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <Button variant="ghost" size="sm" onClick={onEdit}
              className="text-primary hover:bg-primary-tint h-7">
              <Edit className="size-3.5" />
              Edit
            </Button>

            <div className="flex items-center gap-2">
              <span className="text-[0.6875rem] text-muted-foreground">
                {item.is_available ? 'Available' : 'Hidden'}
              </span>
              <Switch checked={item.is_available} onCheckedChange={onToggleAvailability} />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Default export for lazy route loading (props are optional so this is safe)
export default AdminItems;
