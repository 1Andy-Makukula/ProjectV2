// KithLy Cart Hook - Shopping Cart Management

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Product } from '../types';
import { unitPriceFor } from '../types/items';
import {
  selectionDelta,
  selectionSignature,
  type OptionSelection,
} from '../types/itemOptions';

/**
 * Identifies one configuration of a product in the cart.
 *
 * The cart used to merge purely on product id, which is right until options
 * exist: two of the same dish with different sides would have collapsed into
 * one line and the second choice been lost. An item with no options keeps its
 * bare id as the key, so carts already saved in localStorage keep working and
 * every existing call site that passes a product id still resolves.
 */
export function cartLineKey(productId: string, selection?: OptionSelection | null): string {
  const signature = selectionSignature(selection);
  return signature ? `${productId}#${signature}` : productId;
}

/** The key of a line already in the cart, tolerating lines saved before options. */
export function lineKeyOf(item: CartItem): string {
  return item.lineKey ?? cartLineKey(item.product.id, item.selection);
}

/**
 * What one unit of a cart line costs: the quantity-break price for the item,
 * plus whatever its chosen options add.
 *
 * checkout_init_atomic computes the same figure and its answer is the one
 * charged. This exists so the buyer is shown that number rather than a total
 * they will not be billed.
 */
export function cartLineUnitPrice(item: CartItem): number {
  const base = unitPriceFor(item.product.price_zmw, item.product.price_tiers, item.quantity);
  return base + selectionDelta(item.product.option_groups, item.selection ?? {});
}

/**
 * toProduct — converts a raw DB `items` row into the Product shape
 * expected by the cart store. Call this before addToCart().
 */
export function toProduct(item: any): Product {
  return {
    id: item.id,
    shop_id: item.shop_id,
    name: item.name ?? item.title ?? '',
    title: item.name ?? item.title ?? '',
    description: item.description ?? null,
    price_zmw: item.price_zmw ?? 0,
    image_url: item.image_url ?? null,
    images: item.image_url ? [item.image_url] : [],
    is_available: item.is_available ?? true,
    currency: item.currency ?? 'ZMW',
    price_tiers: item.item_price_tiers ?? item.price_tiers ?? undefined,
    option_groups: item.item_option_groups ?? item.option_groups ?? undefined,
  };
}

interface CartState {
  items: CartItem[];
  isCartSliderOpen: boolean;
  applyCredits: boolean;

  // Actions
  addToCart: (product: Product, quantity?: number, selection?: OptionSelection) => void;
  /** Keyed by cart line, not product id — see cartLineKey. */
  removeFromCart: (lineKey: string) => void;
  updateQuantity: (lineKey: string, quantity: number) => void;
  clearCart: () => void;
  getTotalItems: () => number;
  getTotalAmount: () => number;
  getItemsByShop: () => Map<string, CartItem[]>;
  setCartSliderOpen: (open: boolean) => void;
  setApplyCredits: (apply: boolean) => void;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isCartSliderOpen: false,
      applyCredits: false,
      setCartSliderOpen: (open: boolean) => set({ isCartSliderOpen: open }),
      setApplyCredits: (apply: boolean) => set({ applyCredits: apply }),

      addToCart: (product: Product, quantity = 1, selection?: OptionSelection) => {
        const { items } = get();
        const lineKey = cartLineKey(product.id, selection);
        const existingItem = items.find(item => lineKeyOf(item) === lineKey);

        if (existingItem) {
          set({
            items: items.map(item =>
              lineKeyOf(item) === lineKey
                ? { ...item, quantity: item.quantity + quantity }
                : item
            ),
          });
        } else {
          set({ items: [...items, { product, quantity, selection, lineKey }] });
        }
      },

      removeFromCart: (lineKey: string) => {
        set(state => ({
          items: state.items.filter(item => lineKeyOf(item) !== lineKey),
        }));
      },

      updateQuantity: (lineKey: string, quantity: number) => {
        if (quantity <= 0) {
          get().removeFromCart(lineKey);
          return;
        }

        set(state => ({
          items: state.items.map(item =>
            lineKeyOf(item) === lineKey ? { ...item, quantity } : item
          ),
        }));
      },

      clearCart: () => {
        set({ items: [] });
      },

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      getTotalAmount: () => {
        // Quantity breaks are applied here for the same reason they are applied
        // in checkout_init_atomic: a cart that quotes the undiscounted total
        // would show the buyer a number they are not charged.
        return get().items.reduce(
          (total, item) => total + cartLineUnitPrice(item) * item.quantity,
          0
        );
      },

      getItemsByShop: () => {
        const { items } = get();
        const byShop = new Map<string, CartItem[]>();
        
        items.forEach(item => {
          const shopId = item.product.shop_id;
          if (!byShop.has(shopId)) {
            byShop.set(shopId, []);
          }
          byShop.get(shopId)!.push(item);
        });
        
        return byShop;
      },
    }),
    {
      name: 'kithly-cart',
    }
  )
);
