/**
 * Demo catalogue and the routine that plants it.
 *
 * Content lives at the top so it can be read and edited without wading through
 * upsert logic. Feature coverage is deliberate: between them these entries
 * exercise quantity-break pricing, item options, multi-image galleries,
 * scheduling with lead times, quote-only services, discounts and stock sitting
 * near the low-stock threshold -- all of which existed in the schema with no
 * data behind them.
 *
 *   node scripts/seed-demo-run.mjs
 *
 * Idempotent: every entity is keyed on a stable natural key and skipped if
 * already present, so re-running tops up rather than duplicating.
 */
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { db, placeholder, slugify } from './seed-demo-data.mjs';

// --- catalogue --------------------------------------------------------------

const SHOPS = [
  {
    name: 'ZAMBEZI WHOLESALE DEPOT', location: 'Lusaka', wholesale: true,
    email: 'zambezi.wholesale@kithly.demo', products: true, services: false,
    items: [
      { n: 'Mealie Meal 25kg', c: 'groceries', p: 28500, s: 180, tiers: [[10, 26500], [50, 24900]], moq: 5,
        d: 'Breakfast mealie meal, 25kg bag. Depot pricing on pallets.' },
      { n: 'Cooking Oil 20L', c: 'groceries', p: 62000, s: 90, tiers: [[6, 58500], [24, 55000]], moq: 2,
        d: 'Refined sunflower cooking oil, 20 litre jerrican.' },
      { n: 'Sugar 50kg', c: 'groceries', p: 78000, s: 60, tiers: [[5, 74000], [20, 70500]], d: 'White refined sugar.' },
      { n: 'Laundry Soap Carton', c: 'cleaning-supplies', p: 19500, s: 240, tiers: [[10, 18000], [40, 16500]],
        d: 'Carton of 24 bars. Popular with resellers.' },
      { n: 'Bottled Water 500ml x24', c: 'beverages', p: 8500, s: 400, tiers: [[20, 7800], [100, 7100]],
        d: 'Shrink-wrapped case of 24.' },
      { n: 'Rice 25kg', c: 'groceries', p: 46000, s: 75, tiers: [[8, 43500]], d: 'Long grain white rice.' },
    ],
  },
  {
    name: 'SUNRISE BULK FOODS', location: 'Ndola', wholesale: true,
    email: 'sunrise.bulk@kithly.demo', products: true, services: false,
    items: [
      { n: 'Dried Beans 50kg', c: 'groceries', p: 89000, s: 40, tiers: [[4, 85000], [12, 81000]],
        d: 'Sugar beans, cleaned and graded.' },
      { n: 'Groundnuts 25kg', c: 'fresh-produce', p: 54000, s: 32, tiers: [[5, 51000]], d: 'Shelled and sorted.' },
      { n: 'Maize Bran 40kg', c: 'agriculture-farming', p: 21000, s: 120, tiers: [[15, 19500], [60, 18000]],
        d: 'Livestock feed grade maize bran.' },
      { n: 'Packaging Sacks 100pc', c: 'wholesale-bulk', p: 12500, s: 8, tiers: [[10, 11500]],
        d: 'Woven polypropylene sacks, 50kg capacity.' },
    ],
  },
  {
    name: 'KAFUE FRESH GROCERS', location: 'Lusaka',
    email: 'kafue.fresh@kithly.demo', products: true, services: false,
    items: [
      { n: 'Vegetable Box (Weekly)', c: 'fresh-produce', p: 18500, s: 25, d: 'Seasonal mixed vegetables.',
        opts: [{ label: 'Box size', required: true, choices: [['Small', 0], ['Medium', 4500], ['Large', 9000]] }] },
      { n: 'Free Range Eggs (Tray)', c: 'dairy-eggs', p: 8900, s: 6, d: 'Tray of 30, from Chisamba farms.' },
      { n: 'Fresh Milk 2L', c: 'dairy-eggs', p: 5200, s: 48, d: 'Pasteurised full cream.' },
      { n: 'Tomatoes 5kg', c: 'fresh-produce', p: 7500, s: 30, d: 'Firm salad tomatoes.' },
      { n: 'Avocado Crate', c: 'fresh-produce', p: 16000, s: 12, d: 'Roughly 40 avocados, in season.' },
    ],
  },
  {
    name: 'LUSAKA TECH HUB', location: 'Lusaka',
    email: 'lusaka.tech@kithly.demo', products: true, services: true,
    items: [
      { n: 'Solar Home Kit 200W', c: 'solar-power', p: 289000, s: 7, imgs: 3,
        d: 'Panel, inverter, battery and wiring. Runs lights, TV and phone charging.' },
      { n: 'Power Bank 20000mAh', c: 'phone-accessories', p: 32000, s: 40, was: 39000, d: 'Fast charge, dual USB-C.' },
      { n: 'Bluetooth Speaker', c: 'audio-headphones', p: 45000, s: 4, d: 'Water resistant, 12 hour battery.' },
      { n: 'Laptop Sleeve 15 inch', c: 'computers-laptops', p: 15000, s: 22, d: 'Padded, water resistant.' },
      { n: 'Phone Screen Replacement', c: 'electronics-repair', p: 42000, svc: true, lead: 1,
        d: 'Same-day screen replacement for common models.' },
      { n: 'Laptop Servicing', c: 'it-support', p: 38000, svc: true, lead: 2,
        d: 'Full clean, thermal paste, OS tune-up and health report.' },
    ],
  },
  {
    name: 'CHITENGE & CO', location: 'Livingstone',
    email: 'chitenge.co@kithly.demo', products: true, services: true,
    items: [
      { n: 'Chitenge Wrap Dress', c: 'traditional-attire', p: 68000, s: 9, imgs: 3,
        d: 'Hand-finished wrap dress in seasonal print.',
        opts: [{ label: 'Size', required: true, choices: [['S', 0], ['M', 0], ['L', 0], ['XL', 4000]] }] },
      { n: 'Chitenge Fabric 6 Yards', c: 'fabric-textiles', p: 24000, s: 35, tiers: [[5, 22000], [20, 19500]],
        d: 'Full six-yard length, wax print.' },
      { n: 'Tailored Shirt', c: 'menswear', p: 41000, s: 14, d: 'Cotton shirt with chitenge trim.' },
      { n: 'Made-to-Measure Fitting', c: 'tailoring-alterations', p: 55000, svc: true, lead: 7,
        d: 'Measurement, fitting and finished garment. Two appointments.' },
      { n: 'Alterations', c: 'tailoring-alterations', p: 12000, svc: true, lead: 2,
        d: 'Hemming, taking in, zip replacement.' },
    ],
  },
  {
    name: 'MOMENTS PHOTOGRAPHY', location: 'Lusaka',
    email: 'moments.photo@kithly.demo', products: false, services: true,
    items: [
      { n: 'Birthday Party Coverage', c: 'photography', p: 145000, svc: true, lead: 3, imgs: 2,
        d: 'Four hours of coverage, 80+ edited images delivered within a week.',
        opts: [{ label: 'Coverage length', required: true,
          choices: [['4 hours', 0], ['6 hours', 45000], ['Full day', 110000]] }] },
      { n: 'Wedding Photography', c: 'weddings', p: 480000, svc: true, lead: 21, quote: true,
        d: 'Full-day coverage, two photographers, album included.' },
      { n: 'Family Portrait Session', c: 'photography', p: 85000, svc: true, lead: 3,
        d: 'Studio or outdoor, one hour, 20 edited images.' },
      { n: 'Product Photography', c: 'photography', p: 12000, svc: true, lead: 4, tiers: [[10, 10500], [30, 9000]],
        d: 'Per product, white background, e-commerce ready.' },
    ],
  },
  {
    name: 'GREENLEAF LANDSCAPING', location: 'Lusaka',
    email: 'greenleaf.land@kithly.demo', products: true, services: true,
    items: [
      { n: 'Garden Maintenance (Monthly)', c: 'gardening-landscaping', p: 95000, svc: true, lead: 5,
        d: 'Fortnightly visits, mowing, pruning and bed care.' },
      { n: 'Garden Design Consultation', c: 'gardening-landscaping', p: 65000, svc: true, lead: 7,
        d: 'Site visit, planting plan and costed proposal.' },
      { n: 'Indoor Plant Set', c: 'garden-outdoor', p: 34000, s: 11, d: 'Three potted plants chosen for low light.' },
      { n: 'Lawn Turf per sqm', c: 'garden-outdoor', p: 2200, s: 500, tiers: [[50, 2000], [200, 1750]],
        d: 'Kikuyu turf, cut fresh on the day.' },
    ],
  },
  {
    name: 'BUSY BEE CLEANING', location: 'Kitwe',
    email: 'busybee.clean@kithly.demo', products: false, services: true,
    items: [
      { n: 'Deep Clean (3 Bedroom)', c: 'cleaning-services', p: 78000, svc: true, lead: 2,
        d: 'Full deep clean including kitchen, bathrooms and windows.',
        opts: [{ label: 'Add-ons', required: false, multi: true,
          choices: [['Inside oven', 12000], ['Inside fridge', 9000], ['Balcony', 8000]] }] },
      { n: 'Office Cleaning (Weekly)', c: 'cleaning-services', p: 155000, svc: true, lead: 5,
        d: 'Weekly visits for offices up to 200 square metres.' },
      { n: 'Post-Event Cleanup', c: 'cleaning-services', p: 62000, svc: true, lead: 1,
        d: 'Same-day or next-morning cleanup after a function.' },
      { n: 'Laundry Service (10kg)', c: 'laundry-dry-cleaning', p: 18000, svc: true, lead: 2,
        d: 'Wash, dry and fold, with collection and delivery.' },
    ],
  },
];

// --- helpers ----------------------------------------------------------------

let CATS = new Map();

async function loadCategories() {
  const { data, error } = await db.from('categories').select('id, slug');
  if (error) throw new Error(`categories: ${error.message}`);
  CATS = new Map(data.map((c) => [c.slug, c.id]));
  return CATS.size;
}

/**
 * An auth user to own a shop.
 *
 * public.users.id is a foreign key onto auth.users and a signup trigger creates
 * the profile row, so going through the admin API exercises the same path a
 * real merchant signup does rather than a shape only a script can produce.
 */
/**
 * A throwaway password for a seeded demo owner.
 *
 * These create real auth.users rows, so the value has to be unguessable even
 * though the account is disposable. Was `Math.random().toString(36)`, which is
 * both non-cryptographic and only ~41 bits before the suffix.
 */
function demoPassword() {
  return `Demo!${randomBytes(12).toString('base64url')}A1`;
}

async function ensureOwner(email, name) {
  const { data: existing } = await db.from('users').select('id').eq('email', email).maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await db.auth.admin.createUser({
    email, password: demoPassword(), email_confirm: true,
  });
  if (error || !data.user) throw new Error(`owner ${email}: ${error?.message}`);

  await db.from('users').upsert({ id: data.user.id, name, email, role: 'merchant' }, { onConflict: 'id' });
  return data.user.id;
}

async function ensureShop(def) {
  const { data: existing } = await db.from('shops').select('id').eq('name', def.name).maybeSingle();
  if (existing) return { id: existing.id, created: false };

  const ownerId = await ensureOwner(def.email, def.name);
  const logo = await placeholder(`${def.name} logo`, def.location);
  const cover = await placeholder(`${def.name} cover`, def.location, 2);

  const { data, error } = await db.from('shops').insert({
    name: def.name,
    location: def.location,
    shop_location: def.location,
    owner_id: ownerId,
    image_url: logo,
    logo_url: logo,
    cover_image_url: cover,
    // Demo shops are approved and live. A real registration starts inactive and
    // pending until an admin reviews it -- that gate is deliberately bypassed
    // here because the point is a browsable storefront, not a review queue.
    is_active: true,
    verification_status: 'approved',
    application_status: 'APPROVED',
    offers_products: def.products,
    offers_services: def.services,
  }).select('id').single();
  if (error) throw new Error(`shop ${def.name}: ${error.message}`);

  await db.from('merchant_shops').insert({ user_id: ownerId, shop_id: data.id });
  return { id: data.id, created: true };
}

async function ensureItem(shopId, shopName, it) {
  const { data: existing } = await db.from('items')
    .select('id').eq('shop_id', shopId).eq('name', it.n).maybeSingle();
  if (existing) return false;

  const img = await placeholder(it.n, shopName);
  const { data, error } = await db.from('items').insert({
    shop_id: shopId,
    name: it.n,
    description: it.d,
    price_zmw: it.p,
    original_price_zmw: it.was ?? null,
    is_discounted: Boolean(it.was),
    image_url: img,
    is_available: true,
    item_type: it.svc ? 'service' : 'product',
    // A service has no stock to count; leaving it null is what "unlimited"
    // means to checkout_init_atomic, which skips reservation entirely.
    stock_quantity: it.svc ? null : (it.s ?? null),
    requires_scheduling: Boolean(it.svc),
    lead_time_days: it.lead ?? null,
    is_quote_only: Boolean(it.quote),
    minimum_order_quantity: it.moq ?? 1,
    category_id: CATS.get(it.c) ?? null,
  }).select('id').single();
  if (error) throw new Error(`item ${it.n}: ${error.message}`);

  // Extra gallery images, so the multi-image viewer has something to show.
  for (let i = 1; i <= (it.imgs ?? 0); i++) {
    const url = await placeholder(it.n, shopName, i);
    await db.from('item_images').insert({ item_id: data.id, image_url: url, sort_order: i });
  }

  for (const [minQty, unit] of it.tiers ?? []) {
    await db.from('item_price_tiers').insert({
      item_id: data.id, min_quantity: minQty, unit_price_zmw: unit,
    });
  }

  for (const group of it.opts ?? []) {
    const { data: g, error: gErr } = await db.from('item_option_groups').insert({
      item_id: data.id, label: group.label,
      // kind is 'choice' or 'quantity'; multi-select is a choice group with
      // allow_multiple set, not a third kind.
      kind: 'choice',
      allow_multiple: Boolean(group.multi),
      is_required: Boolean(group.required),
    }).select('id').single();
    if (gErr) { console.warn(`  option group skipped (${group.label}): ${gErr.message}`); continue; }

    let order = 0;
    for (const [label, delta] of group.choices) {
      await db.from('item_options').insert({
        group_id: g.id, label, price_delta_zmw: delta, sort_order: order++,
      });
    }
  }
  return true;
}

// --- run --------------------------------------------------------------------

async function main() {
  const catCount = await loadCategories();
  console.log(`categories available: ${catCount}`);

  let shopsMade = 0, itemsMade = 0;
  for (const def of SHOPS) {
    const { id, created } = await ensureShop(def);
    if (created) shopsMade++;
    console.log(`${created ? 'created' : 'exists '}  ${def.name}`);
    for (const it of def.items) {
      if (await ensureItem(id, def.name, it)) itemsMade++;
    }
  }

  const counts = {};
  for (const t of ['shops', 'items', 'categories', 'item_price_tiers', 'item_images', 'item_option_groups']) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true });
    counts[t] = count;
  }
  console.log(`\nnew this run: ${shopsMade} shops, ${itemsMade} items`);
  console.log('totals:', counts);
}

export { SHOPS };

// Only run when executed directly -- importing SHOPS for the photo backfill
// script must not also replay the whole seeding routine as a side effect.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
}
