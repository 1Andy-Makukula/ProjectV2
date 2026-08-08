import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { uploadItemImage, deleteStorefrontAsset } from '../../utils/uploadImage';
import {
  MAX_ITEM_IMAGES,
  canAddImages,
  planGalleryWrite,
  reorderGallery,
  type GalleryEntry,
  type StoredImage,
} from '../../utils/itemGallery';
import { toCents } from '../../utils/currency';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { ineffectiveTiers } from '../types/items';
import type { FulfillmentLocation, ItemType, PriceTier } from '../types/items';

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
  price_is_minimum: boolean;

  has_expiry: boolean;
  valid_for_days: string;

  is_discounted: boolean;
  original_price: string;

  is_wholesale: boolean;
  wholesale_price: string;
  minimum_order_quantity: string;

  /** '' leaves stock untracked, which is the default and means unlimited. */
  stock_quantity: string;

  /** Quantity breaks, prices in ZMW; converted to ngwee on save. */
  price_tiers: PriceTier[];
}

export interface CategoryOption {
  id: string;
  name: string;
}

/** What the owning shop declared at onboarding. */
export interface ShopOfferings {
  offers_products: boolean;
  offers_services: boolean;
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
  price_is_minimum: false,

  has_expiry: true,
  valid_for_days: '',

  is_discounted: false,
  original_price: '',

  is_wholesale: false,
  wholesale_price: '',
  minimum_order_quantity: '1',

  stock_quantity: '',
  price_tiers: [],
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
  // Permissive until the shop's own answer loads, so a slow or failed lookup
  // never hides an option the merchant is entitled to.
  const [shopOfferings, setShopOfferings] = useState<ShopOfferings>({
    offers_products: true,
    offers_services: true,
  });
  const [actualShopId, setActualShopId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // The gallery the merchant is editing, and what was on the row when it
  // loaded — the difference between the two is what gets written on save.
  const [gallery, setGallery] = useState<GalleryEntry[]>([]);
  const [storedImages, setStoredImages] = useState<StoredImage[]>([]);

  const addGalleryFiles = useCallback((files: File[]) => {
    setGallery((current) => {
      if (!canAddImages(current.length, files.length)) {
        toast.error(`An item can have at most ${MAX_ITEM_IMAGES} images.`);
        return current;
      }
      return [
        ...current,
        ...files.map((file) => ({ url: URL.createObjectURL(file), file })),
      ];
    });
  }, []);

  const removeGalleryAt = useCallback((index: number) => {
    setGallery((current) => {
      const entry = current[index];
      // Only local previews own their object URL; a stored image's URL is a
      // real file that save() decides the fate of.
      if (entry?.file) URL.revokeObjectURL(entry.url);
      return current.filter((_, i) => i !== index);
    });
  }, []);

  const moveGalleryImage = useCallback((from: number, to: number) => {
    setGallery((current) => reorderGallery(current, from, to));
  }, []);

  const loadGallery = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from('item_images')
      .select('id, image_url')
      .eq('item_id', id)
      .order('sort_order')
      .order('created_at');

    if (error) {
      console.error('Error loading item gallery:', error);
      return;
    }

    const rows: StoredImage[] = (data ?? []).map((row: any) => ({
      id: row.id,
      url: row.image_url,
    }));
    setStoredImages(rows);
    setGallery(rows.map((row) => ({ id: row.id, url: row.url })));
  }, []);

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

      const { data: tierRows } = await supabase
        .from('item_price_tiers')
        .select('min_quantity, unit_price_zmw')
        .eq('item_id', itemId)
        .order('min_quantity');

      await loadGallery(itemId);
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
        price_is_minimum: data.price_is_minimum ?? false,

        has_expiry: data.has_expiry ?? true,
        valid_for_days: data.valid_for_days != null ? String(data.valid_for_days) : '',

        is_discounted: data.is_discounted ?? false,
        original_price: fromNgwee(data.original_price_zmw),

        is_wholesale: data.is_wholesale ?? false,
        wholesale_price: fromNgwee(data.wholesale_price_zmw),
        minimum_order_quantity:
          data.minimum_order_quantity != null ? String(data.minimum_order_quantity) : '1',

        stock_quantity: data.stock_quantity != null ? String(data.stock_quantity) : '',

        // Stored in ngwee; the editor works in ZMW like every other price field.
        price_tiers: (tierRows ?? [])
          .map((tier: any) => ({
            min_quantity: tier.min_quantity,
            unit_price_zmw: tier.unit_price_zmw / 100,
          }))
          .sort((a, b) => a.min_quantity - b.min_quantity),
      });
    } catch (error: any) {
      console.error('Error loading item:', error);
      toast.error(parseAuthError(error));
    } finally {
      setLoading(false);
    }
  }, [itemId, loadGallery]);

  /**
   * Persists the edited gallery.
   *
   * Deletes run first: item_images_cap counts existing rows on INSERT, so
   * replacing a full gallery in the other order would trip the cap on the first
   * new row. items.image_url is left to the sync_item_cover trigger.
   */
  const writeGallery = useCallback(
    async (id: string, resolved: GalleryEntry[]) => {
      const plan = planGalleryWrite(storedImages, resolved);

      if (plan.removedIds.length > 0) {
        const { error } = await supabase
          .from('item_images')
          .delete()
          .in('id', plan.removedIds);
        if (error) throw error;
      }

      const inserts: Array<{ item_id: string; image_url: string; sort_order: number }> = [];
      for (let index = 0; index < resolved.length; index += 1) {
        const entry = resolved[index];
        if (entry.id) {
          const { error } = await supabase
            .from('item_images')
            .update({ sort_order: index })
            .eq('id', entry.id);
          if (error) throw error;
        } else {
          inserts.push({ item_id: id, image_url: entry.url, sort_order: index });
        }
      }

      if (inserts.length > 0) {
        const { error } = await supabase.from('item_images').insert(inserts);
        if (error) throw error;
      }

      // Best-effort: an orphaned file left behind costs storage, but failing
      // the save over it would be worse.
      for (const url of plan.orphanedUrls) {
        await deleteStorefrontAsset(url).catch(console.error);
      }

      await loadGallery(id);
    },
    [storedImages, loadGallery],
  );

  /**
   * Replaces an item's tiers wholesale.
   *
   * Delete-then-insert rather than a diff: there are at most a handful of rows,
   * they carry no identity worth preserving, and the unique index on
   * (item_id, min_quantity) makes an in-place edit that reorders thresholds
   * awkward to sequence.
   */
  const writeTiers = useCallback(async (id: string, tiers: PriceTier[]) => {
    const { error: deleteError } = await supabase
      .from('item_price_tiers')
      .delete()
      .eq('item_id', id);
    if (deleteError) throw deleteError;

    if (tiers.length === 0) return;

    const { error } = await supabase.from('item_price_tiers').insert(
      tiers.map((tier) => ({
        item_id: id,
        min_quantity: Math.round(tier.min_quantity),
        unit_price_zmw: toCents(tier.unit_price_zmw),
      })),
    );
    if (error) throw error;
  }, []);

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

  const loadShopOfferings = useCallback(
    async (shopIdToLoad: string) => {
      try {
        const { data, error } = await supabase
          .from('shops')
          .select('offers_products, offers_services')
          .eq('id', shopIdToLoad)
          .single();

        if (error) throw error;

        const offerings: ShopOfferings = {
          offers_products: data.offers_products ?? true,
          offers_services: data.offers_services ?? false,
        };
        setShopOfferings(offerings);

        // A services-only shop should start a new listing as a service rather
        // than making the merchant switch away from a default they can't use.
        if (!isEditing && !offerings.offers_products && offerings.offers_services) {
          setFormData((prev) => ({ ...prev, item_type: 'service' }));
        }
      } catch (err) {
        console.error('Error loading shop offerings:', err);
      }
    },
    [isEditing],
  );

  useEffect(() => {
    if (actualShopId) loadShopOfferings(actualShopId);
  }, [actualShopId, loadShopOfferings]);

  const saveItem = useCallback(async () => {
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

    // Blank means untracked, which is not the same as zero — zero is a real
    // "sold out right now" that greys the listing on the storefront.
    const stockQuantity = parseOptionalInt(formData.stock_quantity);
    if (formData.stock_quantity.trim() && (stockQuantity == null || stockQuantity < 0)) {
      toast.error('Stock cannot be negative. Leave it blank if you do not track stock.');
      return false;
    }

    // Mirrors item_price_tiers' constraints and validate_price_tier, so the
    // merchant gets a sentence rather than a raw constraint violation.
    for (const tier of formData.price_tiers) {
      if (!Number.isFinite(tier.min_quantity) || tier.min_quantity < 2) {
        toast.error('A bulk tier needs a minimum quantity of at least 2');
        return false;
      }
      if (!Number.isFinite(tier.unit_price_zmw) || tier.unit_price_zmw <= 0) {
        toast.error('Every bulk tier needs a price');
        return false;
      }
    }

    // Blocked, not warned. An accepted-but-inert tier still rendered on the
    // storefront and in the cart's next-tier nudge, so the buyer was shown bulk
    // pricing dearer than buying singly. Mirrors validate_price_tier.
    const inert = ineffectiveTiers(priceValue, formData.price_tiers);
    if (inert.length > 0) {
      toast.error(
        `Bulk price for ${inert[0].min_quantity}+ must be below your unit price. Enter the price of ONE unit at that quantity, not the total for the pack.`,
        { duration: 8000 },
      );
      return false;
    }

    if (
      new Set(formData.price_tiers.map((tier) => tier.min_quantity)).size !==
      formData.price_tiers.length
    ) {
      toast.error('Two bulk tiers cannot start at the same quantity');
      return false;
    }

    const isServiceItem = formData.item_type === 'service';

    setLoading(true);
    try {
      // Every pending file is uploaded before the item row is written, so the
      // row is never saved pointing at a cover that does not exist yet.
      let resolvedGallery: GalleryEntry[] = gallery;
      if (gallery.some((entry) => entry.file)) {
        if (!actualShopId) {
          throw new Error('Shop context is required before uploading an image.');
        }
        setUploading(true);
        resolvedGallery = [];
        for (const entry of gallery) {
          if (!entry.file) {
            resolvedGallery.push(entry);
            continue;
          }
          const { publicUrl } = await uploadItemImage(entry.file, actualShopId);
          URL.revokeObjectURL(entry.url);
          resolvedGallery.push({ url: publicUrl });
        }
        setGallery(resolvedGallery);
        setUploading(false);
      }

      // The gallery owns the cover. Falling back to the existing value keeps
      // items that predate the gallery working untouched.
      const imageUrl = resolvedGallery[0]?.url ?? formData.image_url;

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
        // items_price_is_minimum_check requires both a service and an open
        // quote route. Deriving it here rather than trusting the toggle means
        // switching an item back to a product cannot leave a row the database
        // will reject on the next save.
        price_is_minimum:
          isServiceItem && formData.allow_custom_quote ? formData.price_is_minimum : false,

        has_expiry: formData.has_expiry,
        valid_for_days: formData.has_expiry ? validForDays : null,

        is_discounted: formData.is_discounted,
        original_price_zmw:
          formData.is_discounted && originalPriceValue != null ? toCents(originalPriceValue) : null,

        is_wholesale: formData.is_wholesale,
        wholesale_price_zmw:
          formData.is_wholesale && wholesalePriceValue != null ? toCents(wholesalePriceValue) : null,
        minimum_order_quantity: formData.is_wholesale ? minimumOrderQuantity : 1,

        stock_quantity: stockQuantity,
      };

      let savedItemId = itemId;

      if (isEditing && itemId) {
        const { error } = await supabase
          .from('items')
          .update(itemPayload)
          .eq('id', itemId);

        if (error) throw error;
      } else {
        // The id comes back so a brand new item's gallery rows can be written
        // in the same save rather than needing a second trip through the form.
        const { data, error } = await supabase
          .from('items')
          .insert([itemPayload])
          .select('id')
          .single();

        if (error) throw error;
        savedItemId = data.id;
      }

      if (savedItemId) {
        await writeGallery(savedItemId, resolvedGallery);
        await writeTiers(savedItemId, formData.price_tiers);
      }

      toast.success(isEditing ? 'Item updated successfully' : 'Item created successfully');
      return true;
    } catch (error: any) {
      console.error('Error saving item:', error);
      toast.error(parseAuthError(error));
      return false;
    } finally {
      setLoading(false);
      setUploading(false);
    }
  }, [formData, isEditing, itemId, actualShopId, gallery, writeGallery, writeTiers]);

  const deleteItem = useCallback(async () => {
    if (!itemId) return false;

    setLoading(true);
    try {
      // The item_images rows cascade with the item, but their storage objects
      // do not — they have to be removed explicitly or they leak.
      const galleryUrls = storedImages.map((row) => row.url);
      const urls = new Set(
        [formData.image_url, ...galleryUrls].filter((url): url is string => Boolean(url)),
      );
      for (const url of urls) {
        await deleteStorefrontAsset(url).catch(console.error);
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
  }, [itemId, formData.image_url, storedImages]);

  return {
    formData,
    setFormData,
    categories,
    shopOfferings,
    actualShopId,
    loading,
    uploading,
    saveItem,
    deleteItem,
    gallery,
    addGalleryFiles,
    removeGalleryAt,
    moveGalleryImage,
  };
}
