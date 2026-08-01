import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { Plus, Edit, Package } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { useAdminItems } from '../../hooks/useAdminItems';

interface AdminItemsProps {
  merchantShopId?: string;
  baseRoute?: string;
  /**
   * Suppress every write control (add, edit, availability toggle). Used by the
   * admin's read-only merchant preview, where the viewer's own admin RLS would
   * otherwise let these writes actually succeed against someone else's shop.
   */
  readOnly?: boolean;
}

export function AdminItems({
  merchantShopId,
  baseRoute = '/admin',
  readOnly = false,
}: AdminItemsProps) {
  const navigate = useNavigate();
  const { shopId: paramShopId } = useParams();
  const activeShopId = merchantShopId || paramShopId;
  const isMerchantMode = !!merchantShopId;

  const { shop, items, loading, toggleItemAvailability } = useAdminItems(activeShopId);


  return (
    <PageShell>
      {!isMerchantMode && (
        <AdminPageHeader
          title={`${shop?.name || 'Shop'} Items`}
          subtitle="Manage items for this storefront"
          onBack={() => navigate('/admin/shops')}
          actions={
            readOnly ? undefined : (
              <Button
                onClick={() => navigate(`${baseRoute}/shops/${activeShopId}/items/new`)}
                className="bg-white text-primary hover:bg-white/90 h-8"
              >
                <Plus className="size-3.5" />
                Add Item
              </Button>
            )
          }
        />
      )}

      <PageBody contained={!isMerchantMode}>
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading items…</div>
        ) : items.length === 0 ? (
          <div className="kl-card flex flex-col items-center px-6 py-16 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-tint">
              <Package className="size-6 text-primary" strokeWidth={1.5} />
            </div>
            <h3 className="text-base font-medium tracking-tight">No items yet</h3>
            <p className="mt-1 mb-5 max-w-xs text-sm font-light text-muted-foreground">
              {readOnly
                ? 'This shop has not listed anything yet.'
                : 'List your first product to start receiving gift orders.'}
            </p>
            {!readOnly && (
              <Button onClick={() => navigate(baseRoute === '/merchant' ? `${baseRoute}/items/new` : `${baseRoute}/shops/${activeShopId}/items/new`)}>
                <Plus className="size-3.5" />
                Add Your First Item
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                readOnly={readOnly}
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
function ItemCard({ item, onEdit, onToggleAvailability, readOnly = false }: any) {
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
          <h3 className="mb-1 text-sm font-medium tracking-tight">{item.name}</h3>
          {item.description && (
            <p className="mb-2 line-clamp-2 text-xs font-light text-muted-foreground">{item.description}</p>
          )}
          <div className="mb-3 text-lg font-light tracking-[-0.04em] text-foreground tabular-nums">
            <span className="mr-1 text-xs font-medium tracking-normal text-muted-foreground">ZMW</span>
            {item.price_zmw != null ? (item.price_zmw / 100).toFixed(2) : '—'}
          </div>

          {/* Actions — omitted entirely in read-only mode */}
          {!readOnly && (
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
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Default export for lazy route loading (props are optional so this is safe)
export default AdminItems;
