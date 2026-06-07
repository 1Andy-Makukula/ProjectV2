import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
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
import { useAdminShopForm } from '../../hooks/useAdminShopForm';

export function AdminShopForm() {
  const navigate = useNavigate();
  const { shopId } = useParams();
  const isEditing = Boolean(shopId);

  const {
    formData,
    setFormData,
    loading,
    uploading,
    saveShop,
    deleteShop,
  } = useAdminShopForm(shopId);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string>('');

  // Sync previews with loaded data
  useEffect(() => {
    if (formData.logo_url) setImagePreview(formData.logo_url);
    if (formData.cover_image_url) setCoverImagePreview(formData.cover_image_url);
  }, [formData.logo_url, formData.cover_image_url]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await saveShop(imageFile, coverImageFile);
    if (success) {
      navigate('/admin/shops');
    }
  };

  const handleDelete = async () => {
    const success = await deleteShop();
    if (success) {
      navigate('/admin/shops');
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
