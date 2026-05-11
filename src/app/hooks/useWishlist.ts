// Wishlist Management Hook

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '../types';

interface WishlistState {
  items: Product[];
  isPublic: boolean;

  addToWishlist: (product: Product) => void;
  removeFromWishlist: (productId: string) => void;
  isInWishlist: (productId: string) => boolean;
  toggleVisibility: () => void;
  clearWishlist: () => void;
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      isPublic: false,

      addToWishlist: (product: Product) => {
        const { items } = get();
        if (!items.find(item => item.id === product.id)) {
          set({ items: [...items, product] });
        }
      },

      removeFromWishlist: (productId: string) => {
        set(state => ({
          items: state.items.filter(item => item.id !== productId),
        }));
      },

      isInWishlist: (productId: string) => {
        return get().items.some(item => item.id === productId);
      },

      toggleVisibility: () => {
        set(state => ({ isPublic: !state.isPublic }));
      },

      clearWishlist: () => {
        set({ items: [] });
      },
    }),
    {
      name: 'kithly-wishlist',
    }
  )
);
