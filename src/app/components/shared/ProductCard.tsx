// KithLy Product Card - Apple-inspired Minimal Design

import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { ShoppingCart, MapPin, Heart } from 'lucide-react';
import type { Product } from '../../types';
import { formatZMW } from '../../utils/formatters';
import { useCart } from '../../hooks/useCart';
import { useWishlist } from '../../hooks/useWishlist';
import { toast } from 'sonner';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface ProductCardProps {
  product: Product;
  onClick?: () => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  const { addToCart } = useCart();
  const { addToWishlist, removeFromWishlist, isInWishlist } = useWishlist();
  const navigate = useNavigate();
  const inWishlist = isInWishlist(product.id);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/product/${product.id}`);
    }
  };

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(product);
    toast.success('Added to cart', {
      description: product.title,
    });
  };

  const handleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inWishlist) {
      removeFromWishlist(product.id);
      toast.success('Removed from wishlist');
    } else {
      addToWishlist(product);
      toast.success('Added to wishlist');
    }
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      onClick={handleClick}
      className="group relative cursor-pointer"
    >
      {/* Card Container - No borders, pure white on light gray bg */}
      <div className="bg-white rounded-[1rem] overflow-hidden shadow-sm hover:shadow-lg transition-shadow duration-300">
        {/* Image Container */}
        <div className="relative aspect-square overflow-hidden bg-gray-50">
          <ImageWithFallback
            src={product.images[0]}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          
          {/* Stock Badge */}
          {product.stock_count <= 5 && (
            <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm px-3 py-1 rounded-full">
              <span className="text-xs font-light text-red-600">
                Only {product.stock_count} left
              </span>
            </div>
          )}

          {/* Featured Badge */}
          {product.featured && (
            <div className="absolute top-3 left-3 bg-gradient-to-r from-[#F97316] to-[#FB923C] px-3 py-1 rounded-full">
              <span className="text-xs font-light text-white">Featured</span>
            </div>
          )}

          {/* Wishlist Button */}
          <button
            onClick={handleWishlist}
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/95 backdrop-blur-sm flex items-center justify-center hover:scale-110 transition-transform shadow-sm"
          >
            <Heart
              className={`w-4 h-4 ${inWishlist ? 'fill-[#F97316] text-[#F97316]' : 'text-gray-600'}`}
              strokeWidth={1.5}
            />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Shop Info */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3" strokeWidth={1.5} />
            <span className="font-light">{product.shop?.business_name}</span>
          </div>

          {/* Product Title */}
          <h3 className="font-light text-black line-clamp-2 leading-tight">
            {product.title}
          </h3>

          {/* Price & Action */}
          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-lg font-medium bg-gradient-to-r from-[#F97316] to-[#FB923C] bg-clip-text text-transparent">
                {formatZMW(product.price_zmw)}
              </p>
            </div>

            {/* Add to Cart Button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleAddToCart}
              className="p-2 rounded-full bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white shadow-sm hover:shadow-md transition-shadow"
              aria-label="Add to cart"
            >
              <ShoppingCart className="w-4 h-4" strokeWidth={1.5} />
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
