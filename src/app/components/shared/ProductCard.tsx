// KithLy Product Card — Premium Responsive Framework
// Desktop: hover overlay → Quick View  |  Mobile: "VIEW PRODUCT" button → Full Detail Modal

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import {
  X,
  ShieldCheck,
  ShoppingBag,
  Eye,
  Heart,
  MapPin,
} from 'lucide-react';
import type { Product } from '../../types';
import { formatZMW } from '../../utils/formatters';
import { useCart } from '../../hooks/useCart';
import { useWishlist } from '../../hooks/useWishlist';
import { toast } from 'sonner';
import { ImageWithFallback } from '../figma/ImageWithFallback';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductCardProps {
  product: Product;
  onClick?: () => void;
}

// ---------------------------------------------------------------------------
// Immersive Full Detail Modal
// ---------------------------------------------------------------------------

function ProductDetailModal({
  product,
  onClose,
  onAddToCart,
}: {
  product: Product;
  onClose: () => void;
  onAddToCart: (e: React.MouseEvent) => void;
}) {
  return (
    <motion.div
      id={`product-modal-backdrop-${product.id}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Central Card */}
      <motion.div
        id={`product-modal-card-${product.id}`}
        initial={{ scale: 0.95, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 16, opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="bg-white w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl relative border border-gray-100 max-h-[90vh] overflow-y-auto"
      >
        {/* Close Button */}
        <button
          id={`product-modal-close-${product.id}`}
          onClick={onClose}
          aria-label="Close product detail"
          className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur-sm border border-gray-100 p-2.5 rounded-full hover:bg-gray-50 transition-colors shadow-sm text-gray-400 hover:text-gray-900"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Split-Pane Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 p-6 md:p-8 gap-6 md:gap-10">

          {/* ── Left / Top: High-Resolution Media Frame ── */}
          <div className="aspect-square w-full rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 shadow-sm">
            <ImageWithFallback
              src={product.images[0]}
              alt={product.title}
              className="w-full h-full object-cover"
            />
          </div>

          {/* ── Right / Bottom: Structural Details Block ── */}
          <div className="flex flex-col justify-between py-2">
            <div>
              {/* Status Ribbons */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="text-[10px] font-bold tracking-widest uppercase bg-gray-100 text-gray-500 px-2.5 py-1 rounded-lg">
                  {product.shop?.business_name ?? 'KithLy Merchant'}
                </span>

                {/* Escrow Protected badge — brand gradient */}
                <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-lg border"
                  style={{
                    background: 'linear-gradient(to right, #fff7ed, #fff1f2)',
                    borderColor: '#fed7aa',
                    color: '#ea580c',
                  }}>
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Escrow Protected
                </span>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">
                {product.title}
              </h2>

              {/* Price — brand gradient */}
              <span
                className="text-2xl font-black block mt-2"
                style={{
                  background: 'linear-gradient(to right, #f97316, #ef4444)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {formatZMW(product.price_zmw)}
              </span>

              <div className="w-full h-px bg-gray-100 my-5" />

              {/* Description */}
              <p className="text-sm text-gray-500 leading-relaxed">
                {product.description}
              </p>

              {/* Low stock notice */}
              {product.stock_count <= 5 && product.stock_count > 0 && (
                <p className="mt-3 text-xs font-semibold text-red-500 tracking-wide">
                  Only {product.stock_count} unit{product.stock_count > 1 ? 's' : ''} remaining
                </p>
              )}
            </div>

            {/* ── Action Drawer ── */}
            <div className="mt-8 pt-5 border-t border-gray-50 flex flex-col gap-3">

              {/* Escrow Info Block */}
              <div className="bg-gray-50 border border-gray-100 p-3.5 rounded-xl flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500 leading-relaxed">
                  <span className="font-bold text-gray-700">KithLy Escrow Protocol: </span>
                  Your capital remains securely locked in vault layers until you inspect the physical asset and clear verification claim codes at points of handoff.
                </p>
              </div>

              {/* Primary CTA */}
              <button
                id={`product-modal-cta-${product.id}`}
                onClick={onAddToCart}
                className="w-full py-3.5 rounded-xl font-bold text-sm tracking-wide text-white flex items-center justify-center gap-2 transition-all hover:opacity-95 active:scale-[0.99]"
                style={{ background: 'linear-gradient(to right, #f97316, #ef4444)' }}
              >
                <ShoppingBag className="w-4 h-4" />
                Initiate Escrow Secure Transfer
              </button>
            </div>
          </div>

        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// ProductCard
// ---------------------------------------------------------------------------

export function ProductCard({ product, onClick }: ProductCardProps) {
  const { addToCart } = useCart();
  const { addToWishlist, removeFromWishlist, isInWishlist } = useWishlist();
  const navigate = useNavigate();
  const inWishlist = isInWishlist(product.id);

  const [modalOpen, setModalOpen] = useState(false);

  // ── Navigation / open modal
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/product/${product.id}`);
    }
  };

  // ── Add to cart (stops propagation)
  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(product);
    toast.success('Added to cart', { description: product.title });
    setModalOpen(false);
  };

  // ── Wishlist toggle
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

  // ── Open modal (stops propagation so card click doesn't fire)
  const openModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setModalOpen(true);
  };

  return (
    <>
      {/* ────────────────────────── Card ────────────────────────── */}
      <motion.div
        id={`product-card-${product.id}`}
        whileHover={{ y: -4 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        onClick={handleClick}
        className="group relative cursor-pointer w-full bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-lg transition-shadow duration-300 flex flex-col"
      >
        {/* ── Media Box ──────────────────────────────────────────── */}
        <div className="relative w-full aspect-square bg-gray-50 overflow-hidden">
          <ImageWithFallback
            src={product.images[0]}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500 ease-out"
          />

          {/* Low-stock badge */}
          {product.stock_count <= 5 && product.stock_count > 0 && (
            <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm">
              <span className="text-[10px] font-semibold tracking-wide text-red-500 uppercase">
                Only {product.stock_count} left
              </span>
            </div>
          )}

          {/* Featured badge */}
          {product.featured && (
            <div
              className="absolute top-3 left-3 px-3 py-1 rounded-full shadow-sm"
              style={{ background: 'linear-gradient(to right, #f97316, #fb923c)' }}
            >
              <span className="text-[10px] font-semibold tracking-wide text-white uppercase">
                Featured
              </span>
            </div>
          )}

          {/* Wishlist button */}
          <button
            id={`wishlist-btn-${product.id}`}
            onClick={handleWishlist}
            aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/95 backdrop-blur-sm flex items-center justify-center hover:scale-110 transition-transform shadow-sm"
          >
            <Heart
              className={`w-4 h-4 ${inWishlist ? 'fill-[#F97316] text-[#F97316]' : 'text-gray-400'}`}
              strokeWidth={1.5}
            />
          </button>

          {/* ── DESKTOP ONLY: Hover Action Overlay ── */}
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 hidden md:flex items-center justify-center">
            <button
              id={`quick-view-btn-${product.id}`}
              onClick={openModal}
              className="bg-white/95 text-gray-900 font-bold text-xs tracking-wider uppercase px-5 py-2.5 rounded-xl shadow-md flex items-center gap-2 hover:bg-white transition-all duration-300 translate-y-2 group-hover:translate-y-0"
              style={{ transitionProperty: 'transform, background-color' }}
            >
              <Eye className="w-4 h-4 text-orange-500" />
              Quick View
            </button>
          </div>
        </div>

        {/* ── Info Strip ─────────────────────────────────────────── */}
        <div className="p-4 flex flex-col justify-between flex-grow">
          <div>
            {/* Merchant */}
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-bold tracking-widest uppercase mb-0.5">
              <MapPin className="w-3 h-3 shrink-0" strokeWidth={1.5} />
              {product.shop?.business_name ?? 'KithLy Merchant'}
            </div>

            {/* Title */}
            <h4 className="text-sm md:text-base font-bold text-gray-900 truncate tracking-tight mt-0.5">
              {product.title}
            </h4>

            {/* Price */}
            <span
              className="text-sm font-black block mt-1"
              style={{
                background: 'linear-gradient(to right, #f97316, #fb923c)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {formatZMW(product.price_zmw)}
            </span>
          </div>

          {/* ── MOBILE ONLY: Explicit "View Product" Touch Trigger ── */}
          <div className="mt-4 md:hidden">
            <button
              id={`view-product-btn-${product.id}`}
              onClick={openModal}
              className="w-full py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold tracking-wider text-gray-800 uppercase active:bg-gray-100 transition-colors flex items-center justify-center gap-1.5"
            >
              View Product
            </button>
          </div>
        </div>
      </motion.div>

      {/* ────────────────── Immersive Detail Modal ────────────────── */}
      <AnimatePresence>
        {modalOpen && (
          <ProductDetailModal
            product={product}
            onClose={() => setModalOpen(false)}
            onAddToCart={handleAddToCart}
          />
        )}
      </AnimatePresence>
    </>
  );
}
