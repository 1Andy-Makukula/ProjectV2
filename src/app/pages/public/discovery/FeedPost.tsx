import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useInView } from 'motion/react';
import { Heart, MessageCircle, Share2, Bookmark, Music, Gift, Plus } from 'lucide-react';
import type { DiscoveryPost } from './discoveryData';

export function FeedPost({ post }: { post: DiscoveryPost }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Auto-play / pause based on viewport visibility
  const isInView = useInView(containerRef, { amount: 0.6 });
  
  const [isLiked, setIsLiked] = useState(false);
  const [showBigHeart, setShowBigHeart] = useState(false);
  const [likesCount, setLikesCount] = useState(post.likes);

  useEffect(() => {
    if (post.type === 'video' && videoRef.current) {
      if (isInView) {
        videoRef.current.play().catch(() => {
          // Autoplay blocked by browser policy until interaction
        });
      } else {
        videoRef.current.pause();
      }
    }
  }, [isInView, post.type]);

  const handleDoubleTap = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isLiked) {
      setIsLiked(true);
      setLikesCount(prev => prev + 1);
    }
    setShowBigHeart(true);
    setTimeout(() => setShowBigHeart(false), 1000);
  };

  const toggleLike = () => {
    setIsLiked(!isLiked);
    setLikesCount(prev => isLiked ? prev - 1 : prev + 1);
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full snap-start bg-black overflow-hidden"
      onDoubleClick={handleDoubleTap}
    >
      {/* Media Layer */}
      {post.type === 'video' ? (
        <video
          ref={videoRef}
          src={post.url}
          className="absolute inset-0 w-full h-full object-cover"
          loop
          muted
          playsInline
        />
      ) : (
        <img 
          src={post.url} 
          alt={post.caption}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Dark Gradient Overlay for text legibility */}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

      {/* Big Heart Animation on Double Tap */}
      <AnimatePresence>
        {showBigHeart && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 0 }}
            animate={{ opacity: 1, scale: 1.2, y: -20 }}
            exit={{ opacity: 0, scale: 1.5, y: -40 }}
            transition={{ duration: 0.5, type: 'spring' }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-50"
          >
            <Heart className="w-32 h-32 text-red-500 fill-red-500 drop-shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right Side Action Bar */}
      <div className="absolute right-4 bottom-28 flex flex-col items-center gap-6 z-40">
        <div className="relative group cursor-pointer">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/80 shadow-lg">
            <img src={post.authorAvatar} alt={post.author} className="w-full h-full object-cover" />
          </div>
          <button className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-primary text-white rounded-full p-0.5 shadow-md">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <button onClick={toggleLike} className="flex flex-col items-center gap-1 group">
          <div className="p-3 rounded-full bg-black/20 backdrop-blur-md group-hover:bg-black/40 transition">
            <Heart className={`w-7 h-7 transition-colors ${isLiked ? 'text-red-500 fill-red-500' : 'text-white'}`} />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">{likesCount.toLocaleString()}</span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="p-3 rounded-full bg-black/20 backdrop-blur-md group-hover:bg-black/40 transition">
            <MessageCircle className="w-7 h-7 text-white fill-white/20" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">{post.comments}</span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="p-3 rounded-full bg-black/20 backdrop-blur-md group-hover:bg-black/40 transition">
            <Bookmark className="w-7 h-7 text-white fill-white/20" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">Save</span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="p-3 rounded-full bg-black/20 backdrop-blur-md group-hover:bg-black/40 transition">
            <Share2 className="w-7 h-7 text-white fill-white/20" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">{post.shares}</span>
        </button>
      </div>

      {/* Bottom Info Overlay */}
      <div className="absolute left-4 bottom-24 right-20 z-40 space-y-3">
        <div>
          <h3 className="text-white font-bold text-lg drop-shadow-md flex items-center gap-2">
            {post.author}
            <span className="bg-white/20 backdrop-blur-md text-[10px] uppercase px-2 py-0.5 rounded-sm">Creator</span>
          </h3>
          <p className="text-white/90 text-sm mt-1 drop-shadow-md line-clamp-2">
            {post.caption}
          </p>
        </div>

        <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
          <Music className="w-3 h-3" />
          <span className="truncate">Original Audio - {post.shopName}</span>
        </div>
      </div>

      {/* KithLy Glassmorphic Checkout Bar */}
      <div className="absolute left-0 right-0 bottom-0 h-20 bg-black/30 backdrop-blur-xl border-t border-white/10 z-50 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Gift className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">{post.shopName}</p>
            <p className="text-white/60 text-xs">Featured Gift Item</p>
          </div>
        </div>
        
        <button className="bg-gradient-to-r from-primary to-primary-light hover:opacity-90 active:scale-95 transition-all text-white font-bold py-2.5 px-6 rounded-full text-sm shadow-lg shadow-primary/20 flex items-center gap-2">
          Send K{post.itemPrice}
        </button>
      </div>
    </div>
  );
}
