export type StatusFilter = 'all' | 'pending_payment' | 'paid' | 'fulfilled' | 'expired' | 'cancelled';

export interface Order {
  transaction_id: string;
  tx_status: string;
  total_amount: number;
  gateway_tx_ref: string | null;
  created_at: string;

  shop_order_id: string | null;
  claim_code: string | null;
  claim_status: string | null;

  item_name: string | null;
  item_image_url: string | null;
  shop_name: string | null;
  sender_name: string | null;
  recipient_name: string | null;
  amount: number;
  status: StatusFilter;
  fulfilled_at: string | null;
}

export interface OrderDetail {
  transaction_id: string;
  tx_status: string;
  total_amount: number;
  gateway_tx_ref: string | null;
  origin_type: string;
  created_at: string;
  updated_at: string | null;

  shop_order_id: string | null;
  claim_code: string | null;
  claim_status: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  message: string | null;
  shop_order_updated_at: string | null;

  item_id: string | null;
  item_name: string | null;
  item_description: string | null;
  item_image_url: string | null;
  item_price: number | null;

  shop_id: string | null;
  shop_name: string | null;
  shop_location: string | null;
  shop_address: string | null;

  buyer_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;

  derived_status: string;
}
export interface OrderItem {
  order_item_id: string;
  item_id: string;
  allocated_price: number;
  item_name: string;
  item_image_url: string | null;
}

export interface ShopOrder {
  shop_order_id: string;
  shop_id: string;
  claim_code: string;
  subtotal: number;
  claim_status: string;
}

export interface Stats {
  totalOrders: number;
  totalValue: number;
  ordersThisWeek: number;
  valueThisWeek: number;
  totalCommission: number;
  commissionThisWeek: number;
  totalShops: number;
  totalUsers: number;
  fulfilledOrders: number;
  pendingOrders: number;
  expiredOrders: number;
}

export interface RecentOrder {
  id: string;
  code: string;
  item_name: string;
  shop_name: string;
  sender_name: string;
  recipient_name: string;
  amount: number;
  status: string;
  created_at: string;
}

