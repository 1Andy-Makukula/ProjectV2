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
import { OpeningHoursEditor } from '../../components/shared/OpeningHoursEditor';
import { ShopDocumentsEditor } from '../../components/shared/ShopDocumentsEditor';
import { useShopDocuments } from '../../hooks/useShopDocuments';
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
  const { profile } = useAuth();
  const isMerchant = profile?.role === 'merchant';

  const {
    formData,
    setFormData,
    loading,
    uploading,
    bankOptions,
    isEditing,
    saveShop,
    deleteShop,
    effectiveShopId,
  } = useAdminShopForm({ shopId, isMerchant, merchantUserId: profile?.id });

  const { documents, addDocument, removeDocument } = useShopDocuments(effectiveShopId);

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

  // Merchants have no access to /admin/shops at all -- send them back to
  // their own dashboard instead.
  const backTarget = isMerchant ? '/merchant' : '/admin/shops';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await saveShop(imageFile, coverImageFile);
    if (success) {
      navigate(backTarget);
    }
  };

  const handleDelete = async () => {
    const success = await deleteShop();
    if (success) {
      navigate(backTarget);
    }
  };

  return (
    <PageShell>
      <AdminPageHeader
        title={isEditing ? 'Edit Shop' : 'Add New Shop'}
        subtitle={isEditing ? 'Update storefront details' : 'Create a new merchant storefront'}
        onBack={() => navigate(backTarget)}
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

              {/* Google Maps link — becomes a clickable outbound link on the
                  public storefront, so it is validated here and again by the
                  shops_maps_link_check constraint. */}
              <div className="space-y-2">
                <Label htmlFor="maps_link">Google Maps Link</Label>
                <Input
                  id="maps_link"
                  type="url"
                  inputMode="url"
                  value={formData.maps_link}
                  onChange={(e) => setFormData({ ...formData, maps_link: e.target.value })}
                  placeholder="https://maps.app.goo.gl/…"
                />
                <p className="text-xs font-light text-muted-foreground">
                  Adds a Get Directions button to your storefront. Share your shop from
                  Google Maps and paste the link here.
                </p>
              </div>

              {/* Public contact — deliberately separate from the owner's login
                  details, which stay private. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="public_phone">Public Phone</Label>
                  <Input
                    id="public_phone"
                    type="tel"
                    inputMode="tel"
                    value={formData.public_phone}
                    onChange={(e) => setFormData({ ...formData, public_phone: e.target.value })}
                    placeholder="+260 …"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="public_email">Public Email</Label>
                  <Input
                    id="public_email"
                    type="email"
                    inputMode="email"
                    value={formData.public_email}
                    onChange={(e) => setFormData({ ...formData, public_email: e.target.value })}
                    placeholder="shop@example.com"
                  />
                </div>
              </div>
              <p className="-mt-4 text-xs font-light text-muted-foreground">
                Shown to buyers on your storefront. Leave blank to show nothing — your
                login email and phone are never published.
              </p>

              {/* Compliance paperwork. Only available once the shop exists,
                  since a document row needs a shop_id to hang off. */}
              {isEditing && effectiveShopId && (
                <>
                  <ShopDocumentsEditor
                    documents={documents}
                    onAdd={addDocument}
                    onRemove={removeDocument}
                    disabled={loading}
                  />
                  <div className="h-px bg-border" />
                </>
              )}

              <OpeningHoursEditor
                value={formData.opening_hours}
                onChange={(opening_hours) => setFormData({ ...formData, opening_hours })}
                disabled={loading}
              />

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
                    <SelectItem value="zamtel">Zamtel Money</SelectItem>
                    <SelectItem value="bank">Bank Account</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Bank Name — only for bank account payouts */}
              {formData.payout_method === 'bank' && (
                <div className="space-y-2">
                  <Label htmlFor="payout_bank_name">Bank Name *</Label>
                  <Select
                    value={formData.payout_bank_name}
                    onValueChange={(value) => setFormData({ ...formData, payout_bank_name: value })}
                  >
                    <SelectTrigger id="payout_bank_name">
                      <SelectValue placeholder="Select a bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankOptions.map((bank) => (
                        <SelectItem key={bank.method_key} value={bank.method_key}>
                          {bank.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Payout Details */}
              <div className="space-y-2">
                <Label htmlFor="payout_details">
                  {formData.payout_method === 'bank' ? 'Account Number' : 'Phone Number'}
                </Label>
                <Input
                  id="payout_details"
                  value={formData.payout_details}
                  onChange={(e) => setFormData({ ...formData, payout_details: e.target.value })}
                  placeholder={
                    formData.payout_method === 'bank'
                      ? 'Enter bank account number'
                      : 'Enter mobile money phone number'
                  }
                />
              </div>

              {/* Account Holder Name */}
              <div className="space-y-2">
                <Label htmlFor="payout_account_name">Account Holder Name</Label>
                <Input
                  id="payout_account_name"
                  value={formData.payout_account_name}
                  onChange={(e) => setFormData({ ...formData, payout_account_name: e.target.value })}
                  placeholder="Full name on the account, for payout verification"
                />
              </div>

              {/* Active Toggle — governance field, admin-only. update_shop_profile
                  doesn't accept it, so a merchant could turn this switch and it
                  would silently do nothing; hide it instead of showing a
                  control with no effect. */}
              {!isMerchant && (
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
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-between mt-6">
            <div>
              {isEditing && !isMerchant && (
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
                onClick={() => navigate(backTarget)}
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
