// KithLy Search Bar

import { useState, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { supabase } from '../../../utils/supabase/client';

interface SearchResult {
  id: string;
  title: string;
  shopName: string;
}

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const navigate = useNavigate();

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const fetchSearchResults = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('items')
          .select('id, name, shops(name)')
          .ilike('name', `%${query}%`)
          .eq('is_available', true)
          .limit(5);

        if (error) throw error;
        
        setResults(
          (data || []).map((item: any) => ({
            id: item.id,
            title: item.name,
            shopName: item.shops?.name || 'Unknown Shop',
          }))
        );
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(() => {
      fetchSearchResults();
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [query]);

  return (
    <div className="relative w-full max-w-xl">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder="Search gifts..."
          className="w-full pl-11 pr-10 py-2.5 bg-gray-50 border border-border rounded-full font-light text-sm focus:outline-none focus:border-[#F97316] focus:bg-white transition-all"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded-full transition-colors"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" strokeWidth={1.5} />}
          </button>
        )}
      </div>

      <AnimatePresence>
        {isFocused && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full mt-2 w-full bg-white rounded-2xl border border-border shadow-lg overflow-hidden z-50"
          >
            {results.map((product) => (
              <button
                key={product.id}
                onClick={() => {
                  navigate(`/product/${product.id}`);
                  setQuery('');
                }}
                className="w-full px-4 py-3 hover:bg-gray-50 transition-colors text-left flex items-center gap-3"
              >
                <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" strokeWidth={1.5} />
                <div className="flex-1 min-w-0">
                  <p className="font-light text-sm text-black truncate">{product.title}</p>
                  <p className="text-xs font-light text-muted-foreground">{product.shopName}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
