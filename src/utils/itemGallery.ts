/**
 * itemGallery.ts
 *
 * Reconciling an edited gallery against what is already stored.
 *
 * The editor works on an ordered list the merchant can add to, remove from and
 * reorder freely. Turning that into database writes has two traps worth keeping
 * out of the component:
 *
 *   1. Deletes must be issued before inserts. `item_images_cap` counts existing
 *      rows on INSERT, so swapping five images for five others in the other
 *      order trips the cap at the first new row.
 *
 *   2. A removed image's file may only be deleted from storage once something
 *      else is definitely going to be the cover. If the merchant empties the
 *      gallery entirely, `sync_item_cover` deliberately leaves items.image_url
 *      pointing at the last known image — deleting that file would leave the
 *      catalogue rendering a broken picture.
 */

/** Matches the item_images_sort_order_check constraint and the cap trigger. */
export const MAX_ITEM_IMAGES = 5;

export interface StoredImage {
  id: string;
  url: string;
}

export interface GalleryEntry {
  /** Present when this entry is already a row in item_images. */
  id?: string;
  /** Existing public URL, or a local object URL while a new file is pending. */
  url: string;
  /** Present when this entry is a newly chosen file not yet uploaded. */
  file?: File;
}

export interface GalleryPlan {
  /** Rows to delete, before any insert runs. */
  removedIds: string[];
  /** Storage objects that are now unreferenced and safe to delete. */
  orphanedUrls: string[];
  /** The cover the item row should carry, or null to leave it as it is. */
  coverUrl: string | null;
}

/**
 * Works out what to delete and what the cover becomes.
 *
 * `next` must already have its uploads resolved — every entry's `url` is the
 * final public URL, not a local object URL.
 */
export function planGalleryWrite(stored: StoredImage[], next: GalleryEntry[]): GalleryPlan {
  const keptUrls = new Set(next.map((entry) => entry.url));

  const removedIds = stored.filter((row) => !keptUrls.has(row.url)).map((row) => row.id);

  // Emptying the gallery keeps the existing cover, so nothing is orphaned:
  // the file the item still points at must survive.
  const orphanedUrls =
    next.length === 0
      ? []
      : stored.filter((row) => !keptUrls.has(row.url)).map((row) => row.url);

  return {
    removedIds,
    orphanedUrls,
    coverUrl: next[0]?.url ?? null,
  };
}

/** Whether another `count` files would exceed the cap. */
export function canAddImages(current: number, count: number): boolean {
  return current + count <= MAX_ITEM_IMAGES;
}

/** Moves the entry at `from` to `to`, returning a new array. */
export function reorderGallery(entries: GalleryEntry[], from: number, to: number): GalleryEntry[] {
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
    return entries;
  }
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
