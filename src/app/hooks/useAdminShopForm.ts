import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { uploadPublicAsset, deleteStorefrontAsset } from '../../utils/uploadImage';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';

export interface ShopFormData {
  name: string;
  location: string;
  address: string;
  logo_url: string;
  cover_image_url: string;
  payout_method: string;
  payout_details: string;
  is_active: boolean;
}

export function useAdminShopForm(shopId?: string) {
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
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadShop = useCallback(async () => {
    if (!shopId) return;
    try {
      setLoading(true);
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
    } catch (error: any) {
      console.error('Error loading shop:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    if (isEditing) {
      loadShop();
    }
  }, [isEditing, loadShop]);

  const saveShop = useCallback(async (
    imageFile: File | null,
    coverImageFile: File | null
  ) => {
    if (!formData.name || !formData.location) {
      toast.error('Please fill in all required fields');
      return false;
    }

    setLoading(true);
    try {
      setUploading(true);
      const logoUrl = await uploadPublicAsset(imageFile, formData.logo_url, 'shop-logos');
      const coverUrl = await uploadPublicAsset(coverImageFile, formData.cover_image_url, 'shop-covers');
      setUploading(false);

      const shopPayload = {
        name: formData.name,
        location: formData.location,
        address: formData.address,
        logo_url: logoUrl,
        cover_image_url: coverUrl,
        payout_method: formData.payout_method,
        payout_details: formData.payout_details,
        is_active: formData.is_active,
      };

      if (isEditing && shopId) {
        const { error } = await supabase
          .from('shops')
          .update(shopPayload)
          .eq('id', shopId);

        if (error) throw error;
        toast.success('Shop updated successfully');
      } else {
        const { data: newShop, error } = await supabase
          .from('shops')
          .insert([shopPayload])
          .select('id')
          .single();

        if (error) throw error;

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
      return true;
    } catch (error: any) {
      console.error('Error saving shop:', error);
      toast.error(parseAuthError(error));
      return false;
    } finally {
      setLoading(false);
      setUploading(false);
    }
  }, [formData, isEditing, shopId, user?.id]);

  const deleteShop = useCallback(async () => {
    if (!shopId) return false;

    setLoading(true);
    try {
      if (formData.logo_url) {
        await deleteStorefrontAsset(formData.logo_url).catch(console.error);
      }
      if (formData.cover_image_url) {
        await deleteStorefrontAsset(formData.cover_image_url).catch(console.error);
      }

      const { error } = await supabase
        .from('shops')
        .delete()
        .eq('id', shopId);

      if (error) throw error;

      toast.success('Shop deleted successfully');
      return true;
    } catch (error: any) {
      console.error('Error deleting shop:', error);
      toast.error(parseAuthError(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, [shopId, formData.logo_url, formData.cover_image_url]);

  return {
    formData,
    setFormData,
    loading,
    uploading,
    saveShop,
    deleteShop,
  };
}
