import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { DISCOVERY_POSTS, type DiscoveryPost } from './discoveryData';
import { FeedPost } from './FeedPost';

export function DiscoveryFeed() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<DiscoveryPost[]>([]);

  // Simulate initial load
  useEffect(() => {
    setPosts(DISCOVERY_POSTS);
  }, []);

  // Simulate infinite scroll by duplicating posts when reaching bottom
  const loadMore = () => {
    setPosts(prev => [...prev, ...DISCOVERY_POSTS.map(p => ({ ...p, id: p.id + '_' + Date.now() }))]);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const bottom = e.currentTarget.scrollHeight - e.currentTarget.scrollTop <= e.currentTarget.clientHeight + 100;
    if (bottom) {
      loadMore();
    }
  };

  return (
    <div className="h-screen w-full bg-black sm:w-[400px] sm:mx-auto sm:border-x sm:border-gray-800 relative overflow-hidden flex flex-col">
      {/* Top Navigation Overlay */}
      <div className="absolute top-0 inset-x-0 z-50 h-24 bg-gradient-to-b from-black/80 to-transparent pointer-events-none flex items-start justify-between px-4 pt-6">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 bg-black/20 backdrop-blur-md rounded-full text-white pointer-events-auto hover:bg-black/40 transition"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        
        <div className="flex gap-4 pointer-events-auto">
          <button className="text-white/70 font-semibold text-lg hover:text-white transition">Following</button>
          <button className="text-white font-bold text-lg drop-shadow-md">For You</button>
        </div>
        
        <button className="p-2 bg-black/20 backdrop-blur-md rounded-full text-white pointer-events-auto hover:bg-black/40 transition">
          <Search className="w-6 h-6" />
        </button>
      </div>

      {/* Snap Scrolling Container */}
      <div 
        className="flex-1 overflow-y-scroll snap-y snap-mandatory scroll-smooth no-scrollbar"
        onScroll={handleScroll}
      >
        {posts.map((post) => (
          <FeedPost key={post.id} post={post} />
        ))}
      </div>
      
      <style>{`
        /* Hide scrollbar for seamless look */
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
