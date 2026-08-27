/**
 * Replaces the demo seed's generated colour-gradient placeholders with real,
 * freely-licensed photographs pulled from Wikimedia Commons.
 *
 * Scope is deliberately narrow: this only touches rows whose image URL still
 * points at `storefront-assets/seed/...svg` -- the signature of the synthetic
 * placeholder from seed-demo-data.mjs. Shops and items with a real uploaded
 * photo (the seven pre-existing shops, anything a merchant has actually
 * uploaded through the app) never match that pattern and are left untouched.
 * Every write additionally re-asserts the placeholder-URL filter in the WHERE
 * clause, so even a bug in the selection logic above it can't overwrite a real
 * photo.
 *
 * Images are real stock photography, not the merchant's own product photos --
 * fine for judging navigation and layout, not a substitute for a shop
 * uploading its actual goods before a real launch.
 *
 *   node scripts/seed-real-photos.mjs
 */
import { db, slugify } from './seed-demo-data.mjs';
import { SHOPS } from './seed-demo-run.mjs';

const UA = 'KithlyDemoSeeder/1.0 (private demo content; contact andy.makukula@gmail.com)';
const PLACEHOLDER = '/seed/';

// --- Commons search -----------------------------------------------------

/** In-memory cache: keyword -> candidate image URLs, so shared categories only search once. */
const searchCache = new Map();

async function searchCommons(keyword) {
  if (searchCache.has(keyword)) return searchCache.get(keyword);

  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search' +
    `&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(keyword + ' filetype:bitmap')}` +
    '&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1080';

  const res = await fetch(api, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`commons search "${keyword}": HTTP ${res.status}`);
  const json = await res.json();
  const pages = Object.values(json.query?.pages ?? {});

  const candidates = pages
    .map((p) => p.imageinfo?.[0])
    .filter((ii) => ii && /^image\/(jpeg|png)$/.test(ii.mime))
    .filter((ii) => (ii.thumbwidth ?? ii.width) >= 500)
    .map((ii) => ii.thumburl ?? ii.url);

  searchCache.set(keyword, candidates);
  return candidates;
}

/** Stable pick per name, so re-runs are deterministic and items vary within a category. */
function hash(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

async function fetchPhoto(keyword, seedName, variant = 0) {
  const candidates = await searchCommons(keyword);
  if (candidates.length === 0) throw new Error(`no Commons results for "${keyword}"`);
  const url = candidates[(hash(seedName) + variant) % candidates.length];
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get('content-type') ?? 'image/jpeg';
  return { buf, ext: mime.includes('png') ? 'png' : 'jpg', mime };
}

async function uploadReal(pathBase, keyword, seedName, variant = 0) {
  const { buf, ext, mime } = await fetchPhoto(keyword, seedName, variant);
  const path = `photos/${pathBase}.${ext}`;
  const { error } = await db.storage
    .from('storefront-assets')
    .upload(path, buf, { contentType: mime, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  return db.storage.from('storefront-assets').getPublicUrl(path).data.publicUrl;
}

// --- keyword maps ---------------------------------------------------------

const SHOP_KEYWORDS = {
  'ZAMBEZI WHOLESALE DEPOT': 'warehouse pallets forklift',
  'SUNRISE BULK FOODS': 'sacks of grain warehouse',
  'KAFUE FRESH GROCERS': 'fresh produce grocery market stall',
  'LUSAKA TECH HUB': 'electronics shop gadgets store',
  'CHITENGE & CO': 'ankara fabric market',
  'MOMENTS PHOTOGRAPHY': 'photography studio camera',
  'GREENLEAF LANDSCAPING': 'garden landscaping nursery',
  'BUSY BEE CLEANING': 'cleaning service supplies',
};

const CATEGORY_KEYWORDS = {
  'groceries': 'grocery store shelves food',
  'cleaning-supplies': 'cleaning supplies detergent',
  'beverages': 'bottled water crates',
  'fresh-produce': 'fresh vegetables market',
  'agriculture-farming': 'maize farm harvest africa',
  'wholesale-bulk': 'warehouse sacks bulk goods',
  'dairy-eggs': 'eggs carton dairy',
  'solar-power': 'solar panel installation',
  'phone-accessories': 'power bank phone charger',
  'audio-headphones': 'bluetooth speaker',
  'computers-laptops': 'laptop bag sleeve',
  'electronics-repair': 'smartphone screen repair',
  'it-support': 'computer technician repair laptop',
  'traditional-attire': 'ankara dress',
  'fabric-textiles': 'ankara fabric market',
  'menswear': 'tailored shirt menswear',
  'tailoring-alterations': 'tailor sewing machine',
  'photography': 'photographer camera portrait',
  'weddings': 'wedding photography couple',
  'gardening-landscaping': 'garden landscaping lawn',
  'garden-outdoor': 'potted plants garden',
  'cleaning-services': 'house cleaning service',
  'laundry-dry-cleaning': 'laundry folding clothes',
};

const EXPERIENCE_KEYWORDS = {
  'The Birthday Package': 'birthday party balloons cake',
  'New Home Starter': 'new home moving boxes furniture',
  'Wedding Season': 'wedding reception decoration',
  'Stock Up Month': 'grocery shopping supplies',
  'Care Package Home': 'gift basket care package',
};

// --- run ------------------------------------------------------------------

let shopsDone = 0, itemsDone = 0, imagesDone = 0, expsDone = 0, failures = 0;

async function run() {
  for (const def of SHOPS) {
    const { data: shop } = await db.from('shops')
      .select('id, logo_url, cover_image_url').eq('name', def.name).maybeSingle();
    if (!shop) { console.warn(`skip (no shop row): ${def.name}`); continue; }

    const keyword = SHOP_KEYWORDS[def.name];
    if (shop.logo_url?.includes(PLACEHOLDER) || shop.cover_image_url?.includes(PLACEHOLDER)) {
      try {
        const slug = slugify(def.name);
        const cover = await uploadReal(`shop-${slug}-cover`, keyword, def.name, 0);
        const logo = await uploadReal(`shop-${slug}-logo`, keyword, def.name, 1);
        const { error } = await db.from('shops')
          .update({ logo_url: logo, cover_image_url: cover, image_url: logo })
          .eq('id', shop.id)
          .or(`logo_url.like.%${PLACEHOLDER}%,cover_image_url.like.%${PLACEHOLDER}%`);
        if (error) throw error;
        shopsDone++;
        console.log(`shop photo: ${def.name}`);
      } catch (e) {
        failures++;
        console.warn(`  FAILED shop ${def.name}: ${e.message}`);
      }
    }

    for (const it of def.items) {
      const { data: item } = await db.from('items')
        .select('id, image_url').eq('shop_id', shop.id).eq('name', it.n).maybeSingle();
      if (!item) { console.warn(`  skip (no item row): ${it.n}`); continue; }

      const itemKeyword = CATEGORY_KEYWORDS[it.c] ?? it.c.replace(/-/g, ' ');
      const itemSeedName = `${def.name}:${it.n}`;

      if (item.image_url?.includes(PLACEHOLDER)) {
        try {
          const path = `item-${slugify(def.name)}-${slugify(it.n)}`;
          const url = await uploadReal(path, itemKeyword, itemSeedName, 0);
          const { error } = await db.from('items')
            .update({ image_url: url })
            .eq('id', item.id)
            .like('image_url', `%${PLACEHOLDER}%`);
          if (error) throw error;
          itemsDone++;
        } catch (e) {
          failures++;
          console.warn(`  FAILED item ${it.n}: ${e.message}`);
        }
      }

      const galleryCount = it.imgs ?? 0;
      if (galleryCount > 0) {
        const { data: rows } = await db.from('item_images')
          .select('id, sort_order, image_url').eq('item_id', item.id).order('sort_order');
        for (const row of rows ?? []) {
          if (!row.image_url?.includes(PLACEHOLDER)) continue;
          try {
            const path = `item-${slugify(def.name)}-${slugify(it.n)}-${row.sort_order}`;
            const url = await uploadReal(path, itemKeyword, itemSeedName, row.sort_order);
            const { error } = await db.from('item_images')
              .update({ image_url: url })
              .eq('id', row.id)
              .like('image_url', `%${PLACEHOLDER}%`);
            if (error) throw error;
            imagesDone++;
          } catch (e) {
            failures++;
            console.warn(`  FAILED gallery ${it.n} #${row.sort_order}: ${e.message}`);
          }
        }
      }
    }
  }

  for (const [name, keyword] of Object.entries(EXPERIENCE_KEYWORDS)) {
    const { data: exp } = await db.from('experiences')
      .select('id, image_url').eq('name', name).maybeSingle();
    if (!exp || !exp.image_url?.includes(PLACEHOLDER)) continue;
    try {
      const url = await uploadReal(`experience-${slugify(name)}`, keyword, name, 0);
      const { error } = await db.from('experiences')
        .update({ image_url: url })
        .eq('id', exp.id)
        .like('image_url', `%${PLACEHOLDER}%`);
      if (error) throw error;
      expsDone++;
      console.log(`experience photo: ${name}`);
    } catch (e) {
      failures++;
      console.warn(`  FAILED experience ${name}: ${e.message}`);
    }
  }

  console.log(`\nreplaced: ${shopsDone} shop(s), ${itemsDone} item(s), ${imagesDone} gallery image(s), ${expsDone} experience(s)`);
  if (failures > 0) console.log(`${failures} failure(s) -- left on placeholder, re-run to retry`);
}

run().catch((e) => { console.error('PHOTO BACKFILL FAILED:', e.message); process.exit(1); });
