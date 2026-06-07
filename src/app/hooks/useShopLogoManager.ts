import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { uploadPublicAsset } from '../../utils/uploadImage';
import { toast } from 'sonner';

export interface ShopRow {
  id: string;
  name: string;
  logo_url: string | null;
}

export function useShopLogoManager() {
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('shops')
        .select('id, name, logo_url')
        .order('name');
      if (error) throw error;
      setShops((data as ShopRow[]) ?? []);
    } catch (err: any) {
      console.error('Failed to load shops:', err);
      toast.error('Failed to load shops');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUpload = async (shop: ShopRow, file: File) => {
    setUploading(shop.id);
    try {
      const url = await uploadPublicAsset(file, '', 'shop-logos');
      const { error } = await supabase
        .from('shops')
        .update({ logo_url: url })
        .eq('id', shop.id);
      if (error) throw error;
      setShops(prev => prev.map(s => s.id === shop.id ? { ...s, logo_url: url } : s));
      toast.success(`Logo updated for ${shop.name}`);
    } catch (err: any) {
      toast.error(err.message ?? 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const clearLogo = async (shop: ShopRow) => {
    if (!confirm(`Remove logo for ${shop.name}?`)) return;
    try {
      const { error } = await supabase
        .from('shops')
        .update({ logo_url: null })
        .eq('id', shop.id);
      if (error) throw error;
      setShops(prev => prev.map(s => s.id === shop.id ? { ...s, logo_url: null } : s));
      toast.success('Logo removed');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to remove logo');
    }
  };

  return {
    shops,
    loading,
    uploading,
    handleUpload,
    clearLogo,
    reload: load,
  };
}
