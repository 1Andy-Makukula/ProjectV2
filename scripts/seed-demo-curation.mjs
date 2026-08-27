/**
 * Curated layers on top of the catalogue: experiences and lists.
 *
 * Run after seed-demo-run.mjs, because both reference items by name and need
 * the catalogue to exist first.
 *
 *   node scripts/seed-demo-curation.mjs
 *
 * An experience is several shops' items bundled behind one deadline -- the
 * thing checkout_init_atomic reads an experience_id for, and which has never
 * had a row to exercise it. A list is a shareable collection with a reason
 * attached, which is what lists.description is for.
 *
 * Idempotent on slug.
 */
import { db, placeholder, slugify } from './seed-demo-data.mjs';

/** Items are referenced by name; the seeder resolves them to ids at run time. */
const EXPERIENCES = [
  {
    name: 'The Birthday Package',
    tagline: 'Everything for a party, from one link.',
    description:
      'Cake, photography and the cleanup afterwards. Chosen so one gift covers the ' +
      'whole day rather than a single moment of it.',
    days: 45,
    items: [['Birthday Party Coverage', 1], ['Post-Event Cleanup', 1], ['Vegetable Box (Weekly)', 1]],
  },
  {
    name: 'New Home Starter',
    tagline: 'The unglamorous things nobody buys themselves.',
    description:
      'Moving in is expensive in small ways. This covers the first deep clean, ' +
      'something green for the windowsill, and power that does not depend on the grid.',
    days: 60,
    items: [['Deep Clean (3 Bedroom)', 1], ['Indoor Plant Set', 1], ['Solar Home Kit 200W', 1]],
  },
  {
    name: 'Wedding Season',
    tagline: 'For the couple, before the day.',
    description:
      'Photography and tailoring booked early, because both are the things that ' +
      'get harder to arrange the closer the date comes.',
    days: 90,
    items: [['Wedding Photography', 1], ['Made-to-Measure Fitting', 2]],
  },
  {
    name: 'Stock Up Month',
    tagline: 'A month of staples at depot prices.',
    description:
      'Bulk quantities of the things a household runs out of. Priced at the ' +
      'quantity breaks rather than the shelf rate.',
    days: 30,
    items: [['Mealie Meal 25kg', 10], ['Cooking Oil 20L', 6], ['Rice 25kg', 8]],
  },
  {
    name: 'Care Package Home',
    tagline: 'Sent from abroad, collected in person.',
    description:
      'Groceries and fresh produce a family can collect the same week. Built for ' +
      'sending from outside Zambia without guessing what is in stock.',
    days: 21,
    items: [['Vegetable Box (Weekly)', 1], ['Free Range Eggs (Tray)', 2], ['Fresh Milk 2L', 2], ['Tomatoes 5kg', 1]],
  },
];

const LISTS = [
  {
    title: 'Braai at Ours',
    description:
      'What we actually buy when people are coming over. The turf is not a joke — ' +
      'we replaced the patch by the grill twice last year.',
    items: ['Tomatoes 5kg', 'Avocado Crate', 'Bottled Water 500ml x24', 'Lawn Turf per sqm'],
  },
  {
    title: 'Setting Up a Small Shop',
    description:
      'If you are starting a tuck shop, this is the order I wish someone had shown me. ' +
      'Buy the sacks with the beans, not after.',
    items: ['Mealie Meal 25kg', 'Sugar 50kg', 'Laundry Soap Carton', 'Packaging Sacks 100pc', 'Dried Beans 50kg'],
  },
  {
    title: 'Load-Shedding Kit',
    description:
      'Ranked by how much you notice them missing. The power bank matters more than ' +
      'people expect, because the phone is the torch.',
    items: ['Solar Home Kit 200W', 'Power Bank 20000mAh', 'Bluetooth Speaker'],
  },
  {
    title: 'For a New Baby',
    description:
      'Practical rather than sentimental. New parents get plenty of soft toys and ' +
      'not enough clean laundry.',
    items: ['Laundry Service (10kg)', 'Deep Clean (3 Bedroom)', 'Fresh Milk 2L'],
  },
  {
    title: 'Looking Sharp for Lobola',
    description:
      'Booked in this order — the fitting needs a week, so start there and let the ' +
      'photographer follow the date.',
    items: ['Made-to-Measure Fitting', 'Tailored Shirt', 'Chitenge Wrap Dress', 'Family Portrait Session'],
  },
  {
    title: 'Office Opening Day',
    description:
      'The cleaning and the photos are the two things people forget until the morning of.',
    items: ['Office Cleaning (Weekly)', 'Product Photography', 'Indoor Plant Set', 'Garden Design Consultation'],
  },
];

// --- run --------------------------------------------------------------------

async function itemIndex() {
  const { data, error } = await db.from('items').select('id, name, image_url');
  if (error) throw new Error(`items: ${error.message}`);
  return new Map(data.map((i) => [i.name, i]));
}

/** The platform account that owns curated lists. */
async function adminUserId() {
  const { data } = await db.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle();
  return data?.id ?? null;
}

async function seedExperiences(items) {
  let made = 0;
  for (const def of EXPERIENCES) {
    const slug = slugify(def.name);
    const { data: existing } = await db.from('experiences').select('id').eq('slug', slug).maybeSingle();
    // An experience with no items is worse than none: it renders as an empty
    // bundle. A partially-created one is repaired rather than skipped, since
    // "exists" and "is complete" are different questions.
    if (existing) {
      const { count } = await db.from('experience_items')
        .select('*', { count: 'exact', head: true }).eq('experience_id', existing.id);
      if (count && count > 0) { console.log(`exists   experience: ${def.name}`); continue; }
      console.log(`repair   experience: ${def.name} (was empty)`);
      const repair = def.items
        .map(([name, qty], i) => ({ item: items.get(name), quantity: qty, sort_order: i }))
        .filter((l) => l.item)
        .map((l) => ({ experience_id: existing.id, item_id: l.item.id, quantity: l.quantity, sort_order: l.sort_order }));
      const { error: rErr } = await db.from('experience_items').insert(repair);
      if (rErr) console.warn(`  ${def.name}: ${rErr.message}`); else made++;
      continue;
    }

    const lines = def.items
      .map(([name, qty]) => ({ item: items.get(name), quantity: qty }))
      .filter((l) => l.item);

    if (lines.length !== def.items.length) {
      console.warn(`  skipped ${def.name}: not all items exist yet`);
      continue;
    }

    const image = await placeholder(def.name, def.tagline);
    const expires = new Date(Date.now() + def.days * 864e5).toISOString();

    const { data, error } = await db.from('experiences').insert({
      name: def.name, slug, tagline: def.tagline, description: def.description,
      image_url: image, expires_at: expires,
    }).select('id').single();
    if (error) { console.warn(`  ${def.name}: ${error.message}`); continue; }

    // Inserted directly rather than through set_experience_items, which gates
    // on auth.uid() -- a service-role connection has no authenticated user, so
    // the RPC refuses. The RPC's value is replacing a whole set atomically,
    // which does not apply when the experience was created moments ago and is
    // still empty.
    const rows = lines.map((l, i) => ({
      experience_id: data.id, item_id: l.item.id, quantity: l.quantity, sort_order: i,
    }));
    const { error: itemsErr } = await db.from('experience_items').insert(rows);
    if (itemsErr) { console.warn(`  ${def.name} items: ${itemsErr.message}`); continue; }

    console.log(`created  experience: ${def.name} (${lines.length} items, ${def.days}d)`);
    made++;
  }
  return made;
}

async function seedLists(items, ownerId) {
  let made = 0;
  for (const def of LISTS) {
    const { data: slug, error: slugErr } = await db.rpc('generate_list_slug', { p_title: def.title });
    if (slugErr) { console.warn(`  slug ${def.title}: ${slugErr.message}`); continue; }

    const { data: existing } = await db.from('lists').select('id').eq('title', def.title).maybeSingle();
    if (existing) { console.log(`exists   list: ${def.title}`); continue; }

    const { data, error } = await db.from('lists').insert({
      slug, title: def.title, description: def.description,
      owner_user_id: ownerId,
      // 'community' is what the Lists browse feed filters on -- 'private' and
      // 'link' are deliberately excluded from browsing. Platform-owned because
      // these are editorial rather than somebody's private wishlist.
      visibility: 'community', is_platform: true,
    }).select('id').single();
    if (error) { console.warn(`  ${def.title}: ${error.message}`); continue; }

    let order = 0, added = 0;
    for (const name of def.items) {
      const it = items.get(name);
      if (!it) continue;
      // snapshot_name and snapshot_image_url so a deleted item leaves a
      // readable entry rather than a blank row.
      const { error: liErr } = await db.from('list_items').insert({
        list_id: data.id, item_id: it.id,
        snapshot_name: it.name, snapshot_image_url: it.image_url,
        sort_order: order++,
      });
      if (!liErr) added++;
    }
    console.log(`created  list: ${def.title} (${added} items)`);
    made++;
  }
  return made;
}

async function main() {
  const items = await itemIndex();
  const owner = await adminUserId();
  if (!owner) console.warn('no admin user found; lists will be created unowned');

  const exp = await seedExperiences(items);
  const lists = await seedLists(items, owner);

  const counts = {};
  for (const t of ['experiences', 'experience_items', 'lists', 'list_items']) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true });
    counts[t] = count;
  }
  console.log(`\nnew this run: ${exp} experiences, ${lists} lists`);
  console.log('totals:', counts);
}

main().catch((e) => { console.error('CURATION FAILED:', e.message); process.exit(1); });
