import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { Upload, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
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
import { toast } from 'sonner';

interface ShopFormData {
  name: string;
  location: string;
  address: string;
  logo_url: string;
  cover_image_url: string;
  payout_method: string;
  payout_details: string;
  is_active: boolean;
}

export function AdminShopForm() {
  const navigate = useNavigate();
  const { shopId } = useParams();
  const isEditing = Boolean(shopId);
  const { user } = useAuth();

  const [formData, setFormData] = useState<ShopFormData>({
    name: '',
    location: '',
    address: '',
    logo_url: '',
    cover_image_url: '',
    payout_method: 'airtel',
    payout_details: '',
    is_active: true,
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (isEditing) {
      loadShop();
    }
  }, [shopId]);

  const loadShop = async () => {
    try {
      const { data, error } = await supabase
        .from('shops')
        .select('*')
        .eq('id', shopId)
        .single();

      if (error) throw error;

      setFormData({
        name: data.name || '',
        location: data.location || '',
        address: data.address || '',
        logo_url: data.logo_url || '',
        cover_image_url: data.cover_image_url || '',
        payout_method: data.payout_method || 'airtel',
        payout_details: data.payout_details || '',
        is_active: data.is_active ?? true,
      });
      setImagePreview(data.logo_url || '');
      setCoverImagePreview(data.cover_image_url || '');
    } catch (error: any) {
      console.error('Error loading shop:', error);
      toast.error('Failed to load shop data');
      navigate('/admin/shops');
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCoverImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCoverImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadImage = async (file: File | null, existingUrl: string, folder: string): Promise<string> => {
    if (!file) return existingUrl;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `shop-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${folder}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('storefront-assets')
        .upload(filePath, imageFile);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('storefront-assets')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload image');
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.location) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      // Upload images if selected
      const logoUrl = await uploadImage(imageFile, formData.logo_url, 'shop-logos');
      const coverUrl = await uploadImage(coverImageFile, formData.cover_image_url, 'shop-covers');

      // V2 Schema Strict Payload
      const shopData = {
        name: formData.name,
        location: formData.location,
        address: formData.address,
        logo_url: logoUrl,
        cover_image_url: coverUrl,
        payout_method: formData.payout_method,
        payout_details: formData.payout_details,
        is_active: formData.is_active,
        // owner_id is deprecated on shops table. We map using merchant_shops instead.
      };

      if (isEditing) {
        const { error } = await supabase
          .from('shops')
          .update(shopData)
          .eq('id', shopId);

        if (error) throw error;
        toast.success('Shop updated successfully');
      } else {
        const { data: newShop, error } = await supabase
          .from('shops')
          .insert([shopData])
          .select('id')
          .single();

        if (error) throw error;

        // Map ownership using the intersection table
        if (user?.id && newShop?.id) {
          const { error: mappingError } = await supabase
            .from('merchant_shops')
            .insert([{ user_id: user.id, shop_id: newShop.id }]);

          if (mappingError) {
            console.error('Failed to map merchant ownership:', mappingError);
            toast.error('Shop created, but ownership assignment failed.');
          }
        }

        toast.success('Shop created successfully');
      }

      navigate('/admin/shops');
    } catch (error: any) {
      console.error('Error saving shop:', error);
      toast.error('Failed to save shop');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!shopId) return;

    setLoading(true);
    try {
      // Option 1: App-level cleanup of orphaned images
      // (For a robust Option 2 later: Use a PostgreSQL Trigger + pg_net Edge Function)
      if (formData.logo_url) {
        const filePath = formData.logo_url.split('/public/storefront-assets/')[1];
        if (filePath) {
          await supabase.storage.from('storefront-assets').remove([filePath]).catch(console.error);
        }
      }
      if (formData.cover_image_url) {
        const coverPath = formData.cover_image_url.split('/public/storefront-assets/')[1];
        if (coverPath) {
          await supabase.storage.from('storefront-assets').remove([coverPath]).catch(console.error);
        }
      }

      const { error } = await supabase
        .from('shops')
        .delete()
        .eq('id', shopId);

      if (error) throw error;

      toast.success('Shop deleted successfully');
      navigate('/admin/shops');
    } catch (error: any) {
      console.error('Error deleting shop:', error);
      toast.error('Failed to delete shop');
      setLoading(false);
    }
  };

  return (
    <PageShell>
      <AdminPageHeader
        title={isEditing ? 'Edit Shop' : 'Add New Shop'}
        subtitle={isEditing ? 'Update storefront details' : 'Create a new merchant storefront'}
        onBack={() => navigate('/admin/shops')}
      />
      <PageBody>
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle className="font-light">Shop Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">Shop Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter shop name"
                  required
                />
              </div>

              {/* Location */}
              <div className="space-y-2">
                <Label htmlFor="location">Location *</Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="e.g., Lusaka, Ndola"
                  required
                />
              </div>

              {/* Address */}
              <div className="space-y-2">
                <Label htmlFor="address">Full Address</Label>
                <Textarea
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Enter full street address"
                  rows={2}
                />
              </div>

              {/* Logo Upload */}
              <div className="space-y-2">
                <Label htmlFor="image">Shop Logo (Avatar)</Label>
                {imagePreview && (
                  <div className="relative w-24 h-24 bg-gray-100 rounded-full overflow-hidden mb-2 border-2 border-white shadow-sm">
                    <img
                      src={imagePreview}
                      alt="Logo Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    id="image"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" disabled={uploading}>
                    <Upload className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Cover Upload */}
              <div className="space-y-2">
                <Label htmlFor="cover_image">Shop Cover (Banner)</Label>
                {coverImagePreview && (
                  <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden mb-2">
                    <img
                      src={coverImagePreview}
                      alt="Cover Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    id="cover_image"
                    type="file"
                    accept="image/*"
                    onChange={handleCoverImageChange}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" disabled={uploading}>
                    <Upload className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Payout Method */}
              <div className="space-y-2">
                <Label htmlFor="payout_method">Payout Method</Label>
                <Select
                  value={formData.payout_method}
                  onValueChange={(value) => setFormData({ ...formData, payout_method: value })}
                >
                  <SelectTrigger id="payout_method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="airtel">Airtel Money</SelectItem>
                    <SelectItem value="mtn">MTN Money</SelectItem>
                    <SelectItem value="bank">Bank Account</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Payout Details */}
              <div className="space-y-2">
                <Label htmlFor="payout_details">Payout Details</Label>
                <Input
                  id="payout_details"
                  value={formData.payout_details}
                  onChange={(e) => setFormData({ ...formData, payout_details: e.target.value })}
                  placeholder="Enter phone number or account number"
                />
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="is_active">Active Status</Label>
                  <p className="text-sm text-muted-foreground font-light">
                    Active shops are visible to customers
                  </p>
                </div>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
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
                      Delete Shop
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this shop and all its items. This action cannot be undone.
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
                onClick={() => navigate('/admin/shops')}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading || uploading}>
                {loading ? 'Saving...' : isEditing ? 'Update Shop' : 'Create Shop'}
              </Button>
            </div>
          </div>
        </form>
      </PageBody>
    </PageShell>
  );
}
