import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { Plus, Edit, ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { supabase } from '../../../utils/supabase/client';
import { formatCurrency } from '../../../utils/currency';
import { toast } from 'sonner';

interface Item {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  is_available: boolean;
}

interface Shop {
  id: string;
  name: string;
}

export function AdminItems() {
  const navigate = useNavigate();
  const { shopId } = useParams();
  const [shop, setShop] = useState<Shop | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (shopId) {
      loadShopAndItems();
    }
  }, [shopId]);

  const loadShopAndItems = async () => {
    try {
      setLoading(true);

      // Load shop details
      const { data: shopData, error: shopError } = await supabase
        .from('shops')
        .select('id, name')
        .eq('id', shopId)
        .single();

      if (shopError) throw shopError;
      setShop(shopData);

      // Load items
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select('*')
        .eq('shop_id', shopId)
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
      const { error } = await supabase
        .from('items')
        .update({ is_available: !currentStatus })
        .eq('id', itemId);

      if (error) throw error;

      toast.success(`Item ${!currentStatus ? 'enabled' : 'disabled'} successfully`);
      loadShopAndItems();
    } catch (error: any) {
      console.error('Error toggling item availability:', error);
      toast.error('Failed to update item availability');
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
              onClick={() => navigate('/admin/shops')}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-light">{shop?.name || 'Shop'} Items</h1>
              <p className="text-sm opacity-90 font-light">Manage items for this shop</p>
            </div>
          </div>

          <Button
            onClick={() => navigate(`/admin/shops/${shopId}/items/new`)}
            className="bg-white text-primary hover:bg-white/90"
          >
            <Plus className="w-5 h-5" />
            Add New Item
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-12">
            <div className="text-muted-foreground">Loading items...</div>
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-muted-foreground mb-4">No items yet</p>
              <Button onClick={() => navigate(`/admin/shops/${shopId}/items/new`)}>
                <Plus className="w-5 h-5" />
                Add Your First Item
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onEdit={() => navigate(`/admin/items/${item.id}/edit`)}
                onToggleAvailability={() => toggleItemAvailability(item.id, item.is_available)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Item Card Component
function ItemCard({ item, onEdit, onToggleAvailability }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="overflow-hidden hover:shadow-lg transition-shadow">
        {/* Image */}
        <div className="aspect-square bg-gradient-to-br from-orange-100 to-orange-200 relative overflow-hidden">
          {item.image_url ? (
            <img
              src={item.image_url}
              alt={item.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-4xl font-light text-orange-400">{item.name.charAt(0)}</span>
            </div>
          )}
          <div className="absolute top-2 right-2">
            <Badge variant={item.is_available ? 'default' : 'secondary'} className="font-light">
              {item.is_available ? 'Available' : 'Unavailable'}
            </Badge>
          </div>
        </div>

        {/* Content */}
        <CardContent className="p-4">
          <h3 className="font-medium text-lg mb-1">{item.name}</h3>
          {item.description && (
            <p className="text-sm text-muted-foreground font-light mb-3 line-clamp-2">
              {item.description}
            </p>
          )}
          <div className="text-xl font-medium text-primary mb-4">
            {formatCurrency(item.price)}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              className="text-primary hover:bg-orange-50"
            >
              <Edit className="w-4 h-4" />
              Edit
            </Button>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-light">
                {item.is_available ? 'Available' : 'Unavailable'}
              </span>
              <Switch
                checked={item.is_available}
                onCheckedChange={onToggleAvailability}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
