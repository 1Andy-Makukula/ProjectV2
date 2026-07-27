import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { PricingTransparencyWidget } from '../../components/shared/PricingTransparencyWidget';
import {
  ArrowLeft,
  Upload,
  Trash2,
  Package,
  ConciergeBell,
  CalendarClock,
  Timer,
  Tag,
  Layers,
  MessageSquare,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { FULFILLMENT_LOCATIONS, ITEM_TYPES, type ItemType } from '../../types/items';
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
    categories,
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
  const [exchangeRate, setExchangeRate] = useState<number>(26.00);

  // Fetch exchange rate on mount
  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        const { data, error } = await supabase
          .from('platform_settings')
          .select('current_usd_zmw_rate')
          .single();

        if (error) throw error;
        if (data?.current_usd_zmw_rate) {
          setExchangeRate(Number(data.current_usd_zmw_rate));
        }
      } catch (err) {
        console.error('Failed to fetch exchange rate:', err);
      }
    };
    fetchExchangeRate();
  }, []);

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

  /**
   * Switching back to a product clears the service-only answers so the form
   * never shows scheduling settings that the save step would discard anyway.
   */
  const handleItemTypeChange = (item_type: ItemType) => {
    if (item_type === 'product') {
      setFormData({
        ...formData,
        item_type,
        requires_scheduling: false,
        lead_time_days: '',
        fulfillment_location: '',
      });
      return;
    }
    setFormData({ ...formData, item_type });
  };

  const isServiceItem = formData.item_type === 'service';

  const selectedLocation = FULFILLMENT_LOCATIONS.find(
    (location) => location.value === formData.fulfillment_location,
  );

  const discountPreview = (() => {
    const original = parseFloat(formData.original_price);
    const current = parseFloat(formData.price);
    if (!formData.is_discounted || isNaN(original) || isNaN(current)) return null;
    if (original <= current || original <= 0) return null;
    return Math.round(((original - current) / original) * 100);
  })();

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
              {/* Item Type */}
              <div className="space-y-2">
                <Label>What are you listing?</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ITEM_TYPES.map((option) => {
                    const Icon = option.value === 'service' ? ConciergeBell : Package;
                    const selected = formData.item_type === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => handleItemTypeChange(option.value)}
                        className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left
                                    transition-all duration-200 active:scale-[0.99]
                                    ${selected
                                      ? 'border-primary bg-primary-tint shadow-sm'
                                      : 'border-border hover:border-border-dark'}`}
                      >
                        <Icon
                          className={`h-4 w-4 ${selected ? 'text-primary' : 'text-muted-foreground'}`}
                          strokeWidth={1.75}
                        />
                        <span className="text-sm font-medium">{option.label}</span>
                        <span className="text-xs font-light leading-snug text-muted-foreground">
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

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

              {/* Category */}
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category_id || 'none'}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category_id: value === 'none' ? '' : value })
                  }
                >
                  <SelectTrigger id="category">
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
                <p className="text-xs font-light text-muted-foreground">
                  Categories drive where this appears in browse and search.
                </p>
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
                <div className="pt-2">
                  <PricingTransparencyWidget
                    inputPriceZMW={parseFloat(formData.price || '0')}
                    liveExchangeRate={exchangeRate}
                  />
                </div>
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

          {/* ── Service details ─────────────────────────────────────────── */}
          {isServiceItem && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="font-light flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-primary" strokeWidth={1.75} />
                  Service Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Scheduling */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label htmlFor="requires_scheduling">Needs a booked date</Label>
                    <p className="text-sm text-muted-foreground font-light">
                      The recipient agrees a date with you before you carry out the work.
                    </p>
                  </div>
                  <Switch
                    id="requires_scheduling"
                    checked={formData.requires_scheduling}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, requires_scheduling: checked })
                    }
                  />
                </div>

                {formData.requires_scheduling && (
                  <div className="space-y-2">
                    <Label htmlFor="lead_time_days">Notice required (days)</Label>
                    <Input
                      id="lead_time_days"
                      type="number"
                      min="0"
                      step="1"
                      value={formData.lead_time_days}
                      onChange={(e) =>
                        setFormData({ ...formData, lead_time_days: e.target.value })
                      }
                      placeholder="e.g. 3"
                    />
                    <p className="text-xs font-light text-muted-foreground">
                      The soonest a booking can be made, counted from the day it is requested.
                      Leave blank if you can take same-day work.
                    </p>
                  </div>
                )}

                {/* Where it happens */}
                <div className="space-y-2">
                  <Label htmlFor="fulfillment_location">Where it happens</Label>
                  <Select
                    value={formData.fulfillment_location || 'unset'}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        fulfillment_location:
                          value === 'unset'
                            ? ''
                            : (value as typeof formData.fulfillment_location),
                      })
                    }
                  >
                    <SelectTrigger id="fulfillment_location">
                      <SelectValue placeholder="Not specified" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">Not specified</SelectItem>
                      {FULFILLMENT_LOCATIONS.map((location) => (
                        <SelectItem key={location.value} value={location.value}>
                          {location.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedLocation && (
                    <p className="text-xs font-light text-muted-foreground">
                      {selectedLocation.description}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Voucher validity ────────────────────────────────────────── */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="font-light flex items-center gap-2">
                <Timer className="h-4 w-4 text-primary" strokeWidth={1.75} />
                Voucher Validity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="has_expiry">Voucher expires</Label>
                  <p className="text-sm text-muted-foreground font-light">
                    Turn this off for gifts that should stay claimable indefinitely.
                  </p>
                </div>
                <Switch
                  id="has_expiry"
                  checked={formData.has_expiry}
                  onCheckedChange={(checked) => setFormData({ ...formData, has_expiry: checked })}
                />
              </div>

              {formData.has_expiry && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="valid_for_days">Valid for (days)</Label>
                    <Input
                      id="valid_for_days"
                      type="number"
                      min="1"
                      step="1"
                      value={formData.valid_for_days}
                      onChange={(e) =>
                        setFormData({ ...formData, valid_for_days: e.target.value })
                      }
                      placeholder="Platform default"
                    />
                    <p className="text-xs font-light text-muted-foreground">
                      Leave blank to use the platform default.
                    </p>
                  </div>

                  {/* Which clock applies — the distinction that matters most */}
                  <div className="flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                    <Info
                      className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5"
                      strokeWidth={1.75}
                    />
                    <p className="text-xs font-light leading-relaxed text-muted-foreground">
                      {formData.requires_scheduling ? (
                        <>
                          Counted from the <span className="font-medium text-foreground">agreed
                          date</span>, not the purchase. A booking made months ahead stays valid
                          right through to the day it happens.
                        </>
                      ) : (
                        <>
                          Counted from the{' '}
                          <span className="font-medium text-foreground">purchase date</span>, since
                          nothing is booked in advance.
                        </>
                      )}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Pricing options ─────────────────────────────────────────── */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="font-light flex items-center gap-2">
                <Tag className="h-4 w-4 text-primary" strokeWidth={1.75} />
                Pricing Options
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Discount */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="is_discounted">On discount</Label>
                  <p className="text-sm text-muted-foreground font-light">
                    Shows the old price struck through next to the new one.
                  </p>
                </div>
                <Switch
                  id="is_discounted"
                  checked={formData.is_discounted}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_discounted: checked })
                  }
                />
              </div>

              {formData.is_discounted && (
                <div className="space-y-2">
                  <Label htmlFor="original_price">Original price (ZMW)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      ZMW
                    </span>
                    <Input
                      id="original_price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.original_price}
                      onChange={(e) =>
                        setFormData({ ...formData, original_price: e.target.value })
                      }
                      placeholder="0.00"
                      className="pl-14"
                    />
                  </div>
                  {discountPreview !== null && (
                    <p className="text-xs font-medium text-success">
                      {discountPreview}% off the original price
                    </p>
                  )}
                </div>
              )}

              <div className="h-px bg-border" />

              {/* Wholesale */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="is_wholesale" className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                    Offer a wholesale rate
                  </Label>
                  <p className="text-sm text-muted-foreground font-light">
                    A lower per-unit price once the buyer orders enough.
                  </p>
                </div>
                <Switch
                  id="is_wholesale"
                  checked={formData.is_wholesale}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_wholesale: checked })
                  }
                />
              </div>

              {formData.is_wholesale && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="wholesale_price">Wholesale price per unit (ZMW)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        ZMW
                      </span>
                      <Input
                        id="wholesale_price"
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.wholesale_price}
                        onChange={(e) =>
                          setFormData({ ...formData, wholesale_price: e.target.value })
                        }
                        placeholder="0.00"
                        className="pl-14"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="minimum_order_quantity">Minimum units</Label>
                    <Input
                      id="minimum_order_quantity"
                      type="number"
                      min="2"
                      step="1"
                      value={formData.minimum_order_quantity}
                      onChange={(e) =>
                        setFormData({ ...formData, minimum_order_quantity: e.target.value })
                      }
                      placeholder="e.g. 10"
                    />
                  </div>
                </div>
              )}

              <div className="h-px bg-border" />

              {/* Custom quote */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="allow_custom_quote" className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                    Accept custom quote requests
                  </Label>
                  <p className="text-sm text-muted-foreground font-light">
                    Buyers can describe what they need and you reply with a price, instead of
                    buying at the listed one.
                  </p>
                </div>
                <Switch
                  id="allow_custom_quote"
                  checked={formData.allow_custom_quote}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, allow_custom_quote: checked })
                  }
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
