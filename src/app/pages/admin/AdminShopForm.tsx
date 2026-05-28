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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
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
  description: string;
  location: string;
  address: string;
  image_url: string;
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
    description: '',
    location: '',
    address: '',
    image_url: '',
    payout_method: 'airtel',
    payout_details: '',
    is_active: true,
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
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
        description: data.description || '',
        location: data.location || '',
        address: data.address || '',
        image_url: data.image_url || '',
        payout_method: data.payout_method || 'airtel',
        payout_details: data.payout_details || '',
        is_active: data.is_active ?? true,
      });
      setImagePreview(data.image_url || '');
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

  const uploadImage = async (): Promise<string> => {
    if (!imageFile) return formData.image_url;

    setUploading(true);
    try {
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `shop-${Date.now()}.${fileExt}`;
      const filePath = `shop-logos/${fileName}`;

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
      // Upload image if selected
      let imageUrl = formData.image_url;
      if (imageFile) {
        imageUrl = await uploadImage();
      }

      const shopData = {
        ...formData,
        image_url: imageUrl,
        owner_id: user?.id,
      };

      if (isEditing) {
        const { error } = await supabase
          .from('shops')
          .update(shopData)
          .eq('id', shopId);

        if (error) throw error;
        toast.success('Shop updated successfully');
      } else {
        const { error } = await supabase
          .from('shops')
          .insert([shopData]);

        if (error) throw error;
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/90 text-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/admin/shops')}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-light">
                {isEditing ? 'Edit Shop' : 'Add New Shop'}
              </h1>
              <p className="text-sm opacity-90 font-light">
                {isEditing ? 'Update shop details' : 'Create a new shop'}
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

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Enter shop description"
                  rows={3}
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

              {/* Image Upload */}
              <div className="space-y-2">
                <Label htmlFor="image">Shop Image</Label>
                {imagePreview && (
                  <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden mb-2">
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
                    accept="image/*"
                    onChange={handleImageChange}
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
      </div>
    </div>
  );
}
