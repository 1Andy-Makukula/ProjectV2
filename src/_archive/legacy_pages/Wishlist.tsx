// Wishlist Page

import { useNavigate } from 'react-router';
import { Heart, Lock, Unlock, ShoppingCart } from 'lucide-react';
import { motion } from 'motion/react';
import { useWishlist } from '../hooks/useWishlist';
import { useCart } from '../hooks/useCart';
import { ProductCard } from '../components/shared/ProductCard';
import { EmptyState } from '../components/shared/EmptyState';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';

export function Wishlist() {
  const navigate = useNavigate();
  const { items, isPublic, toggleVisibility, clearWishlist } = useWishlist();
  const { addToCart } = useCart();

  const handleAddAllToCart = () => {
    items.forEach(product => addToCart(product));
    toast.success(`Added ${items.length} items to cart`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
              <Heart className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-3xl font-light text-black">Woven Basket</h1>
              <p className="text-sm font-light text-muted-foreground">{items.length} items</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleVisibility}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-full font-light hover:bg-gray-50 transition-colors"
            >
              {isPublic ? <Unlock className="w-4 h-4" strokeWidth={1.5} /> : <Lock className="w-4 h-4" strokeWidth={1.5} />}
              {isPublic ? 'Public' : 'Private'}
            </button>

            {items.length > 0 && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleAddAllToCart}
                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
              >
                <ShoppingCart className="w-4 h-4" strokeWidth={1.5} />
                Add All to Cart
              </motion.button>
            )}
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {items.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Heart}
            title="Your basket is empty"
            description="Start adding gifts you love to your wishlist"
            action={{
              label: 'Browse Marketplace',
              onClick: () => navigate('/'),
            }}
          />
        )}
      </div>
    </div>
  );
}
