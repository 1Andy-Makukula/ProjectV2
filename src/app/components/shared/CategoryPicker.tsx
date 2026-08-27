import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../ui/utils';
import { useCategoryFlags } from '../../hooks/useCategoryFlags';

interface CategoryPickerProps {
  /** Selected category id, or '' for none. */
  value: string;
  onChange: (categoryId: string) => void;
  /** Shown when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  /** Allows clearing back to no category. Items may legitimately have none. */
  allowNone?: boolean;
  id?: string;
}

/**
 * Searchable category picker with inline creation.
 *
 * A plain <Select> was fine when the taxonomy was empty and became unusable at
 * 140 entries -- scrolling an unordered list to find "Marquee & Tent Hire" is
 * not a thing anyone will do twice, and the practical result is everything
 * ending up uncategorised.
 *
 * Typing filters; if nothing matches, the same box offers to create what was
 * typed. That matters more than it looks: the alternative is abandoning the
 * form, going to Merchandising, adding the category, and coming back to start
 * again. The new category is selected immediately, so the flow never breaks.
 *
 * Creation is admin-only at the database level ("Admins manage categories"), so
 * a merchant seeing this picker gets search without the add affordance rather
 * than a button that fails.
 */
export function CategoryPicker({
  value,
  onChange,
  placeholder = 'Select a category',
  disabled = false,
  allowNone = true,
  id,
}: CategoryPickerProps) {
  const { cats, create, creating, canManage } = useCategoryFlags();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => cats.find((c) => c.id === value), [cats, value]);

  // Only offer creation for a genuinely new name. Offering "Create Bakery"
  // while Bakery sits in the list below is how duplicates get made.
  const trimmed = query.trim();
  const exactExists = cats.some(
    (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = canManage && trimmed.length > 1 && !exactExists;

  const handleCreate = async () => {
    const created = await create(trimmed);
    if (created) {
      onChange(created.id);
      setQuery('');
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          // Filtering is left to cmdk's own matcher so "tent" finds
          // "Marquee & Tent Hire" without an exact prefix.
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder="Search categories..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {canCreate ? (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create “{trimmed}”
                </button>
              ) : (
                <span className="block px-3 py-6 text-center text-sm text-muted-foreground">
                  No category found.
                </span>
              )}
            </CommandEmpty>

            <CommandGroup>
              {allowNone && (
                <CommandItem
                  value="__none__ no category uncategorised"
                  onSelect={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value ? 'opacity-0' : 'opacity-100')}
                  />
                  <span className="text-muted-foreground">No category</span>
                </CommandItem>
              )}

              {cats.map((category) => (
                <CommandItem
                  key={category.id}
                  value={category.name}
                  onSelect={() => {
                    onChange(category.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === category.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {category.name}
                  {category.is_featured && (
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                      Featured
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>

            {/* Also reachable when the search does match something but the
                admin still wants a new, more specific category. */}
            {canCreate && cats.length > 0 && (
              <CommandGroup className="border-t">
                <CommandItem value={`__create__ ${trimmed}`} onSelect={handleCreate}>
                  {creating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Create “{trimmed}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default CategoryPicker;
