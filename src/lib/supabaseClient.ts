/**
 * V2 Unified Supabase Client
 *
 * This is the single source of truth for all Supabase interactions
 * across the KithLy frontend. All components must import from this file.
 *
 * The instance is whatever VITE_SUPABASE_URL points at — do not infer it from
 * this comment. This previously named ghwrvqsoelpcoqdodrzu, which has not been
 * the project for some time: .env and the linked CLI project are both
 * mbjbrdhpjgfhhycijodz, and the full migration history is applied there.
 * A stale reference here is how someone deploys to the wrong database.
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

// Instantiate with strict session persistence to survive checkout gateway redirects
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

/**
 * The Supabase project ID, derived from the URL.
 * Used anywhere a raw project reference is needed (e.g. Edge Function URLs).
 * Derived at runtime, so it always matches the configured instance.
 */
export const projectId = supabaseUrl.replace('https://', '').split('.')[0];
