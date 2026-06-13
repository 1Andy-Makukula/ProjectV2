import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../utils/auth/AuthContext';
import { parseAuthError } from '../../utils/errorParser';

export interface Banner {
  id: string;
  image_url: string;
  title: string;
}

export interface Shop {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  image_url: string | null;
  itemCount: number;
}

export interface Category {
  id: string;
  name: string;
  is_featured: boolean;
}

const FALLBACK_BANNERS: Banner[] = [
  {
    id: 'fallback-1',
    image_url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&w=1400&q=80',
    title: 'Send a gift that actually means something.',
  },
  {
    id: 'fallback-2',
    image_url: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&w=1400&q=80',
    title: 'Discover local shops crafting unforgettable moments.',
  },
  {
    id: 'fallback-3',
    image_url: 'https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&w=1400&q=80',
    title: 'Every order tells a story worth sharing.',
  },
];

export function useHome() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [campaigns, setCampaigns] = useState<Banner[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBanners = async () => {
    try {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .select('id, image_url, title')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setCampaigns(data);
      } else {
        setCampaigns(FALLBACK_BANNERS);
      }
    } catch (err: any) {
      console.error('[useHome] fetchBanners error:', err);
      setCampaigns(FALLBACK_BANNERS);
      setError(parseAuthError(err).message);
    } finally {
      setCampaignsLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, is_featured')
        .order('name');

      if (error) {
        // Categories table might be missing or empty in some environments; fail gracefully
        if (error.code !== '42P01') {
          throw error;
        }
      }
      setCategories((data as Category[]) ?? []);
    } catch (err: any) {
      console.error('[useHome] fetchCategories error:', err);
      setError(parseAuthError(err).message);
    } finally {
      setCategoriesLoading(false);
    }
  };

  const fetchShops = async () => {
    try {
      const { data, error } = await supabase
        .from('shops')
        .select(`
          id,
          name,
          description,
          location,
          image_url,
          items:items(count)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const shopsWithCounts = (data ?? []).map((shop: any) => ({
        id: shop.id,
        name: shop.name,
        description: shop.description,
        location: shop.location,
        image_url: shop.image_url,
        itemCount: shop.items?.[0]?.count ?? 0,
      }));

      setShops(shopsWithCounts);
    } catch (err: any) {
      console.error('[useHome] fetchShops error:', err);
      setShops([]);
      setError(parseAuthError(err).message);
    } finally {
      setShopsLoading(false);
    }
  };

  const fetchNotifications = async () => {
    const activeUserId = user?.id || profile?.id;
    if (!activeUserId) return;

    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          transaction_id,
          created_at,
          shop_orders!inner (
            shop_order_id,
            claim_code,
            recipient_name,
            fulfilled_at,
            shop:shop_id (name),
            order_items (
              item:item_id (name)
            )
          )
        `)
        .eq('buyer_id', activeUserId)
        .in('shop_orders.claim_status', ['FULFILLED', 'PARTIAL_FULFILLMENT'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (data) {
        const formatted = data.flatMap((tx: any) =>
          tx.shop_orders.map((so: any) => ({
            id: so.shop_order_id,
            code: so.claim_code,
            recipient_name: so.recipient_name,
            fulfilled_at: so.fulfilled_at || tx.created_at,
            item: { name: so.order_items?.[0]?.item?.name || 'Gift' },
            shop: { name: so.shop?.name || 'Shop' }
          }))
        );
        setNotifications(formatted);
      }
    } catch (err: any) {
      console.error('[useHome] fetchNotifications error:', err);
    }
  };

  useEffect(() => {
    const activeUserId = user?.id || profile?.id;
    if (!activeUserId) return;

    fetchBanners();
    fetchCategories();
    fetchShops();
    fetchNotifications();

    const channel = supabase.channel('realtime-sender-notifications')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `buyer_id=eq.${activeUserId}`
      }, () => {
        fetchNotifications();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transaction_events',
        filter: `event_type=eq.CLAIM_VERIFIED`
      }, () => {
        fetchNotifications();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, user?.id]);

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      setIsSigningOut(true);
      await supabase.auth.signOut();
      localStorage.clear();
      sessionStorage.clear();
      navigate('/login', { replace: true });
    } catch (err: any) {
      console.error('[useHome] Logout failed:', err);
    } finally {
      setIsSigningOut(false);
    }
  };

  return {
    campaigns,
    categories,
    shops,
    notifications,
    bannersLoading: campaignsLoading,
    shopsLoading,
    error,
    isSigningOut,
    handleLogout,
  };
}
