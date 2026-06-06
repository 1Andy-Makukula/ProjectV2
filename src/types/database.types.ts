/**
 * Centralized Supabase Database Types
 *
 * This file acts as the single source of truth for all mapped database entities
 * to prevent inline type fragmentation across React components.
 */

export interface LedgerEntry {
  id: string;
  amount: number;
  description: string | null;
  created_at: string;
}

export interface FloatingItem {
  order_item_id: string;
  created_at: string;
  child_claim_code: string;
  allocated_price: number;
  items: {
    name: string;
    image_url: string | null;
  } | null;
  shop_orders: {
    recipient_phone: string;
  };
}

export interface Transaction {
  transaction_id: string;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  created_at: string;
  users?: {
    name: string;
  };
}
