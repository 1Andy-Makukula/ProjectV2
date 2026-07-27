export interface Shop {
  id: string;
  name: string;
  description: string;
  location: string;
  image_url: string;
  logo_url?: string;
  cover_image_url?: string;
  is_active: boolean;
  item_count?: number;
  payout_method?: string | null;
  payout_details?: any;
  created_at?: string;

  /** What the shop declared at onboarding — gates the item types it can list. */
  offers_products?: boolean;
  offers_services?: boolean;

  /** KYC verification, captured during merchant onboarding. */
  physical_address?: string | null;
  nrc_url?: string | null;
  pacra_url?: string | null;
  verification_status?: 'pending' | 'approved' | 'rejected';
  verification_tier?: string | null;
  rejection_reason?: string | null;
  verification_reviewed_by?: string | null;
  verification_reviewed_at?: string | null;

  /** Joined from `users` when the admin list loads owner details. */
  owner?: { name?: string | null; email?: string | null; phone?: string | null } | null;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  price_zmw: number;
  image_url: string;
  is_available: boolean;
  shop_id?: string;
  created_at?: string;
}

export interface ShopBasic {
  id: string;
  name: string;
}
