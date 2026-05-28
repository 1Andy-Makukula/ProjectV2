// FloatingCart — Globally persistent smart cart button
// Renders only when cart has items. Fixed position to avoid accidental thumb strikes.

import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '../../hooks/useCart';

export function FloatingCart() {
  const { getTotalItems, setCartSliderOpen } = useCart();
  const count = getTotalItems();

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.button
          key="floating-cart"
          initial={{ scale: 0, y: 50 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0, y: 50 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
          onClick={() => setCartSliderOpen(true)}
          aria-label={`View cart — ${count} item${count !== 1 ? 's' : ''}`}
          className="fixed bottom-24 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2"
        >
          <ShoppingCart className="h-6 w-6 text-white" strokeWidth={1.75} />

          {/* Badge */}
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-700 px-1 text-[11px] font-bold text-white ring-2 ring-white">
            {count > 99 ? '99+' : count}
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
