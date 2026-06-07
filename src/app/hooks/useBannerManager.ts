import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { uploadPublicAsset } from '../../utils/uploadImage';
import { toast } from 'sonner';

export interface Banner {
  id: string;
  title: string;
  image_url: string;
  is_active: boolean;
  sort_order: number;
}

export function useBannerManager() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('banners')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      setBanners((data as Banner[]) ?? []);
    } catch (err: any) {
      console.error('Failed to load banners:', err);
      toast.error('Failed to load banners');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title.trim()) {
      toast.error('Title and image required');
      return;
    }
    setSaving(true);
    try {
      const url = await uploadPublicAsset(file, '', 'banners');
      const { error } = await supabase.from('banners').insert({
        title: title.trim(),
        image_url: url,
        is_active: true,
        sort_order: parseInt(sortOrder, 10) || 0,
      });
      if (error) throw error;
      toast.success('Banner added');
      setTitle('');
      setSortOrder('0');
      setFile(null);
      setPreview('');
      await load();
    } catch (err: any) {
      toast.error(err.message ?? 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (b: Banner) => {
    try {
      const { error } = await supabase
        .from('banners')
        .update({ is_active: !b.is_active })
        .eq('id', b.id);
      if (error) throw error;
      setBanners(prev => prev.map(x => x.id === b.id ? { ...x, is_active: !x.is_active } : x));
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update banner status');
    }
  };

  const deleteBanner = async (id: string) => {
    if (!confirm('Delete this banner?')) return;
    try {
      const { error } = await supabase.from('banners').delete().eq('id', id);
      if (error) throw error;
      setBanners(prev => prev.filter(x => x.id !== id));
      toast.success('Deleted');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to delete banner');
    }
  };

  return {
    banners,
    loading,
    saving,
    title,
    setTitle,
    sortOrder,
    setSortOrder,
    file,
    setFile,
    preview,
    setPreview,
    handleAdd,
    toggleActive,
    deleteBanner,
    reload: load,
  };
}
