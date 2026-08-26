import { AlertTriangle, ListPlus, Plus, Trash2 } from 'lucide-react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  EMPTY_OPTION_GROUP,
  draftGroupProblem,
  type DraftOptionGroup,
  type OptionGroupKind,
} from '../../types/itemOptions';

interface ItemOptionsEditorProps {
  groups: DraftOptionGroup[];
  onChange: (groups: DraftOptionGroup[]) => void;
  disabled?: boolean;
}

/**
 * Choices a buyer makes when ordering: sides, portions, how many plates.
 *
 * Two shapes, and the database keeps them exclusive, so the form only shows the
 * fields belonging to the chosen one — a quantity group has no list to fill in,
 * and a choice group has no per-unit price of its own.
 *
 * Every price here is an amount *added* to the item price. The server recomputes
 * the total at checkout from these same rows, so what is typed here is what a
 * buyer will actually be charged.
 */
export function ItemOptionsEditor({ groups, onChange, disabled }: ItemOptionsEditorProps) {
  const update = (index: number, patch: Partial<DraftOptionGroup>) => {
    onChange(groups.map((group, i) => (i === index ? { ...group, ...patch } : group)));
  };

  const removeGroup = (index: number) => {
    onChange(groups.filter((_, i) => i !== index));
  };

  const addOption = (index: number) => {
    const group = groups[index];
    update(index, { options: [...group.options, { label: '', price_delta_zmw: 0 }] });
  };

  const updateOption = (
    groupIndex: number,
    optionIndex: number,
    patch: Partial<{ label: string; price_delta_zmw: number }>,
  ) => {
    const group = groups[groupIndex];
    update(groupIndex, {
      options: group.options.map((option, i) =>
        i === optionIndex ? { ...option, ...patch } : option,
      ),
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Options</Label>
        <p className="text-sm font-light text-muted-foreground">
          Extras a buyer chooses when ordering. Each adds to the item price, and the amount is
          charged exactly as entered here.
        </p>
      </div>

      {groups.map((group, index) => {
        const problem = draftGroupProblem(group);
        const isChoice = group.kind === 'choice';

        return (
          <div key={index} className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-start gap-2">
              <Input
                value={group.label}
                disabled={disabled}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder="e.g. Number of plates"
                className="flex-1"
              />
              <Select
                value={group.kind}
                onValueChange={(value) => update(index, { kind: value as OptionGroupKind })}
                disabled={disabled}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="choice">Pick from a list</SelectItem>
                  <SelectItem value="quantity">A number</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={`Remove ${group.label || 'group'}`}
                onClick={() => removeGroup(index)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={group.is_required}
                  disabled={disabled}
                  onCheckedChange={(checked) => update(index, { is_required: checked })}
                />
                Required
              </label>

              {isChoice && (
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={group.allow_multiple}
                    disabled={disabled}
                    onCheckedChange={(checked) => update(index, { allow_multiple: checked })}
                  />
                  Allow more than one
                </label>
              )}
            </div>

            {isChoice ? (
              <div className="space-y-2">
                {group.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-center gap-2">
                    <Input
                      value={option.label}
                      disabled={disabled}
                      onChange={(e) =>
                        updateOption(index, optionIndex, { label: e.target.value })
                      }
                      placeholder="e.g. Extra juice"
                      className="flex-1"
                    />
                    <div className="relative w-36">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        + ZMW
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={disabled}
                        value={option.price_delta_zmw || ''}
                        onChange={(e) =>
                          updateOption(index, optionIndex, {
                            price_delta_zmw: Number(e.target.value) || 0,
                          })
                        }
                        placeholder="0.00"
                        className="pl-14"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={`Remove option ${optionIndex + 1}`}
                      onClick={() =>
                        update(index, {
                          options: group.options.filter((_, i) => i !== optionIndex),
                        })
                      }
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => addOption(index)}
                >
                  <Plus className="size-3.5" />
                  Add option
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Minimum</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    disabled={disabled}
                    value={group.min_value}
                    onChange={(e) => update(index, { min_value: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Maximum</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    disabled={disabled}
                    value={group.max_value}
                    onChange={(e) => update(index, { max_value: e.target.value })}
                    placeholder="No limit"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price each (ZMW)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={disabled}
                    value={group.unit_price_delta_zmw || ''}
                    onChange={(e) =>
                      update(index, { unit_price_delta_zmw: Number(e.target.value) || 0 })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>
            )}

            {problem && (
              <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                {problem}
              </p>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange([...groups, { ...EMPTY_OPTION_GROUP }])}
      >
        <ListPlus className="size-4" />
        Add an option group
      </Button>
    </div>
  );
}
