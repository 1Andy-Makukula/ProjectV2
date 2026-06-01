import { create } from 'zustand';
import type { CartItem } from '../app/types';

// ---------------------------------------------------------------------------
// Recipient Details — passed through the checkout pipeline to shop_orders
// ---------------------------------------------------------------------------

export interface RecipientDetails {
  name: string;
  phone: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Flat Cart Payload — for checkout-init Edge Function
// ---------------------------------------------------------------------------

export interface CartItemPayload {
  item_id: string;
  quantity: number;
  shop_id: string;
}

export interface FlatCartPayload {
  cart_items: CartItemPayload[];
  // Optional recipient fields — written to shop_orders by checkout-init
  recipient_name?: string;
  recipient_phone?: string;
  message?: string;
}

/**
 * getFlatCartPayload
 *
 * Transforms a flat array of CartItems (from useCart) into the flat
 * payload expected by the `checkout-init` Edge Function.
 *
 * Optionally merges recipient details (from useSendFlowStore) into the payload
 * so checkout-init can write them to every shop_orders row it creates.
 *
 * @example
 * const recipient = useSendFlowStore.getState().recipient;
 * const payload = getFlatCartPayload(useCart.getState().items, recipient ?? undefined);
 */
export function getFlatCartPayload(
  items: CartItem[],
  recipient?: RecipientDetails,
): FlatCartPayload {
  const cart_items: CartItemPayload[] = items.map(({ product, quantity }) => ({
    item_id: product.id,
    quantity,
    shop_id: product.shop_id,
  }));

  return {
    cart_items,
    ...(recipient?.name      && { recipient_name:  recipient.name }),
    ...(recipient?.phone     && { recipient_phone: recipient.phone }),
    ...(recipient?.message   && { message:          recipient.message }),
  };
}

// ---------------------------------------------------------------------------
// SendFlow Zustand Store
// ---------------------------------------------------------------------------

interface Item {
  id: string;
  name: string;
  price: number;
  currency: string;
  image_url: string | null;
  shop_id: string;
  shop_name: string;
}

interface SendFlowState {
  item: Item | null;
  recipient: RecipientDetails | null;
  setItem: (item: Item) => void;
  setRecipient: (recipient: RecipientDetails) => void;
  reset: () => void;
}

export const useSendFlowStore = create<SendFlowState>((set) => ({
  item: null,
  recipient: null,
  setItem: (item) => set({ item }),
  setRecipient: (recipient) => set({ recipient }),
  reset: () => set({ item: null, recipient: null }),
}));
