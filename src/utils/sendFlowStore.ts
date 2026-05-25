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
// Grouped Cart Payload — for checkout-init Edge Function
// ---------------------------------------------------------------------------

export interface VendorGroup {
  shop_id: string;
  subtotal: number;
  item_ids: string[];
}

export interface GroupedCartPayload {
  total_amount: number;
  vendors: VendorGroup[];
  // Optional recipient fields — written to shop_orders by checkout-init
  recipient_name?: string;
  recipient_phone?: string;
  message?: string;
}

/**
 * getGroupedCartPayload
 *
 * Transforms a flat array of CartItems (from useCart) into the grouped
 * vendor payload expected by the `checkout-init` Edge Function.
 *
 * Groups items by shop_id and computes both per-vendor subtotals and
 * the overall total_amount in ZMW.
 *
 * Optionally merges recipient details (from useSendFlowStore) into the payload
 * so checkout-init can write them to every shop_orders row it creates.
 *
 * @example
 * const recipient = useSendFlowStore.getState().recipient;
 * const payload = getGroupedCartPayload(useCart.getState().items, recipient ?? undefined);
 */
export function getGroupedCartPayload(
  items: CartItem[],
  recipient?: RecipientDetails,
): GroupedCartPayload {
  const vendorMap = new Map<string, { subtotal: number; item_ids: string[] }>();

  for (const { product, quantity } of items) {
    const existing = vendorMap.get(product.shop_id);
    const lineTotal = product.price_zmw * quantity;
    // Expand item_ids by quantity (one entry per unit, matching backend ledger)
    const ids = Array.from({ length: quantity }, () => product.id);

    if (existing) {
      existing.subtotal += lineTotal;
      existing.item_ids.push(...ids);
    } else {
      vendorMap.set(product.shop_id, { subtotal: lineTotal, item_ids: ids });
    }
  }

  const vendors: VendorGroup[] = Array.from(vendorMap.entries()).map(
    ([shop_id, { subtotal, item_ids }]) => ({ shop_id, subtotal, item_ids }),
  );

  const total_amount = vendors.reduce((sum, v) => sum + v.subtotal, 0);

  return {
    total_amount,
    vendors,
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
