import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { ArrowLeft, Upload, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog';
import { supabase } from '../../../lib/supabaseClient';
import { uploadItemImage } from '../../../utils/uploadImage';
import { validateImageFile } from '../../../lib/uploadValidation';
import { toast } from 'sonner';

interface ItemFormData {
  name: string;
  description: string;
  price: string;
  image_url: string;
  is_available: boolean;
}

export function AdminItemForm() {
  const navigate = useNavigate();
  const { shopId, itemId } = useParams();
  const isEditing = Boolean(itemId);
  const { profile } = useAuth();
  const isMerchant = profile?.role === 'merchant';

  const [formData, setFormData] = useState<ItemFormData>({
    name: '',
    description: '',
    price: '',
    image_url: '',
    is_available: true,
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actualShopId, setActualShopId] = useState<string>('');

  useEffect(() => {
    if (isEditing) {
      loadItem();
    } else if (isMerchant && profile?.id) {
      // Fetch the merchant's assigned shop automatically
      const fetchMerchantShop = async () => {
        const { data } = await supabase
          .from('merchant_shops')
          .select('shop_id')
          .eq('user_id', profile.id)
          .single();
        if (data) {
          setActualShopId(data.shop_id);
        }
      };
      fetchMerchantShop();
    } else if (shopId) {
      setActualShopId(shopId);
    }
  }, [itemId, shopId, isMerchant, profile?.id]);

  const loadItem = async () => {
    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('id', itemId)
        .single();

      if (error) throw error;

      setActualShopId(data.shop_id);
      setFormData({
        name: data.name || '',
        description: data.description || '',
        price: String(data.price_zmw ?? ''), // price_zmw is integer ZMW
        image_url: data.image_url || '',
        is_available: data.is_available ?? true,
      });
      setImagePreview(data.image_url || '');
    } catch (error: any) {
      console.error('Error loading item:', error);
      toast.error('Failed to load item data');
      if (isMerchant) {
        navigate('/merchant');
      } else {
        navigate('/admin/shops');
      }
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const check = validateImageFile(file);
      if (!check.ok) {
        toast.error(check.reason);
        e.target.value = '';
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadImage = async (): Promise<string> => {
    if (!imageFile) return formData.image_url;
    if (!actualShopId) {
      throw new Error('Shop context is required before uploading an image.');
    }

    setUploading(true);
    try {
      const { publicUrl } = await uploadItemImage(imageFile, actualShopId);
      return publicUrl;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      console.error('Error uploading image:', message);
      toast.error(message);
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.price) {
      toast.error('Please fill in all required fields');
      return;
    }

    const priceValue = parseFloat(formData.price);
    if (isNaN(priceValue) || priceValue <= 0) {
      toast.error('Please enter a valid price');
      return;
    }

    setLoading(true);
    try {
      // Upload image if selected
      let imageUrl = formData.image_url;
      if (imageFile) {
        imageUrl = await uploadImage();
      }

      const itemData = {
        shop_id: actualShopId,
        name: formData.name,
        description: formData.description,
        price_zmw: Math.round(priceValue), // price_zmw is integer ZMW
        image_url: imageUrl,
        is_available: formData.is_available,
      };

      if (isEditing) {
        const { error } = await supabase
          .from('items')
          .update(itemData)
          .eq('id', itemId);

        if (error) throw error;
        toast.success('Item updated successfully');
      } else {
        const { error } = await supabase
          .from('items')
          .insert([itemData]);

        if (error) throw error;
        toast.success('Item created successfully');
      }

      if (isMerchant) {
        navigate('/merchant');
      } else {
        navigate(`/admin/shops/${actualShopId}/items`);
      }
    } catch (error: any) {
      console.error('Error saving item:', error);
      toast.error('Failed to save item');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!itemId) return;

    setLoading(true);
    try {
      // Option 1: App-level cleanup of orphaned images
      // (For a robust Option 2 later: Use a PostgreSQL Trigger + pg_net Edge Function)
      if (formData.image_url) {
        const filePath = formData.image_url.split('/public/storefront-assets/')[1];
        if (filePath) {
          // Attempt to delete from bucket (fails silently if permissions lacking)
          await supabase.storage.from('storefront-assets').remove([filePath]).catch(console.error);
        }
      }

      const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      toast.success('Item deleted successfully');
      if (isMerchant) {
        navigate('/merchant');
      } else {
        navigate(`/admin/shops/${actualShopId}/items`);
      }
    } catch (error: any) {
      console.error('Error deleting item:', error);
      toast.error('Failed to delete item');
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (isMerchant) {
      navigate('/merchant');
    } else if (actualShopId) {
      navigate(`/admin/shops/${actualShopId}/items`);
    } else {
      navigate('/admin/shops');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/90 text-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={handleCancel}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-light">
                {isEditing ? 'Edit Item' : 'Add New Item'}
              </h1>
              <p className="text-sm opacity-90 font-light">
                {isEditing ? 'Update item details' : 'Create a new item'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle className="font-light">Item Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">Item Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter item name"
                  required
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Enter item description"
                  rows={3}
                />
              </div>

              {/* Price */}
              <div className="space-y-2">
                <Label htmlFor="price">Price (ZMW) *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    ZMW
                  </span>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="0.00"
                    className="pl-14"
                    required
                  />
                </div>
                {formData.price && (
                  <p className="text-xs text-muted-foreground">
                    Display: ZMW {parseFloat(formData.price || '0').toFixed(2)}
                  </p>
                )}
              </div>

              {/* Image Upload */}
              <div className="space-y-2">
                <Label htmlFor="image">Item Image</Label>
                {imagePreview && (
                  <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden mb-2 max-w-xs">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    id="image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleImageChange}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" disabled={uploading}>
                    <Upload className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Available Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="is_available">Available Status</Label>
                  <p className="text-sm text-muted-foreground font-light">
                    Available items can be purchased by customers
                  </p>
                </div>
                <Switch
                  id="is_available"
                  checked={formData.is_available}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_available: checked })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-between mt-6">
            <div>
              {isEditing && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive">
                      <Trash2 className="w-4 h-4" />
                      Delete Item
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this item. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading || uploading}>
                {loading ? 'Saving...' : isEditing ? 'Update Item' : 'Create Item'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
