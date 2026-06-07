import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { callServer } from '../../utils/server';
import { toast } from 'sonner';

export interface Merchant {
  id: string;
  name: string;
  email: string;
  phone?: string;
  created_at: string;
  shop_id?: string;
  shop_name?: string;
}

export interface Shop {
  id: string;
  name: string;
}

export function useAdminMerchants() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const { data: merchantsData, error: mErr } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'merchant')
        .order('created_at', { ascending: false });
      if (mErr) throw mErr;

      const { data: shopsData, error: sErr } = await supabase
        .from('shops')
        .select('id, name')
        .order('name');
      if (sErr) throw sErr;
      setShops(shopsData || []);

      const enriched = await Promise.all(
        (merchantsData || []).map(async (m) => {
          const { data: assign } = await supabase
            .from('merchant_shops')
            .select('shop_id, shop:shops(name)')
            .eq('user_id', m.id)
            .maybeSingle();

          const shopName =
            (assign?.shop as any)?.name ??
            (Array.isArray(assign?.shop) ? (assign.shop as any)[0]?.name : undefined) ??
            null;

          return {
            id: m.id,
            name: m.name,
            email: m.email,
            phone: m.phone ?? '',
            created_at: m.created_at,
            shop_id: assign?.shop_id ?? undefined,
            shop_name: shopName,
          } as Merchant;
        })
      );

      setMerchants(enriched);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load merchants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const createMerchant = useCallback(async (form: typeof createFormType) => {
    if (!form.name || !form.email || !form.password || !form.shopId) {
      toast.error('Please fill in all fields');
      return false;
    }
    setCreating(true);
    try {
      await callServer('/merchants', {
        body: {
          name: form.name,
          email: form.email,
          password: form.password,
          shopId: form.shopId,
        },
      });
      toast.success('Merchant account created');
      toast.info(`Temporary password: ${form.password}`, { duration: 10000 });
      await loadData();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Failed to create merchant');
      return false;
    } finally {
      setCreating(false);
    }
  }, [loadData]);

  const saveProfile = useCallback(async (merchantId: string, profile: { name: string; phone: string }) => {
    if (!profile.name.trim()) {
      toast.error('Name is required');
      return false;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ name: profile.name.trim(), phone: profile.phone.trim() || null })
        .eq('id', merchantId);
      if (error) throw error;
      toast.success('Profile updated');
      await loadData();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
      return false;
    } finally {
      setSaving(false);
    }
  }, [loadData]);

  const saveShopAssignment = useCallback(async (merchantId: string, shopId: string) => {
    setSaving(true);
    try {
      // Remove old assignment
      await supabase.from('merchant_shops').delete().eq('user_id', merchantId);

      if (shopId && shopId !== 'unassigned') {
        const { error } = await supabase
          .from('merchant_shops')
          .insert({ user_id: merchantId, shop_id: shopId });
        if (error) throw error;
      }

      toast.success('Shop assignment updated');
      await loadData();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Failed to update shop assignment');
      return false;
    } finally {
      setSaving(false);
    }
  }, [loadData]);

  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      toast.success(`Password reset email sent to ${email}`);
      return true;
    } catch (err: any) {
      toast.error('Failed to send reset email');
      return false;
    }
  }, []);

  const setNewPassword = useCallback(async (merchantId: string, password: string, email: string) => {
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return false;
    }
    setSaving(true);
    try {
      await callServer('/admin-reset-password', {
        body: { userId: merchantId, newPassword: password },
      });
      toast.success('Password updated');
      return true;
    } catch (err: any) {
      // Fallback: send email reset instead
      await sendPasswordReset(email);
      toast.info('Direct reset unavailable — sent email reset instead');
      return true;
    } finally {
      setSaving(false);
    }
  }, [sendPasswordReset]);

  const deleteMerchant = useCallback(async (merchantId: string, name: string) => {
    try {
      // Remove shop assignment first
      await supabase.from('merchant_shops').delete().eq('user_id', merchantId);
      // Downgrade role to sender (auth deletion requires Admin API)
      const { error } = await supabase
        .from('users')
        .update({ role: 'sender' })
        .eq('id', merchantId);
      if (error) throw error;
      toast.success(`${name} removed as merchant`);
      await loadData();
      return true;
    } catch (err: any) {
      toast.error('Failed to remove merchant');
      return false;
    }
  }, [loadData]);

  return {
    merchants,
    shops,
    loading,
    creating,
    saving,
    createMerchant,
    saveProfile,
    saveShopAssignment,
    sendPasswordReset,
    setNewPassword,
    deleteMerchant,
    reload: loadData,
  };
}

// Dummy helper type for typing creation payload
const createFormType = { name: '', email: '', password: '', shopId: '' };
