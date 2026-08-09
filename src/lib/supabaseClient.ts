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

// NOT YET typed with <Database>, deliberately, and this is a known gap.
//
// Without the generic, .from() and .rpc() accept any table name, any column and
// any argument shape, and every result is `any`. That is how checkout_init_atomic
// drifted to twelve positional parameters and how a ghost overload sat in
// production for months, both invisible to TypeScript.
//
// Adding `createClient<Database>` was attempted on 2026-08-09 and reverted. It
// compiles down to a small number of errors quickly, but the remaining ones are
// not near-misses: the hand-written view models have structurally diverged from
// the schema -- `Shop` declares 27 fields against 41 columns, `Item` declares 8
// against 29 -- so a real row cannot be assigned into them at all. Closing that
// means reshaping types consumed across the whole UI, which is its own piece of
// work with its own blast radius, not a side effect of turning on a generic.
//
// The attempt was not wasted: it found a dead diagnostics module querying a
// table that does not exist, four queries passing a possibly-undefined id into
// .eq() (including the ownership filter on merchant voucher fulfilment), and an
// unvalidated cast of users.role into the union the app routes on. Those are
// fixed. See src/types/database.types.ts, which is now regenerated and accurate.
//
// To finish it: derive the view models from
// Database['public']['Tables'][...]['Row'] instead of redeclaring them, then add
// the generic here.
//
// Regenerate types after any schema change:
//   npx supabase gen types typescript --local > src/types/database.types.ts
//
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
