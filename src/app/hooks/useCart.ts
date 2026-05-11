// KithLy Cart Hook - Shopping Cart Management

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Product } from '../types';

interface CartState {
  items: CartItem[];
  
  // Actions
  addToCart: (product: Product, quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalItems: () => number;
  getTotalAmount: () => number;
  getItemsByShop: () => Map<string, CartItem[]>;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

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
