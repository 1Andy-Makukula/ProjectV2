import { Minus, Plus } from 'lucide-react';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { formatCurrency } from '../../../utils/currency';
import {
  sortedGroups,
  type ItemOptionGroup,
  type OptionSelection,
} from '../../types/itemOptions';

interface ItemOptionPickerProps {
  groups: ItemOptionGroup[];
  selection: OptionSelection;
  onChange: (selection: OptionSelection) => void;
  disabled?: boolean;
}

/**
 * The choices attached to a listing: sides, portions, how many plates.
 *
 * Every price shown here is a delta the server will recompute at checkout —
 * `resolve_item_selection` is the authority and refuses anything it does not
 * recognise, so nothing here can talk the price down.
 *
 * A required group is marked rather than silently blocking the buy button, and
 * a single-choice group behaves like radios even though the state is an array,
 * because that is the shape resolve_item_selection expects for every choice
 * group regardless of how many may be picked.
 */
export function ItemOptionPicker({
  groups,
  selection,
  onChange,
  disabled,
}: ItemOptionPickerProps) {
  const ordered = sortedGroups(groups);
  if (ordered.length === 0) return null;

  const toggleOption = (group: ItemOptionGroup, optionId: string) => {
    const current = Array.isArray(selection[group.id]) ? (selection[group.id] as string[]) : [];

    let next: string[];
    if (group.allow_multiple) {
      next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
    } else {
      // Tapping the chosen one again clears it, unless the group is required —
      // in which case there is no valid empty state to clear to.
      next = current.includes(optionId) ? (group.is_required ? current : []) : [optionId];
    }

    onChange({ ...selection, [group.id]: next });
  };

  const setQuantity = (group: ItemOptionGroup, value: number) => {
    const min = group.min_value ?? 0;
    const max = group.max_value ?? Number.MAX_SAFE_INTEGER;
    onChange({ ...selection, [group.id]: Math.min(max, Math.max(min, value)) });
  };

  return (
    <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
      {ordered.map((group) => {
        const chosen = selection[group.id];

        return (
          <div key={group.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium text-slate-900">{group.label}</Label>
              {group.is_required && (
                <Badge variant="secondary" className="text-[10px]">
                  Required
                </Badge>
              )}
              {group.kind === 'choice' && group.allow_multiple && (
                <span className="text-[11px] font-light text-slate-400">Choose any</span>
              )}
            </div>

            {group.kind === 'choice' ? (
              <div className="flex flex-wrap gap-2">
                {group.options
                  .filter((option) => option.is_available)
                  .map((option) => {
                    const isChosen =
                      Array.isArray(chosen) && chosen.includes(option.id);

                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={disabled}
                        aria-pressed={isChosen}
                        onClick={() => toggleOption(group, option.id)}
                        className={`rounded-xl border px-3 py-2 text-xs font-medium transition-all duration-200
                                    disabled:opacity-50
                                    ${
                                      isChosen
                                        ? 'border-slate-900 bg-slate-900 text-white'
                                        : 'border-slate-200 text-slate-700 hover:border-slate-400'
                                    }`}
                      >
                        {option.label}
                        {option.price_delta_zmw > 0 && (
                          <span className={isChosen ? 'ml-1.5 text-white/70' : 'ml-1.5 text-slate-400'}>
                            +{formatCurrency(option.price_delta_zmw, 'ZMW')}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Fewer ${group.label}`}
                    onClick={() =>
                      setQuantity(group, (typeof chosen === 'number' ? chosen : 0) - 1)
                    }
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50"
                  >
                    <Minus className="size-3.5" strokeWidth={2.5} />
                  </button>
                  <span className="min-w-8 text-center text-sm font-semibold tabular-nums">
                    {typeof chosen === 'number' ? chosen : group.min_value ?? 0}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`More ${group.label}`}
                    onClick={() =>
                      setQuantity(group, (typeof chosen === 'number' ? chosen : 0) + 1)
                    }
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50"
                  >
                    <Plus className="size-3.5" strokeWidth={2.5} />
                  </button>
                </div>

                {group.unit_price_delta_zmw > 0 && (
                  <span className="text-xs text-slate-500">
                    {formatCurrency(group.unit_price_delta_zmw, 'ZMW')} each
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
