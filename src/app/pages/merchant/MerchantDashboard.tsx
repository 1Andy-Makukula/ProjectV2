import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { formatCurrency } from '../../../utils/currency';
import { QrCode, LogOut, Package, TrendingUp, Camera, Save } from 'lucide-react';
import { motion } from 'motion/react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Order {
  id: string;
  code: string;
  recipient_name: string;
  amount: number;
  paid_at: string | null;
  fulfilled_at: string | null;
  item: {
    name: string;
    image_url: string | null;
  } | null;
}

interface Analytics {
  totalFulfilled: number;
  totalValue: number;
  weekFulfilled: number;
  weekValue: number;
}

// ---------------------------------------------------------------------------
// ShopProfileCard sub-component
// ---------------------------------------------------------------------------

interface ShopProfileCardProps {
  profileName: string;
  profileLocation: string;
  profileImageUrl: string | null;
  profileSaving: boolean;
  profileSaved: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onNameChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
}

function ShopProfileCard({
  profileName,
  profileLocation,
  profileImageUrl,
  profileSaving,
  profileSaved,
  fileInputRef,
  onNameChange,
  onLocationChange,
  onImageChange,
  onSave,
}: ShopProfileCardProps) {
  const saveLabel = profileSaving ? 'Saving...' : profileSaved ? 'Saved' : 'Save Profile';

  return (
    <Card className="rounded-2xl border border-gray-100 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Shop Profile Settings</CardTitle>
        <CardDescription>Update your storefront name, location, and logo.</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col sm:flex-row gap-6 items-start">

          {/* Logo upload — 96px square with group-hover overlay */}
          <div
            className="group relative aspect-square w-24 shrink-0 rounded-2xl overflow-hidden bg-gray-100 cursor-pointer border border-gray-200"
            onClick={() => fileInputRef.current?.click()}
          >
            {profileImageUrl ? (
              <img
                src={profileImageUrl}
                alt="Shop logo"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex w-full h-full items-center justify-center">
                <Camera className="w-8 h-8 text-gray-400" />
              </div>
            )}

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-1">
              <Camera className="w-5 h-5 text-white" />
              <span className="text-white text-xs font-medium">Change Logo</span>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onImageChange}
            />
          </div>

          {/* Form fields */}
          <div className="flex-1 space-y-4 w-full">
            <div className="space-y-1.5">
              <Label htmlFor="shop-name">Shop Name</Label>
              <Input
                id="shop-name"
                value={profileName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Your shop name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="shop-location">Physical Location</Label>
              <Input
                id="shop-location"
                value={profileLocation}
                onChange={(e) => onLocationChange(e.target.value)}
                placeholder="e.g. Cairo Road, Lusaka"
              />
            </div>
          </div>
        </div>

        {/* Save action */}
        <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
          <Button
            id="save-profile-btn"
            onClick={onSave}
            disabled={profileSaving}
            className="bg-gradient-to-r from-primary to-primary-light text-white"
          >
            {saveLabel}
            <Save className="ml-2 w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MerchantDashboard() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  // Existing state
  const [shopName, setShopName] = useState('');
  const [shopId, setShopId] = useState<string | null>(null);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [fulfilledOrders, setFulfilledOrders] = useState<Order[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    totalFulfilled: 0,
    totalValue: 0,
    weekFulfilled: 0,
    weekValue: 0,
  });
  const [loading, setLoading] = useState(true);

  // Profile editor state
  const [profileName, setProfileName] = useState('');
  const [profileLocation, setProfileLocation] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMerchantData();
  }, [profile?.id]);

  useEffect(() => {
    if (shopId) {
      const subscription = supabase
        .channel(`shop:${shopId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'orders',
            filter: `shop_id=eq.${shopId}`,
          },
          () => {
            fetchOrders(shopId);
            fetchAnalytics(shopId);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `shop_id=eq.${shopId}`,
          },
          () => {
            fetchOrders(shopId);
            fetchAnalytics(shopId);
          }
        )
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [shopId]);

  const fetchMerchantData = async () => {
    if (!profile?.id) return;

    try {
      const { data: merchantShop, error: shopError } = await supabase
        .from('merchant_shops')
        .select('shop_id, shop:shops(id, name, location, image_url)')
        .eq('user_id', profile.id)
        .single();

      if (shopError) throw shopError;

      const shop = merchantShop.shop as any;
      const currentShopId = merchantShop.shop_id;

      setShopId(currentShopId);
      setShopName(shop?.name ?? 'Your Shop');

      // Seed profile editor fields
      setProfileName(shop?.name ?? '');
      setProfileLocation(shop?.location ?? '');
      setProfileImageUrl(shop?.image_url ?? null);

      await fetchOrders(currentShopId);
      await fetchAnalytics(currentShopId);
    } catch (error) {
      console.error('Error fetching merchant data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async (currentShopId: string) => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, items(name, image_url)')
        .eq('shop_id', currentShopId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const normalizedOrders = ((data || []) as any[]).map((order) => ({
        ...order,
        item: order.items ?? null,
      }));

      const active = normalizedOrders.filter((o) => o.status === 'paid');
      const fulfilled = normalizedOrders.filter((o) => o.status === 'fulfilled');

      setActiveOrders(active as unknown as Order[]);
      setFulfilledOrders(fulfilled as unknown as Order[]);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const fetchAnalytics = async (currentShopId: string) => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('amount, fulfilled_at, status')
        .eq('shop_id', currentShopId)
        .eq('status', 'fulfilled');

      if (error) throw error;

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const totalFulfilled = data?.length || 0;
      const totalValue = data?.reduce((sum: number, o: any) => sum + o.amount, 0) || 0;

      const weekOrders = data?.filter(
        (o: any) => o.fulfilled_at && new Date(o.fulfilled_at) >= oneWeekAgo
      );
      const weekFulfilled = weekOrders?.length || 0;
      const weekValue = weekOrders?.reduce((sum: number, o: any) => sum + o.amount, 0) || 0;

      setAnalytics({ totalFulfilled, totalValue, weekFulfilled, weekValue });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  const handleFulfillOrder = async (_orderId: string) => {
    navigate('/merchant/fulfill');
  };

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault(); // 1. STOPS the annoying page refresh!
    
    try {
      // 2. Tell the data center to destroy the token
      await supabase.auth.signOut(); 
      
      // 3. Clear any leftover zombie data in the browser
      localStorage.clear(); 
      sessionStorage.clear();
      
      // 4. Safely redirect to the login page
      navigate('/login', { replace: true }); 
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Profile save — persists name and location; image upload is scaffolded below
  const handleSaveProfile = async () => {
    if (!shopId) return;
    setProfileSaving(true);

    const { error } = await supabase
      .from('shops')
      .update({ name: profileName, location: profileLocation })
      .eq('id', shopId);

    if (!error) {
      setShopName(profileName); // keep header in sync
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } else {
      console.error('Error saving profile:', error);
    }

    setProfileSaving(false);
  };

  // Local image preview — TODO: upload to Supabase Storage when bucket is configured
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProfileImageUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{shopName}</h1>
            <p className="text-sm text-muted-foreground">Merchant Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate('/merchant/fulfill')}
              className="bg-gradient-to-r from-primary to-primary-light"
            >
              <QrCode className="w-4 h-4 mr-2" />
              Redeem Gift
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Analytics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Fulfilled', value: analytics.totalFulfilled, icon: Package, isCurrency: false },
            { label: 'Total Value',     value: analytics.totalValue,     icon: TrendingUp, isCurrency: true },
            { label: 'This Week',       value: analytics.weekFulfilled,  icon: Package, isCurrency: false },
            { label: 'Week Value',      value: analytics.weekValue,      icon: TrendingUp, isCurrency: true },
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white p-6 rounded-xl shadow-sm"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                  <stat.icon className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-2xl font-bold">
                <AnimatedMetric value={stat.value} isCurrency={stat.isCurrency} />
              </p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Tabs — 3 columns: Active Orders | Fulfilled | Shop Profile */}
        <Tabs defaultValue="active" className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="active">Active Orders</TabsTrigger>
            <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
            <TabsTrigger value="profile">Shop Profile</TabsTrigger>
          </TabsList>

          {/* Active Orders */}
          <TabsContent value="active" className="space-y-4">
            {activeOrders.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border">
                <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No Active Orders</h3>
                <p className="text-muted-foreground">
                  New paid orders will appear here automatically
                </p>
              </div>
            ) : (
              activeOrders.map((order) => (
                <div key={order.id} className="bg-white p-6 rounded-xl shadow-sm border">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                        {order.item?.image_url ? (
                          <img
                            src={order.item.image_url}
                            alt={order.item.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Package className="h-8 w-8 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div>
                      <h3 className="font-semibold text-lg">{order.item?.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          For: {order.recipient_name}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">{order.code}</p>
                      <p className="text-xs text-muted-foreground">Order Code</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {order.paid_at &&
                        `Paid ${new Date(order.paid_at).toLocaleDateString()}`}
                    </p>
                    <Button
                      onClick={() => handleFulfillOrder(order.id)}
                      size="sm"
                      className="bg-gradient-to-r from-primary to-primary-light"
                    >
                      Fulfill This Order
                    </Button>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          {/* Fulfilled */}
          <TabsContent value="fulfilled" className="space-y-4">
            {fulfilledOrders.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border">
                <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No fulfilled orders yet</p>
              </div>
            ) : (
              fulfilledOrders.map((order) => (
                <div key={order.id} className="bg-white p-6 rounded-xl shadow-sm border">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                        {order.item?.image_url ? (
                          <img
                            src={order.item.image_url}
                            alt={order.item.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Package className="h-8 w-8 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div>
                      <h3 className="font-medium">{order.item?.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {order.recipient_name}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(order.amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.fulfilled_at &&
                          new Date(order.fulfilled_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          {/* Shop Profile Editor */}
          <TabsContent value="profile">
            <ShopProfileCard
              profileName={profileName}
              profileLocation={profileLocation}
              profileImageUrl={profileImageUrl}
              profileSaving={profileSaving}
              profileSaved={profileSaved}
              fileInputRef={fileInputRef}
              onNameChange={setProfileName}
              onLocationChange={setProfileLocation}
              onImageChange={handleImageChange}
              onSave={handleSaveProfile}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnimatedMetric — unchanged from original
// ---------------------------------------------------------------------------

function AnimatedMetric({
  value,
  isCurrency,
}: {
  value: number;
  isCurrency: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let frameId = 0;
    const duration = 900;
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * easedProgress));

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    setDisplayValue(0);
    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return isCurrency ? formatCurrency(displayValue) : displayValue.toLocaleString();
}
