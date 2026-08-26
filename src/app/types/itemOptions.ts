// Item options — the choices attached to a listing.
//
// Two shapes, and they are exclusive (enforced by item_option_groups_shape_check):
//
//   choice    a list to pick from, each with its own price. "Add a drink."
//   quantity  a number, priced per unit. "How many plates?"
//
// The server is the authority on what a selection costs: resolve_item_selection
// recomputes it at checkout and refuses anything it does not recognise. The
// helpers here exist so the buyer sees the same number before they commit —
// they must agree with that function, and a drift means the cart quotes a total
// the buyer is not billed.

export type OptionGroupKind = 'choice' | 'quantity';

export interface ItemOption {
  id: string;
  label: string;
  price_delta_zmw: number;
  is_available: boolean;
  sort_order: number;
}

export interface ItemOptionGroup {
  id: string;
  label: string;
  kind: OptionGroupKind;
  allow_multiple: boolean;
  is_required: boolean;
  min_value: number | null;
  max_value: number | null;
  unit_price_delta_zmw: number;
  sort_order: number;
  options: ItemOption[];
}

/**
 * What the buyer chose, keyed by group id.
 *
 * Mirrors the payload resolve_item_selection expects: an array of option ids
 * for a choice group, a plain number for a quantity group.
 */
export type OptionSelection = Record<string, string[] | number>;

/** Groups in the order the merchant arranged them. */
export function sortedGroups(groups: ItemOptionGroup[] | null | undefined): ItemOptionGroup[] {
  return [...(groups ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((group) => ({
      ...group,
      options: [...(group.options ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    }));
}

/** What the chosen options add to one unit, in ngwee. */
export function selectionDelta(
  groups: ItemOptionGroup[] | null | undefined,
  selection: OptionSelection,
): number {
  let delta = 0;

  for (const group of groups ?? []) {
    const chosen = selection[group.id];
    if (chosen == null) continue;

    if (group.kind === 'choice') {
      if (!Array.isArray(chosen)) continue;
      for (const id of chosen) {
        const option = group.options?.find((o) => o.id === id && o.is_available);
        if (option) delta += option.price_delta_zmw;
      }
    } else if (typeof chosen === 'number') {
      delta += chosen * group.unit_price_delta_zmw;
    }
  }

  return delta;
}

/**
 * Why the selection cannot be bought yet, or null when it is ready.
 *
 * Only checks what the buyer can act on — a required group left blank, or a
 * quantity outside its range. Everything else is the server's to refuse.
 */
export function selectionProblem(
  groups: ItemOptionGroup[] | null | undefined,
  selection: OptionSelection,
): string | null {
  for (const group of sortedGroups(groups)) {
    const chosen = selection[group.id];

    if (group.kind === 'choice') {
      const ids = Array.isArray(chosen) ? chosen : [];
      if (group.is_required && ids.length === 0) return `Choose ${group.label.toLowerCase()}`;
      if (!group.allow_multiple && ids.length > 1) return `Only one ${group.label.toLowerCase()}`;
      continue;
    }

    const value = typeof chosen === 'number' ? chosen : null;
    if (value == null) {
      if (group.is_required) return `Set ${group.label.toLowerCase()}`;
      continue;
    }
    if (group.min_value != null && value < group.min_value) {
      return `${group.label} must be at least ${group.min_value}`;
    }
    if (group.max_value != null && value > group.max_value) {
      return `${group.label} can be at most ${group.max_value}`;
    }
  }

  return null;
}

/**
 * A stable key for one configuration of an item.
 *
 * The cart merges lines by product id, so without this two of the same dish
 * with different sides would collapse into one line and the second choice would
 * be silently lost. Sorted at every level so the same selection made in a
 * different order is still the same line.
 */
export function selectionSignature(selection: OptionSelection | null | undefined): string {
  if (!selection) return '';

  const parts = Object.keys(selection)
    .sort()
    .map((groupId) => {
      const value = selection[groupId];
      if (Array.isArray(value)) {
        if (value.length === 0) return null;
        return `${groupId}=${[...value].sort().join('+')}`;
      }
      if (typeof value === 'number' && value !== 0) return `${groupId}=${value}`;
      return null;
    })
    .filter(Boolean);

  return parts.join('|');
}

/** Human-readable summary, for a cart line or an order. */
export function describeSelection(
  groups: ItemOptionGroup[] | null | undefined,
  selection: OptionSelection,
): string {
  const parts: string[] = [];

  for (const group of sortedGroups(groups)) {
    const chosen = selection[group.id];
    if (chosen == null) continue;

    if (group.kind === 'choice' && Array.isArray(chosen) && chosen.length > 0) {
      const labels = group.options
        .filter((o) => chosen.includes(o.id))
        .map((o) => o.label)
        .join(', ');
      if (labels) parts.push(labels);
    } else if (group.kind === 'quantity' && typeof chosen === 'number' && chosen > 0) {
      parts.push(`${chosen} × ${group.label}`);
    }
  }

  return parts.join(' · ');
}

/** The default selection when a picker opens: required numbers at their minimum. */
export function initialSelection(groups: ItemOptionGroup[] | null | undefined): OptionSelection {
  const selection: OptionSelection = {};

  for (const group of sortedGroups(groups)) {
    if (group.kind === 'quantity') {
      selection[group.id] = group.min_value ?? 0;
    } else if (group.is_required && !group.allow_multiple && group.options.length > 0) {
      // A required single-choice group has to end up with something, so start
      // it on the first option rather than making the buyer discover the block.
      const first = group.options.find((o) => o.is_available);
      if (first) selection[group.id] = [first.id];
    }
  }

  return selection;
}

/**
 * The editable shape used by the admin form.
 *
 * Prices are plain ZMW numbers and the numeric bounds are strings, matching how
 * every other price and range field on that form behaves; conversion to ngwee
 * happens once, on save.
 */
export interface DraftOption {
  label: string;
  price_delta_zmw: number;
}

export interface DraftOptionGroup {
  label: string;
  kind: OptionGroupKind;
  allow_multiple: boolean;
  is_required: boolean;
  min_value: string;
  max_value: string;
  unit_price_delta_zmw: number;
  options: DraftOption[];
}

export const EMPTY_OPTION_GROUP: DraftOptionGroup = {
  label: '',
  kind: 'choice',
  allow_multiple: false,
  is_required: false,
  min_value: '',
  max_value: '',
  unit_price_delta_zmw: 0,
  options: [],
};

/**
 * Why a draft group cannot be saved, or null when it is sound.
 *
 * Mirrors the constraints the database will apply — item_option_groups_shape_check
 * and item_options_choice_only — so the merchant is told in the form rather than
 * by a failed save.
 */
export function draftGroupProblem(group: DraftOptionGroup): string | null {
  if (!group.label.trim()) return 'Give the group a name';

  if (group.kind === 'choice') {
    if (group.options.length === 0) return 'Add at least one option';
    if (group.options.some((option) => !option.label.trim())) return 'Every option needs a name';
    return null;
  }

  const min = group.min_value.trim() ? Number(group.min_value) : null;
  const max = group.max_value.trim() ? Number(group.max_value) : null;

  if (min != null && (!Number.isFinite(min) || min < 0)) return 'Minimum cannot be negative';
  if (max != null && (!Number.isFinite(max) || max < 0)) return 'Maximum cannot be negative';
  if (min != null && max != null && min > max) return 'Minimum cannot exceed maximum';

  return null;
}
