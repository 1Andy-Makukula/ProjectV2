// KithLy Product Detail Page

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ShoppingCart, MapPin, Store, ArrowLeft, Heart, Share2 } from 'lucide-react';
import { mockProducts } from '../data/mock-data';
import { useCart } from '../hooks/useCart';
import { formatZMW } from '../utils/formatters';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';

export function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);

  const product = mockProducts.find(p => p.id === id);

  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-light text-black mb-2">Product not found</h2>
          <button onClick={() => navigate('/')} className="text-[#F97316] font-light hover:underline">
            Back to marketplace
          </button>
        </div>
      </div>
    );
  }

  const handleAddToCart = () => {
    addToCart(product, quantity);
    toast.success('Added to cart');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm font-light text-muted-foreground hover:text-black mb-6"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
          Back
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Images */}
          <div className="space-y-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="aspect-square rounded-[1.5rem] overflow-hidden bg-white border border-border"
            >
              <ImageWithFallback
                src={product.images[selectedImage]}
                alt={product.title}
                className="w-full h-full object-cover"
              />
            </motion.div>

            {product.images.length > 1 && (
              <div className="flex gap-3">
                {product.images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(idx)}
                    className={`w-20 h-20 rounded-xl overflow-hidden border-2 transition-colors ${
                      selectedImage === idx ? 'border-[#F97316]' : 'border-border'
                    }`}
                  >
                    <ImageWithFallback src={img} alt={`${product.title} ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            <div>
              <div className="flex items-start justify-between mb-2">
                <h1 className="text-3xl font-light text-black">{product.title}</h1>
                <div className="flex gap-2">
                  <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                    <Heart className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                  <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                    <Share2 className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <p className="text-sm font-light text-muted-foreground">{product.description}</p>
            </div>

            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-medium bg-gradient-to-r from-[#F97316] to-[#FB923C] bg-clip-text text-transparent">
                {formatZMW(product.price_zmw)}
              </span>
              {product.featured && <Badge className="font-light">Featured</Badge>}
            </div>

            {/* Shop Info */}
            <div className="p-4 bg-white rounded-[1rem] border border-border">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
                  <Store className="w-6 h-6 text-white" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="font-light text-black">{product.shop?.name}</h3>
                  <div className="flex items-center gap-1 text-xs font-light text-muted-foreground">
                    <MapPin className="w-3 h-3" strokeWidth={1.5} />
                    {product.shop?.district?.name}, {product.shop?.district?.province}
                  </div>
                </div>
              </div>
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <label className="text-sm font-light text-muted-foreground">Quantity</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 rounded-lg border border-border hover:bg-gray-100 transition-colors font-light"
                >
                  -
                </button>
                <span className="w-12 text-center font-light">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 rounded-lg border border-border hover:bg-gray-100 transition-colors font-light"
                >
                  +
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleAddToCart}
                className="w-full py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-5 h-5" strokeWidth={1.5} />
                Add to Cart
              </motion.button>
              <button className="w-full py-4 border-2 border-border rounded-full font-light hover:bg-gray-50 transition-colors">
                Buy as Gift
              </button>
            </div>

            {/* Details */}
            <div className="pt-6 border-t border-border space-y-3">
              <h3 className="font-light text-black">Product Details</h3>
              <div className="space-y-2 text-sm font-light text-muted-foreground">
                <div className="flex justify-between">
                  <span>Category</span>
                  <span className="text-black capitalize">{product.category}</span>
                </div>
                <div className="flex justify-between">
                  <span>Location</span>
                  <span className="text-black">{product.shop?.district?.name}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
