import { describe, it, expect } from 'vitest';
import {
  describeSelection,
  draftGroupProblem,
  initialSelection,
  selectionDelta,
  selectionProblem,
  selectionSignature,
  type DraftOptionGroup,
  type ItemOptionGroup,
} from '../src/app/types/itemOptions';

const plates: ItemOptionGroup = {
  id: 'g-plates',
  label: 'Plates',
  kind: 'quantity',
  allow_multiple: false,
  is_required: true,
  min_value: 1,
  max_value: 20,
  unit_price_delta_zmw: 3000,
  sort_order: 0,
  options: [],
};

const drink: ItemOptionGroup = {
  id: 'g-drink',
  label: 'Drink',
  kind: 'choice',
  allow_multiple: false,
  is_required: false,
  min_value: null,
  max_value: null,
  unit_price_delta_zmw: 0,
  sort_order: 1,
  options: [
    { id: 'o-juice', label: 'Juice', price_delta_zmw: 1500, is_available: true, sort_order: 0 },
    { id: 'o-water', label: 'Water', price_delta_zmw: 0, is_available: true, sort_order: 1 },
    { id: 'o-gone', label: 'Discontinued', price_delta_zmw: 900, is_available: false, sort_order: 2 },
  ],
};

const groups = [plates, drink];

// These must agree with resolve_item_selection. The server recomputes the same
// figure at checkout and its answer is what gets charged, so a drift here means
// the buyer is quoted one price and billed another.
describe('selectionDelta', () => {
  it('is zero for an item with no options', () => {
    expect(selectionDelta([], {})).toBe(0);
    expect(selectionDelta(null, {})).toBe(0);
  });

  it('multiplies a quantity group by its per-unit price', () => {
    expect(selectionDelta(groups, { 'g-plates': 6 })).toBe(18000);
  });

  it('adds the chosen option of a choice group', () => {
    expect(selectionDelta(groups, { 'g-drink': ['o-juice'] })).toBe(1500);
  });

  it('combines groups', () => {
    expect(selectionDelta(groups, { 'g-plates': 2, 'g-drink': ['o-juice'] })).toBe(7500);
  });

  it('ignores an option that is no longer available', () => {
    // resolve_item_selection refuses this outright; the client simply must not
    // quote a price for something the server will reject.
    expect(selectionDelta(groups, { 'g-drink': ['o-gone'] })).toBe(0);
  });

  it('ignores a group the item does not have', () => {
    expect(selectionDelta(groups, { 'g-unknown': ['x'] })).toBe(0);
  });
});

describe('selectionProblem', () => {
  it('accepts a complete selection', () => {
    expect(selectionProblem(groups, { 'g-plates': 4 })).toBeNull();
  });

  it('catches a required group left unset', () => {
    expect(selectionProblem(groups, {})).toMatch(/plates/i);
  });

  it('catches a quantity below the minimum', () => {
    expect(selectionProblem(groups, { 'g-plates': 0 })).toMatch(/at least 1/);
  });

  it('catches a quantity above the maximum', () => {
    expect(selectionProblem(groups, { 'g-plates': 50 })).toMatch(/at most 20/);
  });

  it('catches multiple picks in a single-choice group', () => {
    expect(
      selectionProblem(groups, { 'g-plates': 1, 'g-drink': ['o-juice', 'o-water'] }),
    ).toMatch(/only one/i);
  });
});

// The cart merges lines by key. Without a signature, one dish ordered two ways
// would collapse into a single line and the second choice would be lost.
describe('selectionSignature', () => {
  it('is empty when nothing meaningful is chosen', () => {
    expect(selectionSignature({})).toBe('');
    expect(selectionSignature({ 'g-drink': [] })).toBe('');
    expect(selectionSignature({ 'g-plates': 0 })).toBe('');
    expect(selectionSignature(null)).toBe('');
  });

  it('is stable regardless of the order things were picked in', () => {
    const a = selectionSignature({ 'g-plates': 2, 'g-drink': ['o-juice', 'o-water'] });
    const b = selectionSignature({ 'g-drink': ['o-water', 'o-juice'], 'g-plates': 2 });
    expect(a).toBe(b);
  });

  it('separates different configurations of the same item', () => {
    expect(selectionSignature({ 'g-plates': 2 })).not.toBe(selectionSignature({ 'g-plates': 6 }));
  });
});

describe('initialSelection', () => {
  it('starts a quantity group at its minimum', () => {
    expect(initialSelection(groups)['g-plates']).toBe(1);
  });

  it('leaves an optional choice group unset', () => {
    expect(initialSelection(groups)['g-drink']).toBeUndefined();
  });

  it('preselects a required single-choice group so the buyer is not blocked', () => {
    const required: ItemOptionGroup = { ...drink, is_required: true };
    expect(initialSelection([required])['g-drink']).toEqual(['o-juice']);
  });
});

describe('describeSelection', () => {
  it('reads as what the merchant has to prepare', () => {
    expect(describeSelection(groups, { 'g-plates': 6, 'g-drink': ['o-juice'] }))
      .toBe('6 × Plates · Juice');
  });

  it('is empty when nothing was chosen', () => {
    expect(describeSelection(groups, {})).toBe('');
  });
});

// Mirrors item_option_groups_shape_check and item_options_choice_only so a
// malformed group is caught in the form rather than by a failed save.
describe('draftGroupProblem', () => {
  const base: DraftOptionGroup = {
    label: 'Plates',
    kind: 'quantity',
    allow_multiple: false,
    is_required: true,
    min_value: '1',
    max_value: '20',
    unit_price_delta_zmw: 30,
    options: [],
  };

  it('accepts a sound quantity group', () => {
    expect(draftGroupProblem(base)).toBeNull();
  });

  it('requires a name', () => {
    expect(draftGroupProblem({ ...base, label: '  ' })).toMatch(/name/i);
  });

  it('rejects a minimum above the maximum', () => {
    expect(draftGroupProblem({ ...base, min_value: '9', max_value: '2' })).toMatch(/exceed/i);
  });

  it('requires a choice group to have options', () => {
    expect(draftGroupProblem({ ...base, kind: 'choice', options: [] })).toMatch(/at least one/i);
  });

  it('requires every option to be named', () => {
    expect(
      draftGroupProblem({
        ...base,
        kind: 'choice',
        options: [{ label: '', price_delta_zmw: 0 }],
      }),
    ).toMatch(/name/i);
  });
});
