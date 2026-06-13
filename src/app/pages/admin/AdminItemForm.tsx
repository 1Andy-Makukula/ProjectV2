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
import { validateImageFile } from '../../../lib/uploadValidation';
import { toast } from 'sonner';
import { useAdminItemForm } from '../../hooks/useAdminItemForm';

export function AdminItemForm() {
  const navigate = useNavigate();
  const { shopId, itemId } = useParams();
  const isEditing = Boolean(itemId);
  const { profile } = useAuth();
  const isMerchant = profile?.role === 'merchant';

  const {
    formData,
    setFormData,
    actualShopId,
    loading,
    uploading,
    saveItem,
    deleteItem,
  } = useAdminItemForm({
    shopId,
    itemId,
    isMerchant,
    merchantUserId: profile?.id,
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');

  // Sync previews with loaded data
  useEffect(() => {
    if (formData.image_url) {
      setImagePreview(formData.image_url);
    } else {
      setImagePreview('');
    }
  }, [formData.image_url]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await saveItem(imageFile);
    if (success) {
      if (isMerchant) {
        navigate('/merchant');
      } else {
        navigate(`/admin/shops/${actualShopId}/items`);
      }
    }
  };

  const handleDelete = async () => {
    const success = await deleteItem();
    if (success) {
      if (isMerchant) {
        navigate('/merchant');
      } else {
        navigate(`/admin/shops/${actualShopId}/items`);
      }
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
                  <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden mb-2 w-full max-w-xs">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <Input
                    id="image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleImageChange}
                    className="w-full"
                  />
                  <Button type="button" variant="outline" disabled={uploading} className="w-full sm:w-auto flex items-center justify-center gap-2">
                    <Upload className="w-4 h-4" />
                    <span className="sm:hidden">Upload Image</span>
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
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between mt-6 w-full">
            <div className="w-full sm:w-auto">
              {isEditing && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" className="w-full sm:w-auto flex items-center justify-center gap-2">
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

            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={loading}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading || uploading} className="w-full sm:w-auto">
                {loading ? 'Saving...' : isEditing ? 'Update Item' : 'Create Item'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
