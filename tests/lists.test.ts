import { describe, it, expect } from 'vitest';
import {
  ENTRY_UNAVAILABLE_TEXT,
  entryDisplay,
  entryUnavailableReason,
  listAuthorLabel,
  listBuyableTotal,
  listRating,
  listShopCount,
  type ListEntry,
} from '../src/app/types/lists';

function entry(overrides: Partial<ListEntry> = {}): ListEntry {
  return {
    id: 'e1',
    item_id: 'i1',
    snapshot_name: 'Bag of Cement',
    snapshot_image_url: 'https://cdn/snapshot.webp',
    sort_order: 0,
    item: {
      id: 'i1',
      name: 'Bag of Cement 50kg',
      price_zmw: 25000,
      image_url: 'https://cdn/live.webp',
      is_available: true,
      stock_quantity: null,
      shop: { id: 's1', name: 'Lusaka Hardware' },
    },
    ...overrides,
  };
}

// A list outlives the items on it. Every one of these cases must still render
// an entry — a list shared as twelve things arriving as nine, with no
// explanation, is the failure this whole snapshot design exists to prevent.
describe('entryUnavailableReason', () => {
  it('is null for something that can be bought', () => {
    expect(entryUnavailableReason(entry())).toBeNull();
  });

  it('reports a hard-deleted item as removed', () => {
    expect(entryUnavailableReason(entry({ item: null, item_id: null }))).toBe('removed');
  });

  it('reports a delisted item', () => {
    const e = entry();
    expect(entryUnavailableReason({ ...e, item: { ...e.item!, is_available: false } }))
      .toBe('delisted');
  });

  it('reports a tracked zero as out of stock', () => {
    const e = entry();
    expect(entryUnavailableReason({ ...e, item: { ...e.item!, stock_quantity: 0 } }))
      .toBe('out_of_stock');
  });

  it('does not treat untracked stock as out of stock', () => {
    const e = entry();
    expect(entryUnavailableReason({ ...e, item: { ...e.item!, stock_quantity: null } }))
      .toBeNull();
  });

  it('has wording for every reason it can return', () => {
    expect(ENTRY_UNAVAILABLE_TEXT.removed).toBeTruthy();
    expect(ENTRY_UNAVAILABLE_TEXT.delisted).toBeTruthy();
    expect(ENTRY_UNAVAILABLE_TEXT.out_of_stock).toBeTruthy();
  });
});

describe('entryDisplay', () => {
  it('prefers live item data over the snapshot', () => {
    expect(entryDisplay(entry())).toEqual({
      name: 'Bag of Cement 50kg',
      imageUrl: 'https://cdn/live.webp',
    });
  });

  it('falls back to the snapshot once the item is gone', () => {
    expect(entryDisplay(entry({ item: null, item_id: null }))).toEqual({
      name: 'Bag of Cement',
      imageUrl: 'https://cdn/snapshot.webp',
    });
  });
});

describe('listBuyableTotal', () => {
  it('counts only what can actually be bought', () => {
    const available = entry({ id: 'a' });
    const gone = entry({ id: 'b', item: null, item_id: null });
    const soldOut = entry({
      id: 'c',
      item: { ...entry().item!, id: 'i3', stock_quantity: 0 },
    });

    expect(listBuyableTotal([available, gone, soldOut])).toBe(25000);
  });

  it('is zero for a list where nothing survives', () => {
    expect(listBuyableTotal([entry({ item: null, item_id: null })])).toBe(0);
  });
});

// The count that makes a list a list rather than a shop's own collection.
describe('listShopCount', () => {
  it('counts distinct shops', () => {
    const a = entry({ id: 'a' });
    const b = entry({
      id: 'b',
      item: { ...entry().item!, id: 'i2', shop: { id: 's2', name: 'Ndola Grocers' } },
    });
    const c = entry({ id: 'c', item: { ...entry().item!, id: 'i3' } }); // same shop as a

    expect(listShopCount([a, b, c])).toBe(2);
  });

  it('ignores entries whose item is gone', () => {
    expect(listShopCount([entry({ item: null, item_id: null })])).toBe(0);
  });
});

describe('listAuthorLabel', () => {
  const base = {
    is_platform: false,
    is_anonymous: false,
    owner_shop_id: null as string | null,
    shop_name: null as string | null,
    owner_name: 'Chanda',
  };

  it('badges platform lists as KithLy rather than naming the admin', () => {
    expect(listAuthorLabel({ ...base, is_platform: true })).toBe('KithLy');
  });

  it('always names the shop, even when anonymous is set', () => {
    // Commercial content must never be mistakeable for a personal list.
    expect(
      listAuthorLabel({
        ...base,
        is_anonymous: true,
        owner_shop_id: 's1',
        shop_name: 'Lusaka Hardware',
      }),
    ).toBe('Lusaka Hardware');
  });

  it('hides a person behind Anonymous when they asked for it', () => {
    expect(listAuthorLabel({ ...base, is_anonymous: true })).toBe('Anonymous');
  });

  it('names the person otherwise', () => {
    expect(listAuthorLabel(base)).toBe('Chanda');
  });
});

describe('listRating', () => {
  it('is null before anyone has rated', () => {
    expect(listRating({ rating_count: 0, rating_sum: 0 })).toBeNull();
  });

  it('averages to one decimal place', () => {
    expect(listRating({ rating_count: 3, rating_sum: 13 })).toBe(4.3);
    expect(listRating({ rating_count: 2, rating_sum: 9 })).toBe(4.5);
  });
});
