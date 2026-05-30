// KithLy Cart Hook - Shopping Cart Management

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Product } from '../types';

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
  };
}

interface CartState {
  items: CartItem[];
  isCartSliderOpen: boolean;

  // Actions
  addToCart: (product: Product, quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalItems: () => number;
  getTotalAmount: () => number;
  getItemsByShop: () => Map<string, CartItem[]>;
  setCartSliderOpen: (open: boolean) => void;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isCartSliderOpen: false,
      setCartSliderOpen: (open: boolean) => set({ isCartSliderOpen: open }),

      addToCart: (product: Product, quantity = 1) => {
        const { items } = get();
        const existingItem = items.find(item => item.product.id === product.id);
        
        if (existingItem) {
          set({
            items: items.map(item =>
              item.product.id === product.id
                ? { ...item, quantity: item.quantity + quantity }
                : item
            ),
          });
        } else {
          set({ items: [...items, { product, quantity }] });
        }
      },

      removeFromCart: (productId: string) => {
        set(state => ({
          items: state.items.filter(item => item.product.id !== productId),
        }));
      },

      updateQuantity: (productId: string, quantity: number) => {
        if (quantity <= 0) {
          get().removeFromCart(productId);
          return;
        }
        
        set(state => ({
          items: state.items.map(item =>
            item.product.id === productId ? { ...item, quantity } : item
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
        return get().items.reduce(
          (total, item) => total + item.product.price_zmw * item.quantity,
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
