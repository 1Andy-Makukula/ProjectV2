/**
 * Demo data seeder.
 *
 * Populates the platform with enough shops, products, services, experiences and
 * lists to judge navigation and exercise features that have never had data:
 * quantity-break pricing, item options, multi-image galleries, scheduling and
 * lead times, low-stock warnings, quote-only services, and wholesale shops.
 *
 * NOT a migration. Migrations are schema; this is content, and content that is
 * meant to be deletable. Keeping it out of the chain also means a fresh replay
 * does not silently mint demo shops into a real storefront -- a mistake this
 * project has already made once with a verification fixture.
 *
 * Idempotent. Every entity is keyed on a stable natural key (shop name, item
 * name within a shop, list slug) and skipped if present, so re-running tops up
 * rather than duplicating.
 *
 *   node scripts/seed-demo-data.mjs            # create
 *   node scripts/seed-demo-data.mjs --report   # count only, no writes
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY: it creates auth users for shop owners and
 * writes across RLS-protected tables.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// --- config -----------------------------------------------------------------

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const REPORT_ONLY = process.argv.includes('--report');

/** Marks everything this script creates, so it can be found and removed later. */
const SEED_TAG = 'kithly-demo';

// --- placeholder imagery ----------------------------------------------------

const PALETTES = [
  ['#F97316', '#FDBA74'], ['#0EA5E9', '#7DD3FC'], ['#10B981', '#6EE7B7'],
  ['#8B5CF6', '#C4B5FD'], ['#EF4444', '#FCA5A5'], ['#F59E0B', '#FCD34D'],
  ['#EC4899', '#F9A8D4'], ['#14B8A6', '#5EEAD4'],
];

/** Stable colour per name, so the same product always looks the same. */
function paletteFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

function svgFor(name, subtitle, variant = 0) {
  const [a, b] = paletteFor(name + variant);
  const label = name.length > 26 ? name.slice(0, 25) + '…' : name;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <circle cx="880" cy="200" r="260" fill="#ffffff" opacity="0.10"/>
  <circle cx="180" cy="920" r="200" fill="#ffffff" opacity="0.08"/>
  <text x="60" y="880" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="62"
        font-weight="700" fill="#ffffff">${escapeXml(label)}</text>
  <text x="62" y="946" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="34"
        fill="#ffffff" opacity="0.85">${escapeXml(subtitle)}</text>
</svg>`;
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Uploads a placeholder and returns its public URL.
 *
 * Content-addressed by name so re-running overwrites the same object instead of
 * accumulating orphans, and so a given product keeps a stable URL.
 */
async function placeholder(name, subtitle, variant = 0) {
  const path = `seed/${slugify(name)}${variant ? `-${variant}` : ''}.svg`;
  const body = new Blob([svgFor(name, subtitle, variant)], { type: 'image/svg+xml' });
  const { error } = await db.storage
    .from('storefront-assets')
    .upload(path, body, { contentType: 'image/svg+xml', upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  return `${URL_}/storage/v1/object/public/storefront-assets/${path}`;
}

export { db, placeholder, slugify, SEED_TAG, REPORT_ONLY };
