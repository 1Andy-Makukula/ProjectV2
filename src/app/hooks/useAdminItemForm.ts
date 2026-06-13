import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { uploadItemImage, deleteStorefrontAsset } from '../../utils/uploadImage';
import { toCents } from '../../utils/currency';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';

export interface ItemFormData {
  name: string;
  description: string;
  price: string;
  image_url: string;
  is_available: boolean;
}

interface UseAdminItemFormOptions {
  shopId?: string;
  itemId?: string;
  isMerchant?: boolean;
  merchantUserId?: string;
}

export function useAdminItemForm({ shopId, itemId, isMerchant, merchantUserId }: UseAdminItemFormOptions) {
  const isEditing = Boolean(itemId);

  const [formData, setFormData] = useState<ItemFormData>({
    name: '',
    description: '',
    price: '',
    image_url: '',
    is_available: true,
  });
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
        price: data.price_zmw != null ? String(data.price_zmw / 100) : '',
        image_url: data.image_url || '',
        is_available: data.is_available ?? true,
      });
    } catch (error: any) {
      console.error('Error loading item:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (isEditing) {
      loadItem();
    } else if (isMerchant && merchantUserId) {
      fetchMerchantShop(merchantUserId);
    } else if (shopId) {
      setActualShopId(shopId);
    }
  }, [isEditing, itemId, isMerchant, merchantUserId, shopId, loadItem, fetchMerchantShop]);

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
    actualShopId,
    loading,
    uploading,
    saveItem,
    deleteItem,
  };
}
