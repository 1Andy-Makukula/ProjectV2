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
