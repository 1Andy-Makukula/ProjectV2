// CustomizeListDialog — everything the owner can change about a list.
//
// One panel, in the order the questions are actually asked: how it reads, what
// it says, then what is on it. The template row sits at the top because that is
// where the storyboard and diary layouts land — the section exists now so the
// panel does not have to be rebuilt around them later.

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, LayoutList, Sparkles, Store, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Switch } from '../ui/switch';
import { useListActions } from '../../hooks/useLists';
import {
  LIST_VISIBILITIES,
  entryDisplay,
  type ListDetail,
  type ListEntry,
  type ListVisibility,
} from '../../types/lists';

interface CustomizeListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: ListDetail;
  /** Refetches the list once the panel has changed it. */
  onChanged: () => void;
}

/**
 * The layouts a list can be read as.
 *
 * Only `standard` renders today. Storyboard is listed rather than hidden
 * because it is the next thing being built and the chooser is where anyone
 * would look for it — it is explicitly marked, never presented as available.
 */
const TEMPLATES = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Pictures, prices and a running total.',
    icon: LayoutList,
    available: true,
  },
  {
    value: 'storyboard',
    label: 'Storyboard',
    description: 'A journey — notes and photos on every stop.',
    icon: Sparkles,
    available: false,
  },
] as const;

export function CustomizeListDialog({
  open,
  onOpenChange,
  list,
  onChanged,
}: CustomizeListDialogProps) {
  const { busy, updateList, removeItem, reorderEntries } = useListActions();

  const [title, setTitle] = useState(list.title);
  const [description, setDescription] = useState(list.description ?? '');
  const [visibility, setVisibility] = useState<ListVisibility>(list.visibility);
  const [anonymous, setAnonymous] = useState(list.is_anonymous);
  // Entry edits apply as they are made, so the panel keeps its own copy rather
  // than refetching the whole list between every arrow press.
  const [entries, setEntries] = useState<ListEntry[]>(list.entries);

  // Reopening the panel after a change elsewhere must not show stale values.
  useEffect(() => {
    if (!open) return;
    setTitle(list.title);
    setDescription(list.description ?? '');
    setVisibility(list.visibility);
    setAnonymous(list.is_anonymous);
    setEntries(list.entries);
  }, [open, list]);

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;

    const next = entries.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setEntries(next);

    if (await reorderEntries(next.map((entry) => entry.id))) onChanged();
  };

  const remove = async (entryId: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== entryId));

    if (await removeItem(entryId)) onChanged();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;

    const saved = await updateList(list.id, {
      title,
      description,
      visibility,
      // A shop's list always names the shop, so anonymity does not apply to it.
      is_anonymous: list.owner_shop_id ? false : anonymous,
    });

    if (saved) {
      onChanged();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Customize list</DialogTitle>
          <DialogDescription>
            How it reads, what it says, and what is on it.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
        {/* ── Template ──────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label>Template</Label>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map((template) => {
              const Icon = template.icon;
              return (
                <button
                  key={template.value}
                  type="button"
                  disabled={!template.available}
                  aria-pressed={template.available}
                  className={`rounded-[var(--radius-tile)] p-3 text-left transition-colors
                    ${
                      template.available
                        ? 'kl-rim kl-rim--strong kl-float bg-primary-tint'
                        : 'cursor-not-allowed border border-dashed border-border-dark opacity-70'
                    }`}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <Icon
                      className={`size-3.5 ${template.available ? 'text-primary' : 'text-slate-400'}`}
                      strokeWidth={2}
                    />
                    <span className="text-sm font-medium">{template.label}</span>
                    {!template.available && (
                      <Badge variant="secondary" className="ml-auto">
                        Soon
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs font-light text-muted-foreground">
                    {template.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={save} className="space-y-4 border-t border-border pt-4">
          <div className="space-y-2">
            <Label htmlFor="customize-title">Name *</Label>
            <Input
              id="customize-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customize-description">Description</Label>
            <Textarea
              id="customize-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this list is for"
            />
          </div>

          <div className="space-y-2">
            <Label>Who can see it</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as ListVisibility)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIST_VISIBILITIES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs font-light text-muted-foreground">
              {LIST_VISIBILITIES.find((v) => v.value === visibility)?.description}
            </p>
          </div>

          {visibility !== 'private' && !list.owner_shop_id && (
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="customize-anonymous">Share anonymously</Label>
                <p className="text-xs font-light text-muted-foreground">
                  Your name is replaced with “Anonymous”.
                </p>
              </div>
              <Switch
                id="customize-anonymous"
                checked={anonymous}
                onCheckedChange={setAnonymous}
              />
            </div>
          )}

          <Button type="submit" disabled={busy || !title.trim()} className="w-full">
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </form>

        {/* ── Entries ───────────────────────────────────────────────────── */}
        <div className="space-y-2 border-t border-border pt-4">
          <Label>On this list ({entries.length})</Label>

          {entries.length === 0 ? (
            <p className="py-4 text-center text-sm font-light text-muted-foreground">
              Nothing on it yet — save things to it as you browse.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry, index) => {
                const { name, imageUrl } = entryDisplay(entry);

                return (
                  <li key={entry.id} className="flex items-center gap-3 py-2">
                    <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-slate-50">
                      {imageUrl ? (
                        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Store className="size-4 text-slate-300" strokeWidth={1.5} />
                        </div>
                      )}
                    </div>

                    <p className="min-w-0 flex-1 truncate text-sm">{name}</p>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={`Move ${name} up`}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowUp className="size-3.5" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        disabled={busy || index === entries.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label={`Move ${name} down`}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowDown className="size-3.5" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(entry.id)}
                        aria-label={`Remove ${name}`}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 className="size-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
