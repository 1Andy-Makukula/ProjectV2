import { useMemo, useRef, useState } from 'react';
import { Archive, ImagePlus, Loader2, Package, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { useCatalog } from '../../hooks/useCatalog';
import { useCategoryFlags } from '../../hooks/useCategoryFlags';
import { uploadPublicAsset } from '../../../utils/uploadImage';
import { validateImageFile } from '../../../lib/uploadValidation';
import { MAX_ITEM_IMAGES } from '../../../utils/itemGallery';
import { formatCurrency, toCents } from '../../../utils/currency';
import { ITEM_TYPES, type ItemType } from '../../types/items';

/**
 * The listing templates shops import from.
 *
 * Nothing here is live commerce: no checkout, cart or settlement path reads
 * catalog_items. An entry only becomes real when a shop imports it, and the
 * import writes an independent copy.
 */
export function AdminCatalog() {
  const { items, loading, createItem, setActive, deleteItem } = useCatalog();
  const { cats: categories } = useCategoryFlags();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [itemType, setItemType] = useState<ItemType>('product');
  const [categoryId, setCategoryId] = useState<string>('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const active = useMemo(() => items.filter((item) => item.is_active), [items]);
  const retired = useMemo(() => items.filter((item) => !item.is_active), [items]);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (chosen.length === 0) return;

    if (imageUrls.length + chosen.length > MAX_ITEM_IMAGES) {
      toast.error(`A catalogue item can have at most ${MAX_ITEM_IMAGES} images.`);
      return;
    }

    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of chosen) {
        const check = validateImageFile(file);
        if (!check.ok) {
          toast.error(`${file.name}: ${check.reason}`);
          continue;
        }
        uploaded.push(await uploadPublicAsset(file, '', 'catalog'));
      }
      setImageUrls((current) => [...current, ...uploaded]);
    } catch (error: any) {
      console.error('[AdminCatalog] upload failed:', error);
      toast.error('Could not upload that image');
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setPrice('');
    setItemType('product');
    setCategoryId('');
    setImageUrls([]);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Give the item a name');
      return;
    }

    const parsed = price.trim() ? Number(price) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error('Suggested price must be greater than zero, or left blank');
      return;
    }

    setSaving(true);
    const ok = await createItem(
      {
        name: name.trim(),
        description: description.trim(),
        // Stored in ngwee like every other price on the platform.
        suggested_price_zmw: parsed !== null ? toCents(parsed) : null,
        category_id: categoryId || null,
        item_type: itemType,
      },
      imageUrls,
    );
    setSaving(false);
    if (ok) resetForm();
  };

  return (
    <PageShell>
      <AdminPageHeader
        title="Catalogue"
        subtitle="Ready-made listings shops can import and then price themselves"
      />
      <PageBody>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-light">Add to the catalogue</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="catalog-name">Name *</Label>
                    <Input
                      id="catalog-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Bag of Cement"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="catalog-price">Suggested Price (ZMW)</Label>
                    <Input
                      id="catalog-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="Shops can change this"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={itemType} onValueChange={(v) => setItemType(v as ItemType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ITEM_TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={categoryId || 'none'}
                      onValueChange={(v) => setCategoryId(v === 'none' ? '' : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Uncategorised" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Uncategorised</SelectItem>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="catalog-description">Description</Label>
                  <Textarea
                    id="catalog-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="What a shop importing this is selling"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Images</Label>
                  {imageUrls.length > 0 && (
                    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {imageUrls.map((url, index) => (
                        <li
                          key={url}
                          className="relative aspect-square overflow-hidden rounded-lg border border-border"
                        >
                          <img src={url} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() =>
                              setImageUrls((current) => current.filter((_, i) => i !== index))
                            }
                            aria-label={`Remove image ${index + 1}`}
                            className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                          >
                            <Trash2 className="size-3" strokeWidth={2.5} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleFiles}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading || imageUrls.length >= MAX_ITEM_IMAGES}
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2"
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImagePlus className="size-4" />
                    )}
                    {imageUrls.length >= MAX_ITEM_IMAGES ? 'Maximum reached' : 'Add images'}
                  </Button>
                  <p className="text-xs font-light text-muted-foreground">
                    Copied into each shop that imports this, so retiring the entry later never
                    breaks their listing.
                  </p>
                </div>

                <Button type="submit" disabled={saving || uploading}>
                  {saving ? 'Adding…' : 'Add to catalogue'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <CatalogList
            title="Available to import"
            emptyText="Nothing in the catalogue yet."
            items={active}
            loading={loading}
            onRetire={(id) => setActive(id, false)}
            onDelete={deleteItem}
          />

          {retired.length > 0 && (
            <CatalogList
              title="Retired"
              emptyText=""
              items={retired}
              loading={false}
              onRestore={(id) => setActive(id, true)}
              onDelete={deleteItem}
            />
          )}
        </div>
      </PageBody>
    </PageShell>
  );
}

function CatalogList({
  title,
  emptyText,
  items,
  loading,
  onRetire,
  onRestore,
  onDelete,
}: {
  title: string;
  emptyText: string;
  items: ReturnType<typeof useCatalog>['items'];
  loading: boolean;
  onRetire?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-light">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {item.images[0] ? (
                    <img src={item.images[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Package className="size-5 text-muted-foreground/40" strokeWidth={1.5} />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs font-light text-muted-foreground">
                    {item.suggested_price_zmw != null
                      ? formatCurrency(item.suggested_price_zmw, 'ZMW')
                      : 'No suggested price'}
                    {item.images.length > 1 ? ` · ${item.images.length} images` : ''}
                  </p>
                </div>

                <Badge variant="secondary">{item.item_type}</Badge>

                {onRetire && (
                  <Button variant="ghost" size="sm" onClick={() => onRetire(item.id)}>
                    <Archive className="size-3.5" />
                    Retire
                  </Button>
                )}
                {onRestore && (
                  <Button variant="ghost" size="sm" onClick={() => onRestore(item.id)}>
                    <Undo2 className="size-3.5" />
                    Restore
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => onDelete(item.id)}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
