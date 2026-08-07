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
  payout_bank_name?: string | null;
  payout_account_name?: string | null;
  created_at?: string;

  /** What the shop declared at onboarding — gates the item types it can list. */
  offers_products?: boolean;
  offers_services?: boolean;

  /** KithLy Rating aggregate. Only buyers who collected an order can add to it. */
  rating_count?: number | null;
  rating_sum?: number | null;

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

/**
 * Mean KithLy Rating for a shop, or null when nobody has rated it yet.
 *
 * Null must render as nothing rather than as zero: a new shop has not been
 * judged badly, it has not been judged at all, and the verified badge plus
 * fulfilment count already speak for it.
 */
export function shopRating(
  shop: Pick<Shop, 'rating_count' | 'rating_sum'>,
): number | null {
  if (!shop.rating_count || !shop.rating_sum) return null;
  return Math.round((shop.rating_sum / shop.rating_count) * 10) / 10;
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
