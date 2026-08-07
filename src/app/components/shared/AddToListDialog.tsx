import { useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { useListActions, useMyLists } from '../../hooks/useLists';
import { LIST_VISIBILITIES } from '../../types/lists';

interface AddToListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: { id: string; name: string; image_url?: string | null };
}

/**
 * Puts an item on one of the viewer's lists, creating one on the spot if they
 * have none.
 *
 * New lists start private: publishing to the community is a deliberate act
 * taken from the list itself, not a side effect of saving the first thing to it.
 */
export function AddToListDialog({ open, onOpenChange, item }: AddToListDialogProps) {
  const { owned, loading, createList, reload } = useMyLists();
  const { busy, addItem } = useListActions();
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const handleAdd = async (listId: string) => {
    if (await addItem(listId, item)) {
      onOpenChange(false);
      reload();
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newTitle.trim()) return;

    setCreating(true);
    const created = await createList({ title: newTitle, visibility: 'private' });
    setCreating(false);

    if (created) {
      setNewTitle('');
      await handleAdd(created.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add to a list</DialogTitle>
          <DialogDescription>
            Lists can hold items from any number of shops, and be shared as one link.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading your lists…</p>
        ) : owned.length === 0 ? (
          <div className="py-4 text-center">
            <ListChecks className="mx-auto mb-2 size-8 text-slate-300" strokeWidth={1} />
            <p className="text-sm text-muted-foreground">
              You have no lists yet — name one and this goes straight onto it.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {owned.map((list) => (
              <li key={list.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{list.title}</p>
                  <p className="text-xs font-light text-muted-foreground">
                    {list.item_count} item{list.item_count === 1 ? '' : 's'}
                  </p>
                </div>
                <Badge variant="secondary">
                  {LIST_VISIBILITIES.find((v) => v.value === list.visibility)?.label}
                </Badge>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => handleAdd(list.id)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Or start a new list"
          />
          <Button
            disabled={creating || busy || !newTitle.trim()}
            onClick={handleCreateAndAdd}
            className="shrink-0"
          >
            <Plus className="size-3.5" />
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
