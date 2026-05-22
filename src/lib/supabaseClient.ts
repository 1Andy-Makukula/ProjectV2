/**
 * V2 Unified Supabase Client
 *
 * This is the single source of truth for all Supabase interactions
 * across the KithLy frontend. All components must import from this file.
 *
 * Connected instance: ghwrvqsoelpcoqdodrzu (Url2 — V2 Production)
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[supabaseClient] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not defined. ' +
    'Check your .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * The Supabase project ID, derived from the URL.
 * Used anywhere a raw project reference is needed (e.g. Edge Function URLs).
 * Example: "ghwrvqsoelpcoqdodrzu"
 */
export const projectId = supabaseUrl.replace('https://', '').split('.')[0];
