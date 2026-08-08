import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { uploadPublicAsset, deleteStorefrontAsset } from '../../utils/uploadImage';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import {
  isValidMapsLink,
  isValidTime,
  parseOpeningHours,
  type OpeningHours,
} from '../../utils/openingHours';

export interface ShopFormData {
  name: string;
  location: string;
  address: string;
  logo_url: string;
  cover_image_url: string;
  payout_method: string;
  payout_details: string;
  payout_bank_name: string;
  payout_account_name: string;
  is_active: boolean;
  /** Storefront contact and directions — all optional, all clearable. */
  maps_link: string;
  public_email: string;
  public_phone: string;
  opening_hours: OpeningHours;
}

export interface PayoutBankOption {
  method_key: string;
  display_name: string;
  category: 'mobile_money' | 'bank';
}

interface UseAdminShopFormOptions {
  shopId?: string;
  isMerchant?: boolean;
  merchantUserId?: string;
}

export function useAdminShopForm({ shopId, isMerchant, merchantUserId }: UseAdminShopFormOptions) {
  const { user } = useAuth();
  // Merchants reach this form at /merchant/shop/edit, which carries no
  // :shopId param at all -- there is exactly one shop to resolve, via
  // merchant_shops, mirroring useAdminItemForm's fetchMerchantShop pattern.
  const [actualShopId, setActualShopId] = useState('');
  const effectiveShopId = isMerchant ? actualShopId : shopId;
  const isEditing = Boolean(effectiveShopId);

  const fetchMerchantShop = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('merchant_shops')
        .select('shop_id')
        .eq('user_id', userId)
        .single();
      if (data) setActualShopId(data.shop_id);
    } catch (err) {
      console.error('Error resolving merchant shop:', err);
    }
  }, []);

  useEffect(() => {
    if (isMerchant && merchantUserId) {
      fetchMerchantShop(merchantUserId);
    }
  }, [isMerchant, merchantUserId, fetchMerchantShop]);

  const [formData, setFormData] = useState<ShopFormData>({
    name: '',
    location: '',
    address: '',
    logo_url: '',
    cover_image_url: '',
    payout_method: 'airtel',
    payout_details: '',
    payout_bank_name: '',
    payout_account_name: '',
    is_active: true,
    maps_link: '',
    public_email: '',
    public_phone: '',
    opening_hours: {},
  });
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bankOptions, setBankOptions] = useState<PayoutBankOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('payout_bank_codes')
      .select('method_key, display_name, category')
      .eq('category', 'bank')
      .order('display_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Error loading bank list:', error);
          return;
        }
        setBankOptions((data || []) as PayoutBankOption[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadShop = useCallback(async () => {
    if (!effectiveShopId) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('shops')
        .select('*')
        .eq('id', effectiveShopId)
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
        payout_bank_name: data.payout_bank_name || '',
        payout_account_name: data.payout_account_name || '',
        is_active: data.is_active ?? true,
        maps_link: data.maps_link || '',
        public_email: data.public_email || '',
        public_phone: data.public_phone || '',
        opening_hours: parseOpeningHours(data.opening_hours) ?? {},
      });
    } catch (error: any) {
      console.error('Error loading shop:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, [effectiveShopId]);

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

    if (formData.payout_method === 'bank' && !formData.payout_bank_name) {
      toast.error('Please select a bank for bank account payouts.');
      return false;
    }

    // Mirrors the shops_maps_link_check constraint. Without this the save fails
    // in Postgres and the merchant sees a raw constraint violation instead of
    // being told what is wrong with their link.
    if (formData.maps_link.trim() && !isValidMapsLink(formData.maps_link)) {
      toast.error('Enter a full Google Maps link starting with https:// (e.g. https://maps.app.goo.gl/…).');
      return false;
    }

    // A cleared time input yields '', which is_valid_opening_hours rejects.
    // Catch it here so the merchant is told which day is wrong.
    const incompleteDay = Object.entries(formData.opening_hours).find(
      ([, spec]) => !isValidTime(spec?.open) || !isValidTime(spec?.close)
    );
    if (incompleteDay) {
      toast.error('Every open day needs both an opening and a closing time.');
      return false;
    }

    if (!user?.id) {
      toast.error('Session expired. Please log in again.');
      return false;
    }

    if (isMerchant && !effectiveShopId) {
      toast.error('Could not find your shop. Please refresh and try again.');
      return false;
    }

    setLoading(true);
    try {
      setUploading(true);
      const logoUrl = await uploadPublicAsset(imageFile, formData.logo_url, 'shop-logos');
      const coverUrl = await uploadPublicAsset(coverImageFile, formData.cover_image_url, 'shop-covers');
      setUploading(false);

      // Merchants never get RLS access to shops directly (see
      // 20260729040000_shop_self_service_rpc.sql) -- is_active and every
      // other governance field stay admin-only by not being parameters this
      // RPC accepts at all, not by relying on the client to behave.
      if (isMerchant) {
        const { error } = await supabase.rpc('update_shop_profile', {
          p_shop_id: effectiveShopId,
          p_name: formData.name,
          p_location: formData.location,
          p_address: formData.address,
          p_logo_url: logoUrl,
          p_cover_image_url: coverUrl,
          p_payout_method: formData.payout_method,
          p_payout_details: formData.payout_details,
          p_payout_bank_name: formData.payout_method === 'bank' ? formData.payout_bank_name : null,
          p_payout_account_name: formData.payout_account_name,
          // The RPC reads '' as "clear this field" and NULL as "leave it
          // alone", so a merchant can actually remove a stale phone number.
          p_maps_link: formData.maps_link.trim(),
          p_public_email: formData.public_email.trim(),
          p_public_phone: formData.public_phone.trim(),
          p_opening_hours: formData.opening_hours,
        });

        if (error) throw error;
        toast.success('Shop updated successfully');
        return true;
      }

      // owner_id is what shop settlement/withdrawals actually pay out
      // against (see resolve_shop_merchant_user_id) — it must only ever be
      // set once, when a shop is first created, never touched on an edit.
      // This payload used to include owner_id: user.id unconditionally,
      // which meant any admin editing any existing shop silently
      // reassigned that shop's real financial ownership to themselves.
      const shopPayload = {
        name: formData.name,
        location: formData.location,
        address: formData.address,
        logo_url: logoUrl,
        cover_image_url: coverUrl,
        payout_method: formData.payout_method,
        payout_details: formData.payout_details,
        payout_bank_name: formData.payout_method === 'bank' ? formData.payout_bank_name : null,
        payout_account_name: formData.payout_account_name,
        is_active: formData.is_active,
        maps_link: formData.maps_link.trim() || null,
        public_email: formData.public_email.trim().toLowerCase() || null,
        public_phone: formData.public_phone.trim() || null,
        opening_hours:
          Object.keys(formData.opening_hours).length > 0 ? formData.opening_hours : null,
      };

      if (isEditing && shopId) {
        const { error } = await supabase
          .from('shops')
          .update(shopPayload)
          .eq('id', shopId);

        if (error) throw error;
        toast.success('Shop updated successfully');
      } else {
        // This branch is admin-only now (merchants return via the RPC branch
        // above and never reach here). It used to also insert the creating
        // admin into merchant_shops -- which, since resolve_shop_merchant_user_id
        // picks the earliest merchant_shops row for a shop, meant a shop
        // admin-created-then-later-staffed via create-merchant would still
        // resolve to the admin for settlement/withdrawals, defeating that
        // fix. A freshly admin-created shop has no merchant yet; it stays
        // that way (safely -- see resolve_shop_merchant_user_id's callers)
        // until create-merchant or register_merchant_shop assigns one.
        const { error } = await supabase
          .from('shops')
          .insert([{ ...shopPayload, owner_id: user.id }]);

        if (error) throw error;

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
  }, [formData, isEditing, isMerchant, effectiveShopId, shopId, user?.id]);

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
    bankOptions,
    isEditing,
    saveShop,
    deleteShop,
    /** Resolved shop id — a merchant's route carries no :shopId param. */
    effectiveShopId,
  };
}
