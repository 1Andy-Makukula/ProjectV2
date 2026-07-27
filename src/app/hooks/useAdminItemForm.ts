import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { uploadItemImage, deleteStorefrontAsset } from '../../utils/uploadImage';
import { toCents } from '../../utils/currency';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import type { FulfillmentLocation, ItemType } from '../types/items';

export interface ItemFormData {
  name: string;
  description: string;
  price: string;
  image_url: string;
  is_available: boolean;
  category_id: string;

  item_type: ItemType;
  requires_scheduling: boolean;
  lead_time_days: string;
  fulfillment_location: FulfillmentLocation | '';
  allow_custom_quote: boolean;

  has_expiry: boolean;
  valid_for_days: string;

  is_discounted: boolean;
  original_price: string;

  is_wholesale: boolean;
  wholesale_price: string;
  minimum_order_quantity: string;
}

export interface CategoryOption {
  id: string;
  name: string;
}

const EMPTY_FORM: ItemFormData = {
  name: '',
  description: '',
  price: '',
  image_url: '',
  is_available: true,
  category_id: '',

  item_type: 'product',
  requires_scheduling: false,
  lead_time_days: '',
  fulfillment_location: '',
  allow_custom_quote: false,

  has_expiry: true,
  valid_for_days: '',

  is_discounted: false,
  original_price: '',

  is_wholesale: false,
  wholesale_price: '',
  minimum_order_quantity: '1',
};

/** Ngwee integer to a display string, or '' when unset. */
function fromNgwee(value: number | null | undefined): string {
  return value != null ? String(value / 100) : '';
}

/** Optional positive integer field: '' means "not set". */
function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

interface UseAdminItemFormOptions {
  shopId?: string;
  itemId?: string;
  isMerchant?: boolean;
  merchantUserId?: string;
}

export function useAdminItemForm({ shopId, itemId, isMerchant, merchantUserId }: UseAdminItemFormOptions) {
  const isEditing = Boolean(itemId);

  const [formData, setFormData] = useState<ItemFormData>(EMPTY_FORM);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [actualShopId, setActualShopId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Fetch the merchant's assigned shop automatically
  const fetchMerchantShop = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('merchant_shops')
        .select('shop_id')
        .eq('user_id', userId)
        .single();
      if (data) {
        setActualShopId(data.shop_id);
      }
    } catch (err) {
      console.error('Error fetching merchant shop:', err);
    }
  }, []);

  const loadItem = useCallback(async () => {
    if (!itemId) return;
    try {
      setLoading(true);
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
        price: fromNgwee(data.price_zmw),
        image_url: data.image_url || '',
        is_available: data.is_available ?? true,
        category_id: data.category_id || '',

        item_type: (data.item_type as ItemType) || 'product',
        requires_scheduling: data.requires_scheduling ?? false,
        lead_time_days: data.lead_time_days != null ? String(data.lead_time_days) : '',
        fulfillment_location: (data.fulfillment_location as FulfillmentLocation) || '',
        allow_custom_quote: data.allow_custom_quote ?? false,

        has_expiry: data.has_expiry ?? true,
        valid_for_days: data.valid_for_days != null ? String(data.valid_for_days) : '',

        is_discounted: data.is_discounted ?? false,
        original_price: fromNgwee(data.original_price_zmw),

        is_wholesale: data.is_wholesale ?? false,
        wholesale_price: fromNgwee(data.wholesale_price_zmw),
        minimum_order_quantity:
          data.minimum_order_quantity != null ? String(data.minimum_order_quantity) : '1',
      });
    } catch (error: any) {
      console.error('Error loading item:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  const loadCategories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('ui_order_index', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });

      if (error) throw error;
      setCategories(data ?? []);
    } catch (err) {
      // A missing category list should not block editing the rest of the item.
      console.error('Error loading categories:', err);
    }
  }, []);

  useEffect(() => {
    if (isEditing) {
      loadItem();
    } else if (isMerchant && merchantUserId) {
      fetchMerchantShop(merchantUserId);
    } else if (shopId) {
      setActualShopId(shopId);
    }
  }, [isEditing, itemId, isMerchant, merchantUserId, shopId, loadItem, fetchMerchantShop]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const saveItem = useCallback(async (imageFile: File | null) => {
    if (!formData.name || !formData.price) {
      toast.error('Please fill in all required fields');
      return false;
    }

    const priceValue = parseFloat(formData.price);
    if (isNaN(priceValue) || priceValue <= 0) {
      toast.error('Please enter a valid price');
      return false;
    }

    // Mirror the database CHECK constraints so the merchant gets a readable
    // message instead of a Postgres constraint violation.
    const originalPriceValue = formData.is_discounted ? parseFloat(formData.original_price) : null;
    if (formData.is_discounted) {
      if (originalPriceValue == null || isNaN(originalPriceValue) || originalPriceValue <= priceValue) {
        toast.error('The original price must be higher than the discounted price');
        return false;
      }
    }

    const wholesalePriceValue = formData.is_wholesale ? parseFloat(formData.wholesale_price) : null;
    const minimumOrderQuantity = parseOptionalInt(formData.minimum_order_quantity) ?? 1;
    if (formData.is_wholesale) {
      if (wholesalePriceValue == null || isNaN(wholesalePriceValue) || wholesalePriceValue <= 0) {
        toast.error('Enter a wholesale price per unit');
        return false;
      }
      if (minimumOrderQuantity < 2) {
        toast.error('Wholesale needs a minimum order quantity of at least 2');
        return false;
      }
    }

    const validForDays = parseOptionalInt(formData.valid_for_days);
    if (formData.has_expiry && formData.valid_for_days.trim() && (validForDays == null || validForDays < 1)) {
      toast.error('Validity must be at least 1 day');
      return false;
    }

    const leadTimeDays = parseOptionalInt(formData.lead_time_days);
    if (formData.lead_time_days.trim() && (leadTimeDays == null || leadTimeDays < 0)) {
      toast.error('Lead time cannot be negative');
      return false;
    }

    const isServiceItem = formData.item_type === 'service';

    setLoading(true);
    try {
      let imageUrl = formData.image_url;
      if (imageFile) {
        if (!actualShopId) {
          throw new Error('Shop context is required before uploading an image.');
        }
        setUploading(true);
        const { publicUrl } = await uploadItemImage(imageFile, actualShopId);
        imageUrl = publicUrl;
        setUploading(false);
      }

      const itemPayload = {
        shop_id: actualShopId,
        name: formData.name,
        description: formData.description,
        price_zmw: toCents(priceValue),
        image_url: imageUrl,
        is_available: formData.is_available,
        category_id: formData.category_id || null,

        item_type: formData.item_type,
        // Scheduling, lead time and location only describe services; clear them
        // when the merchant switches an item back to a product so the row does
        // not carry contradictory data.
        requires_scheduling: isServiceItem ? formData.requires_scheduling : false,
        lead_time_days: isServiceItem ? leadTimeDays : null,
        fulfillment_location: isServiceItem ? formData.fulfillment_location || null : null,
        allow_custom_quote: formData.allow_custom_quote,

        has_expiry: formData.has_expiry,
        valid_for_days: formData.has_expiry ? validForDays : null,

        is_discounted: formData.is_discounted,
        original_price_zmw:
          formData.is_discounted && originalPriceValue != null ? toCents(originalPriceValue) : null,

        is_wholesale: formData.is_wholesale,
        wholesale_price_zmw:
          formData.is_wholesale && wholesalePriceValue != null ? toCents(wholesalePriceValue) : null,
        minimum_order_quantity: formData.is_wholesale ? minimumOrderQuantity : 1,
      };

      if (isEditing && itemId) {
        const { error } = await supabase
          .from('items')
          .update(itemPayload)
          .eq('id', itemId);

        if (error) throw error;
        toast.success('Item updated successfully');
      } else {
        const { error } = await supabase
          .from('items')
          .insert([itemPayload]);

        if (error) throw error;
        toast.success('Item created successfully');
      }

      return true;
    } catch (error: any) {
      console.error('Error saving item:', error);
      toast.error(parseAuthError(error));
      return false;
    } finally {
      setLoading(false);
      setUploading(false);
    }
  }, [formData, isEditing, itemId, actualShopId]);

  const deleteItem = useCallback(async () => {
    if (!itemId) return false;

    setLoading(true);
    try {
      if (formData.image_url) {
        await deleteStorefrontAsset(formData.image_url).catch(console.error);
      }

      const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      toast.success('Item deleted successfully');
      return true;
    } catch (error: any) {
      console.error('Error deleting item:', error);
      toast.error(parseAuthError(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, [itemId, formData.image_url]);

  return {
    formData,
    setFormData,
    categories,
    actualShopId,
    loading,
    uploading,
    saveItem,
    deleteItem,
  };
}
