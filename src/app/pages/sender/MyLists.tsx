import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, Bookmark, ListChecks, Plus, Store, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { ListCard } from '../../components/shared/ListCard';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useMyLists } from '../../hooks/useLists';
import { LIST_VISIBILITIES, type ListVisibility } from '../../types/lists';

/**
 * Everything the signed-in person has made or saved.
 *
 * Owned and saved are kept apart on purpose: a saved list is still someone
 * else's and keeps changing under them, so presenting the two as one pile would
 * be misleading the first time a shop edits a list you saved.
 */
export function MyLists() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { owned, saved, shopOwned, myShopId, loading, createList, deleteList } = useMyLists();
  const [asShop, setAsShop] = useState(false);

  // /lists/new is this page with the dialog already open.
  const landedOnNew = location.pathname === '/lists/new';
  const [open, setOpen] = useState(landedOnNew);

  // Closing it puts the URL back where the user actually is, so Back does not
  // reopen the dialog.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && landedOnNew) navigate('/lists', { replace: true });
  };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ListVisibility>('private');
  const [anonymous, setAnonymous] = useState(false);
  const [platform, setPlatform] = useState(false);
  const [saving, setSaving] = useState(false);

  const isAdmin = profile?.role === 'admin';

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const created = await createList({
      title,
      description,
      visibility,
      is_anonymous: anonymous,
      is_platform: isAdmin ? platform : false,
      owner_shop_id: asShop && myShopId ? myShopId : undefined,
    });
    setSaving(false);

    if (created) {
      setOpen(false);
      setTitle('');
      setDescription('');
      setVisibility('private');
      setAnonymous(false);
      setPlatform(false);
      setAsShop(false);
      navigate(`/list/${created.slug}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 border-b bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 md:px-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="flex-1 text-base font-medium tracking-tight">My Lists</h1>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" />
            New list
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 md:px-6 md:py-8">
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Made by me
          </h2>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : owned.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center">
              <ListChecks className="mx-auto mb-3 h-9 w-9 text-slate-300" strokeWidth={1} />
              <p className="text-sm text-slate-500">
                Build a list of things you buy often, then share the link.
              </p>
              <Button className="mt-4" onClick={() => setOpen(true)}>
                <Plus className="size-3.5" />
                Make your first list
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {owned.map((list) => (
                <div key={list.id} className="relative">
                  <ListCard list={list} onOpen={() => navigate(`/list/${list.slug}`)} />
                  <div className="absolute right-2 top-2 flex items-center gap-1">
                    <Badge variant="secondary">
                      {LIST_VISIBILITIES.find((v) => v.value === list.visibility)?.label}
                    </Badge>
                    <button
                      onClick={() => deleteList(list.id)}
                      aria-label={`Delete ${list.title}`}
                      className="rounded-full bg-white/90 p-1.5 text-slate-500 shadow-sm transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {myShopId && (
          <section>
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
              <Store className="size-3.5" strokeWidth={2} />
              My shop’s lists
            </h2>
            {shopOwned.length === 0 ? (
              <p className="text-sm font-light text-muted-foreground">
                A shop list shows on your storefront and, if you publish it, in the community
                feed — a good way to sell a whole set at once.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shopOwned.map((list) => (
                  <div key={list.id} className="relative">
                    <ListCard list={list} onOpen={() => navigate(`/list/${list.slug}`)} />
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      <Badge variant="secondary">
                        {LIST_VISIBILITIES.find((v) => v.value === list.visibility)?.label}
                      </Badge>
                      <button
                        onClick={() => deleteList(list.id)}
                        aria-label={`Delete ${list.title}`}
                        className="rounded-full bg-white/90 p-1.5 text-slate-500 shadow-sm transition-colors hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section>
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            <Bookmark className="size-3.5" strokeWidth={2} />
            Saved from others
          </h2>

          {saved.length === 0 ? (
            <p className="text-sm font-light text-muted-foreground">
              Lists you save from shops or the community land here, and keep updating as their
              owners change them.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {saved.map((list) => (
                <ListCard
                  key={list.id}
                  list={list}
                  onOpen={() => navigate(`/list/${list.slug}`)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New list</DialogTitle>
            <DialogDescription>
              Add items to it from any shop once it exists.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="list-title">Name *</Label>
              <Input
                id="list-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Monthly groceries"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="list-description">Description</Label>
              <Textarea
                id="list-description"
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

            {myShopId && (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="list-as-shop">Publish as my shop</Label>
                  <p className="text-xs font-light text-muted-foreground">
                    Owned by the shop and shown on your storefront, rather than being a
                    personal list.
                  </p>
                </div>
                <Switch id="list-as-shop" checked={asShop} onCheckedChange={setAsShop} />
              </div>
            )}

            {visibility !== 'private' && !asShop && (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="list-anonymous">Share anonymously</Label>
                  <p className="text-xs font-light text-muted-foreground">
                    Your name is replaced with “Anonymous”.
                  </p>
                </div>
                <Switch id="list-anonymous" checked={anonymous} onCheckedChange={setAnonymous} />
              </div>
            )}

            {isAdmin && visibility === 'community' && (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="list-platform">Publish as KithLy</Label>
                  <p className="text-xs font-light text-muted-foreground">
                    Badged as platform-curated rather than showing your name.
                  </p>
                </div>
                <Switch id="list-platform" checked={platform} onCheckedChange={setPlatform} />
              </div>
            )}

            <Button type="submit" disabled={saving || !title.trim()} className="w-full">
              {saving ? 'Creating…' : 'Create list'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MyLists;
