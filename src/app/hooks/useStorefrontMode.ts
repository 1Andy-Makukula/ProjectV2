import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StorefrontMode } from '../types/storefrontModes';

interface StorefrontModeState {
  mode: StorefrontMode;
  setMode: (mode: StorefrontMode) => void;
}

/**
 * Which face the storefront is wearing.
 *
 * Same pattern as useCart and useSendFlowStore. Persisted because a shopper who
 * chose "Services" should still be in Services after a reload — switching mode
 * is a statement of intent, not a transient filter.
 */
export const useStorefrontMode = create<StorefrontModeState>()(
  persist(
    (set) => ({
      mode: 'discover',
      setMode: (mode) => {
        set({ mode });
        applyModeAttribute(mode);
      },
    }),
    {
      name: 'kithly-storefront-mode',
      onRehydrateStorage: () => (state) => {
        if (state) applyModeAttribute(state.mode);
      },
    },
  ),
);

/**
 * Drives the palette. Every mode-aware colour is a CSS variable behind
 * `:root[data-mode=...]`, so the whole retint happens here rather than in
 * component props.
 */
function applyModeAttribute(mode: StorefrontMode) {
  if (typeof document === 'undefined') return;
  if (mode === 'discover') {
    document.documentElement.removeAttribute('data-mode');
  } else {
    document.documentElement.setAttribute('data-mode', mode);
  }
}
