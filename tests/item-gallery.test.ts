import { describe, it, expect } from 'vitest';
import {
  MAX_ITEM_IMAGES,
  canAddImages,
  planGalleryWrite,
  reorderGallery,
  type StoredImage,
} from '../src/utils/itemGallery';
import { galleryUrls } from '../src/app/types/items';

const stored: StoredImage[] = [
  { id: 'a', url: 'https://cdn/1.webp' },
  { id: 'b', url: 'https://cdn/2.webp' },
  { id: 'c', url: 'https://cdn/3.webp' },
];

describe('planGalleryWrite', () => {
  it('leaves an untouched gallery alone', () => {
    const plan = planGalleryWrite(stored, stored.map((s) => ({ id: s.id, url: s.url })));
    expect(plan.removedIds).toEqual([]);
    expect(plan.orphanedUrls).toEqual([]);
    expect(plan.coverUrl).toBe('https://cdn/1.webp');
  });

  it('removes the rows whose images are gone, and orphans their files', () => {
    const plan = planGalleryWrite(stored, [{ id: 'b', url: 'https://cdn/2.webp' }]);
    expect(plan.removedIds).toEqual(['a', 'c']);
    expect(plan.orphanedUrls).toEqual(['https://cdn/1.webp', 'https://cdn/3.webp']);
  });

  it('reports the reordered cover', () => {
    const plan = planGalleryWrite(stored, [
      { id: 'c', url: 'https://cdn/3.webp' },
      { id: 'a', url: 'https://cdn/1.webp' },
    ]);
    expect(plan.coverUrl).toBe('https://cdn/3.webp');
  });

  // sync_item_cover deliberately keeps the last cover when the gallery empties,
  // so items.image_url still points at one of these files. Deleting it would
  // leave a broken image across the catalogue.
  it('orphans nothing when the gallery is emptied', () => {
    const plan = planGalleryWrite(stored, []);
    expect(plan.removedIds).toEqual(['a', 'b', 'c']);
    expect(plan.orphanedUrls).toEqual([]);
    expect(plan.coverUrl).toBeNull();
  });

  it('treats a newly uploaded image as an addition, not a replacement', () => {
    const plan = planGalleryWrite(stored, [
      ...stored.map((s) => ({ id: s.id, url: s.url })),
      { url: 'https://cdn/4.webp' },
    ]);
    expect(plan.removedIds).toEqual([]);
    expect(plan.coverUrl).toBe('https://cdn/1.webp');
  });
});

describe('canAddImages', () => {
  it('permits filling up to the cap exactly', () => {
    expect(canAddImages(0, MAX_ITEM_IMAGES)).toBe(true);
    expect(canAddImages(3, 2)).toBe(true);
  });

  it('refuses to exceed the cap', () => {
    expect(canAddImages(3, 3)).toBe(false);
    expect(canAddImages(MAX_ITEM_IMAGES, 1)).toBe(false);
  });
});

describe('reorderGallery', () => {
  const entries = [{ url: 'a' }, { url: 'b' }, { url: 'c' }];

  it('promotes an image to cover', () => {
    expect(reorderGallery(entries, 2, 0).map((e) => e.url)).toEqual(['c', 'a', 'b']);
  });

  it('ignores out-of-range and no-op moves', () => {
    expect(reorderGallery(entries, 1, 1)).toBe(entries);
    expect(reorderGallery(entries, 0, 9)).toBe(entries);
    expect(reorderGallery(entries, -1, 0)).toBe(entries);
  });
});

describe('galleryUrls', () => {
  it('falls back to the cover alone when there is no gallery', () => {
    expect(galleryUrls({ image_url: 'https://cdn/1.webp' })).toEqual(['https://cdn/1.webp']);
  });

  it('returns nothing for an item with no images at all', () => {
    expect(galleryUrls({ image_url: null, item_images: [] })).toEqual([]);
  });

  it('orders by sort_order and does not repeat the cover', () => {
    expect(
      galleryUrls({
        image_url: 'https://cdn/1.webp',
        item_images: [
          { image_url: 'https://cdn/3.webp', sort_order: 2 },
          { image_url: 'https://cdn/1.webp', sort_order: 0 },
          { image_url: 'https://cdn/2.webp', sort_order: 1 },
        ],
      }),
    ).toEqual(['https://cdn/1.webp', 'https://cdn/2.webp', 'https://cdn/3.webp']);
  });

  it('still leads with the cover if the trigger has not caught up', () => {
    // image_url out of step with sort_order 0 should not drop either image.
    expect(
      galleryUrls({
        image_url: 'https://cdn/9.webp',
        item_images: [{ image_url: 'https://cdn/1.webp', sort_order: 0 }],
      }),
    ).toEqual(['https://cdn/9.webp', 'https://cdn/1.webp']);
  });
});
