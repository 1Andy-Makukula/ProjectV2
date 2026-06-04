// Shop Directory

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../../lib/supabaseClient';
import { ShopCard } from '../components/shared/ShopCard';

interface Shop {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  image_url: string | null;
  itemCount: number;
}

export function ShopDirectory() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const { data: shopsData, error } = await supabase
          .from('shops')
          .select('id, name, description, is_active, location, logo_url, cover_image_url, image_url')
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (error) throw error;

        // Manually fetch item counts to avoid 400 Bad Request
        const shopsWithCounts = await Promise.all(
          (shopsData ?? []).map(async (s: any) => {
            const { count } = await supabase
              .from('items')
              .select('*', { count: 'exact', head: true })
              .eq('shop_id', s.id)
              .eq('is_available', true);
            
            return {
              id: s.id,
              name: s.name,
              description: s.description,
              location: s.location,
              logo_url: s.logo_url,
              cover_image_url: s.cover_image_url,
              image_url: s.image_url,
              itemCount: count ?? 0,
            };
          })
        );

        setShops(shopsWithCounts);
      } catch (err) {
        console.error('Error loading directory data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const filteredShops = shops.filter(shop => {
    const searchLower = searchQuery.toLowerCase();
    return shop.name.toLowerCase().includes(searchLower) ||
      (shop.description || '').toLowerCase().includes(searchLower) ||
      (shop.location || '').toLowerCase().includes(searchLower);
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.08),_transparent_40%),linear-gradient(180deg,_#fff7ed_0%,_#ffffff_45%,_#fffaf5_100%)]">
      <div className="container mx-auto px-4 md:px-8 py-8 md:py-10">
        <div className="mb-8 md:mb-10">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 mb-3">
            Shop Directory
          </h1>
          <p className="text-slate-500 text-sm max-w-xl">
            Discover verified KithLy partners. Browse their featured items and send a gift instantly using our secure escrow service.
          </p>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          <div className="relative group">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-400 group-focus-within:text-orange-500 transition-colors" strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shops by name, description, or location..."
              className="w-full pl-12 pr-6 py-4 bg-white/70 backdrop-blur-sm border border-orange-100 rounded-full text-sm shadow-[0_8px_30px_rgb(0,0,0,0.04)] focus:outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-500/10 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Shop Grid */}
        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading shops...</div>
        ) : filteredShops.length === 0 ? (
          <div className="py-12 text-center text-slate-400">No shops found matching your criteria.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredShops.map((shop, idx) => (
              <motion.div
                key={shop.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <ShopCard 
                  shop={shop} 
                  itemCount={shop.itemCount} 
                  onClick={() => navigate(`/shop/${shop.id}`)} 
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
