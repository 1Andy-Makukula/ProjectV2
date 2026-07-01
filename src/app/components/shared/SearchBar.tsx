// KithLy Search Bar
import { useState, useRef, useEffect } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { useSearch } from '../../hooks/useSearch';
import { useNavigate } from 'react-router';
import { formatZMW } from '../../utils/formatters';
import { ImageWithFallback } from '../figma/ImageWithFallback';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const { results, isSearching } = useSearch(query);
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close the dropdown if the user clicks outside of it
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md z-50">
      {/* The Input Field */}
      <div className="relative flex items-center w-full h-10 rounded-full focus-within:shadow-lg bg-gray-100/80 backdrop-blur-md overflow-hidden transition-all">
        <div className="grid place-items-center h-full w-12 text-gray-400">
          {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
        </div>

        <input
          className="peer h-full w-full outline-none text-sm text-gray-700 bg-transparent pr-2"
          type="text"
          id="search"
          placeholder="Search KithLy..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          autoComplete="off"
        />

        {/* Clear Button */}
        {query && (
          <button 
            onClick={() => setQuery('')}
            className="grid place-items-center h-full w-12 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* The Dropdown Results Panel */}
      {isFocused && query.trim().length > 0 && (
        <div className="absolute top-12 left-0 w-full bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100 overflow-hidden max-h-96 overflow-y-auto">
          {results.length === 0 && !isSearching ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No results found for "{query}"
            </div>
          ) : (
            <ul className="flex flex-col">
              {results.map((item) => (
                <li 
                  key={item.id}
                  onClick={() => {
                    navigate(`/product/${item.id}`);
                    setIsFocused(false);
                    setQuery('');
                  }}
                  className="flex items-center gap-4 p-3 hover:bg-orange-50 cursor-pointer transition-colors border-b border-gray-50 last:border-0"
                >
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    <ImageWithFallback
                      src={item.image_url || ''} 
                      alt={item.name || item.title || ''} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex flex-col flex-1">
                    <span className="text-sm font-semibold text-gray-900 line-clamp-1">
                      {item.name || item.title || ''}
                    </span>
                    <span className="text-xs text-gray-500">@ {item.shopName}</span>
                  </div>
                  <span className="text-sm font-semibold text-orange-600 shrink-0">
                    {formatZMW(item.price_zmw)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
