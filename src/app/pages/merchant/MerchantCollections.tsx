// MerchantCollections — "these go together".
//
// The shop page has always been a flat grid, which is fine at six items and
// unusable at forty. `shop_item_groups()` already falls back to grouping by
// category so no shop looks like a heap, but a category is the platform's idea
// of what an item is. A collection is the shopkeeper's, and they know things
// the taxonomy does not: that these four are the school kit, that those three
// are what people buy on a Friday.
//
// Kept deliberately plain. This is a tool a shopkeeper uses on a phone, in a
// shop, probably while serving somebody.

import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ListTree, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useShopCollections } from '../../hooks/useShopCollections';
import { formatCurrency } from '../../../utils/currency';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { EmptyState } from '../../components/shared/EmptyState';

export function MerchantCollections() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [shopId, setShopId] = useState<string | null>(null);

  // The merchant's own shop, resolved the way the rest of the merchant surface
  // does it -- through merchant_shops, never shops.owner_id, which smoke check
  // 2 exists to keep true of the money functions and is the right habit here.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('merchant_shops')
        .select('shop_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cancelled) setShopId((data as { shop_id: string } | null)?.shop_id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const {
    collections,
    items,
    loading,
    saving,
    createCollection,
    removeCollection,
    toggleItem,
  } = useShopCollections(shopId);

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/merchant')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Collections</h1>
            <p className="text-xs text-muted-foreground">
              Group what you sell, so your shop reads as a shop rather than a list.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-6">
        {/* New collection */}
        <div className="kl-tile flex gap-2 p-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name a collection — “Weekday lunches”, “School kit”"
            aria-label="New collection name"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                void createCollection(newName).then(() => setNewName(''));
              }
            }}
          />
          <Button
            onClick={() => void createCollection(newName).then(() => setNewName(''))}
            disabled={!newName.trim() || saving}
          >
            <Plus className="size-4" strokeWidth={2} />
            Add
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : collections.length === 0 ? (
          <EmptyState
            icon={ListTree}
            title="No collections yet"
            description="Until you make one, your shop is grouped by category automatically. A collection you name yourself reads better, because you know what goes together."
          />
        ) : (
          collections.map((collection) => {
            const isOpen = editing === collection.id;
            return (
              <section key={collection.id} className="kl-tile p-4">
                <header className="flex items-center gap-2">
                  <ListTree className="size-4 shrink-0 text-primary" strokeWidth={2} />
                  <h2 className="flex-1 truncate font-medium text-foreground">{collection.name}</h2>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {collection.item_ids.length} item
                    {collection.item_ids.length === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={() => setEditing(isOpen ? null : collection.id)}
                    className="shrink-0 text-xs font-medium text-primary"
                  >
                    {isOpen ? 'Done' : 'Choose items'}
                  </button>
                  <button
                    onClick={() => removeCollection(collection.id)}
                    aria-label={`Remove ${collection.name}`}
                    className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" strokeWidth={2} />
                  </button>
                </header>

                {/* An empty collection is ignored by the storefront rather than
                    switching the whole shop into collection mode, so say so
                    instead of letting it look broken. */}
                {collection.item_ids.length === 0 && !isOpen && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Empty, so it is not shown yet. Choose some items.
                  </p>
                )}

                {isOpen && (
                  <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto border-t border-border pt-3">
                    {items.length === 0 && (
                      <li className="text-xs text-muted-foreground">
                        You have no items yet. Add one first.
                      </li>
                    )}
                    {items.map((item) => {
                      const inside = collection.item_ids.includes(item.id);
                      return (
                        <li key={item.id}>
                          <button
                            onClick={() => toggleItem(collection.id, item.id, !inside)}
                            aria-pressed={inside}
                            className="flex w-full items-center gap-2.5 rounded-[var(--radius-lg)] p-1.5 text-left transition-colors hover:bg-accent"
                          >
                            <span
                              className={`grid size-5 shrink-0 place-items-center rounded border
                                          ${inside ? 'border-transparent bg-primary text-primary-foreground' : 'border-border'}`}
                            >
                              {inside && <Check className="size-3" strokeWidth={3} />}
                            </span>
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt=""
                                className="size-8 shrink-0 rounded object-cover"
                              />
                            ) : (
                              <span className="size-8 shrink-0 rounded bg-secondary" />
                            )}
                            <span className="flex-1 truncate text-sm">{item.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {formatCurrency(item.price_zmw)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}

        <p className="pb-8 text-xs text-muted-foreground">
          Anything you do not file still appears, under “More from this shop”. Nothing is ever
          hidden by grouping.
        </p>
      </main>
    </div>
  );
}

export default MerchantCollections;
