// Shop Profile Page

import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, MapPin, Store, Phone, Clock, CheckCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { mockShops, mockProducts } from '../data/mock-data';
import { ProductCard } from '../components/shared/ProductCard';
import { Badge } from '../components/ui/badge';

export function ShopProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const shop = mockShops.find(s => s.id === id);
  const shopProducts = mockProducts.filter(p => p.shop_id === id);

  if (!shop) {
    navigate('/');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm font-light text-muted-foreground hover:text-black mb-6">
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
          Back
        </button>

        {/* Shop Header */}
        <div className="bg-white rounded-[1.5rem] p-8 border border-border mb-6">
          <div className="flex items-start gap-6">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center flex-shrink-0">
              <Store className="w-10 h-10 text-white" strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h1 className="text-3xl font-light text-black mb-2">{shop.name}</h1>
                  <p className="text-sm font-light text-muted-foreground">{shop.description}</p>
                </div>
                {shop.is_verified && (
                  <Badge className="bg-green-100 text-green-700 font-light flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" strokeWidth={1.5} />
                    Verified
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm font-light">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="w-4 h-4" strokeWidth={1.5} />
                  {shop.district?.name}, {shop.district?.province}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="w-4 h-4" strokeWidth={1.5} />
                  {shop.contact_phone}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Store className="w-4 h-4" strokeWidth={1.5} />
                  {shop.category || 'General'}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4" strokeWidth={1.5} />
                  Open Daily 9AM - 6PM
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Products */}
        <div className="mb-6">
          <h2 className="text-2xl font-light text-black mb-4">Products ({shopProducts.length})</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {shopProducts.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  );
}
