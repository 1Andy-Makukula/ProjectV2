// KithLy Type System - The "Bible" in Code

export type UserRole = 'customer' | 'merchant' | 'admin';
export type TransactionStatus = 'pending' | 'in_escrow' | 'completed' | 'disputed' | 'cancelled';
export type HandshakeMethod = 'manual' | 'qr';
export type ShopStatus = 'pending' | 'active' | 'suspended';
export type ProductCategory = 'food' | 'electronics' | 'fashion' | 'home' | 'gifts' | 'other';

export interface District {
  id: string;
  name: string;
  province: string;
}

export interface User {
  id: string;
  email: string;
  phone: string;
  full_name: string;
  role: UserRole;
  profile?: UserProfile;
  created_at: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  nrc_number?: string;
  tpin?: string;
  district_id: string;
  district?: District;
  momo_number?: string;
  is_verified: boolean;
  profile_complete: boolean;
  avatar_url?: string;
}

export interface Shop {
  id: string;
  owner_id: string;
  business_name: string;
  description?: string;
  tpin: string;
  district_id: string;
  district?: District;
  logo_url?: string;
  banner_url?: string;
  rating: number;
  total_transactions: number;
  success_rate: number;
  status: ShopStatus;
  created_at: string;
}

export interface Product {
  id: string;
  shop_id: string;
  shop?: Shop;
  title: string;
  description: string;
  price_zmw: number;
  stock_count: number;
  category: ProductCategory;
  images: string[];
  featured: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  buyer_id: string;
  buyer?: User;
  product_id: string;
  product?: Product;
  shop_id: string;
  shop?: Shop;
  amount_zmw: number;
  status: TransactionStatus;
  claim_code: string;
  expires_at: string;
  completed_at?: string;
  created_at: string;
}

export interface HandshakeLog {
  id: string;
  transaction_id: string;
  transaction?: Transaction;
  method: HandshakeMethod;
  verified_by?: string;
  timestamp: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  priority: 'low' | 'medium' | 'high';
  created_at: string;
}

export interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  image_url: string;
  cta_text: string;
  cta_link: string;
  shop_id?: string;
}
