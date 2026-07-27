import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Product } from '../types';

export interface SearchProduct extends Product {
  shopName?: string;
}

export function useSearch(query: string) {
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If the search bar is empty, clear results and don't ping the database
    if (!query || query.trim().length === 0) {
      setResults([]);
      return;
    }

    const fetchSearchResults = async () => {
      setIsSearching(true);
      setError(null);

      try {
        // We use ilike for case-insensitive matching and wrap the query in % wildcards
        const { data, error: searchError } = await supabase
          .from('items')
          .select(`
            *,
            shops (
              name,
              is_active
            )
          `)
          .ilike('name', `%${query}%`)
          .eq('is_available', true)
          // A quote belongs to the conversation it came from, not to search.
          .eq('is_quote_only', false)
          .limit(20); // Prevent massive payloads

        if (searchError) throw searchError;

        // Transform the data to match your Product type
        const formattedResults = (data || []).map((item: any) => ({
          ...item,
          title: item.name || item.title || '',
          images: item.images || (item.image_url ? [item.image_url] : []),
          shopName: item.shops?.name || 'Unknown Shop',
        })) as SearchProduct[];

        setResults(formattedResults);
      } catch (err: any) {
        console.error("Search Engine Error:", err);
        setError(err.message);
      } finally {
        setIsSearching(false);
      }
    };

    // Debounce the search so we don't hit Supabase on every single keystroke
    const debounceTimer = setTimeout(() => {
      fetchSearchResults();
    }, 400); // Waits 400ms after the user stops typing

    return () => clearTimeout(debounceTimer);
  }, [query]);

  return { results, isSearching, error };
}
