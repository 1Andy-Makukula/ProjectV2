// Local art for the category tiles, keyed by slug.
//
// WHY THIS EXISTS ALONGSIDE categories.image_url
// The database column is canonical and an admin's upload must always win --
// see 20260919000000_category_tile_art, which sets it for these same nine.
// This is the fallback underneath it, and it earns its place twice:
//
//   1. The migration is not applied yet, and a front door that shows nothing
//      until somebody runs SQL is a front door that looks broken.
//   2. It supplies EXTRA frames. `image_url` is one column and holds one
//      picture; a tile that breathes needs two or more, and there is nowhere
//      in the schema to put the second one. Adding a category_images table for
//      platform furniture would be a lot of machinery for a handful of files
//      that ship with the build.
//
// The merge rule lives in `categoryFrames` below: the database picks the
// cover, this fills in behind it, and neither can silently replace the other.

/** Slug → frames, cover first. Every file is <= 98KB per the charter. */
export const CATEGORY_ART: Record<string, string[]> = {
  groceries: ['/categories/groceries.jpg', '/categories/groceries-2.jpg'],
  catering: ['/categories/catering.jpg'],
  womenswear: ['/categories/womenswear.jpg'],
  furniture: ['/categories/furniture.jpg'],
  pharmacy: ['/categories/pharmacy.jpg'],
  'home-appliances': ['/categories/home-appliances.jpg'],
  'tools-hardware': ['/categories/tools-hardware.jpg'],
  'laundry-dry-cleaning': ['/categories/laundry.jpg'],
  'meat-poultry': ['/categories/meat-poultry.jpg'],
};

/**
 * The frames for one category tile.
 *
 * The database's cover leads when it has one, and the local set fills in
 * behind it without repeating whatever the database already named. A category
 * nobody has given art to returns an empty array, and the mosaic draws it as
 * an ink block carrying the name -- which is a composition, not a failure.
 */
export function categoryFrames(slug: string, imageUrl: string | null): string[] {
  const local = CATEGORY_ART[slug] ?? [];
  if (!imageUrl) return local;
  return [imageUrl, ...local.filter((frame) => frame !== imageUrl)];
}
