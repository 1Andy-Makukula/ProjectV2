// Shop Directory

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Store, MapPin, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { mockShops, districts } from '../data/mock-data';
import { Badge } from '../components/ui/badge';

export function ShopDirectory() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');

  const filteredShops = mockShops.filter(shop => {
    const matchesSearch = shop.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         shop.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDistrict = !selectedDistrict || shop.district_id === selectedDistrict;
    return matchesSearch && matchesDistrict;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8">
        <h1 className="text-3xl font-light text-black mb-8">Shop Directory</h1>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shops..."
              className="w-full pl-11 pr-4 py-3 bg-white border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
            />
          </div>
          <select
            value={selectedDistrict}
            onChange={(e) => setSelectedDistrict(e.target.value)}
            className="px-4 py-3 bg-white border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
          >
            <option value="">All Districts</option>
            {districts.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        {/* Shop Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredShops.map((shop, idx) => (
            <motion.div
              key={shop.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              onClick={() => navigate(`/shop/${shop.id}`)}
              className="bg-white rounded-[1.5rem] p-6 border border-border hover:shadow-lg transition-shadow cursor-pointer"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center flex-shrink-0">
                  <Store className="w-7 h-7 text-white" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-light text-black mb-1">{shop.name}</h3>
                  <div className="flex items-center gap-1 text-xs font-light text-muted-foreground">
                    <MapPin className="w-3 h-3" strokeWidth={1.5} />
                    {shop.district?.name}
                  </div>
                </div>
              </div>
              <p className="text-sm font-light text-muted-foreground mb-4 line-clamp-2">{shop.description}</p>
              <div className="flex items-center justify-between">
                <Badge className="font-light">{shop.category || 'General'}</Badge>
                {shop.is_verified && (
                  <Badge className="bg-green-100 text-green-700 font-light">Verified</Badge>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
