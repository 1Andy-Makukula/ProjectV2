import { create } from 'zustand';

interface Item {
  id: string;
  name: string;
  price: number;
  currency: string;
  image_url: string | null;
  shop_id: string;
  shop_name: string;
}

interface RecipientDetails {
  name: string;
  phone: string;
  message: string;
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
