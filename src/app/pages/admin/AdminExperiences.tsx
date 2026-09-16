// AdminExperiences — curating multi-shop offerings.
//
// The list and the builder share one page: picking an experience opens it for
// editing in place, which suits a curation task where you compare several
// while assembling one.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Sparkles,
  Search,
  Trash2,
  Store,
  Package,
  Check,
  Eye,
  EyeOff,
  CalendarClock,
} from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../../utils/errorParser';
import { formatCurrency } from '../../../utils/currency';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { useAdminExperiences } from '../../hooks/useExperiences';
import {
  experienceTotal,
  participatingShops,
  slugify,
  type Experience,
} from '../../types/experiences';

interface PickableItem {
  id: string;
  name: string;
  price_zmw: number;
  image_url: string | null;
  shop: { id: string; name: string } | null;
}

interface DraftLine {
  item_id: string;
  quantity: number;
  note: string;
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${
        active
          ? 'bg-green-50 text-green-700 ring-green-200'
          : 'bg-slate-50 text-slate-500 ring-slate-200'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-slate-400'}`} />
      {active ? 'Live' : 'Draft'}
    </span>
  );
}

export function AdminExperiences() {
  const navigate = useNavigate();
  const { experiences, loading, reload, toggleActive, remove } = useAdminExperiences();

  const [editing, setEditing] = useState<Experience | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const [catalogue, setCatalogue] = useState<PickableItem[]>([]);
  const [itemQuery, setItemQuery] = useState('');

  // The picker needs every shop's catalogue, minus anything not resellable.
  useEffect(() => {
    async function loadCatalogue() {
      const { data, error } = await supabase
        .from('items')
        .select('id, name, price_zmw, image_url, shop:shop_id (id, name)')
        .eq('is_available', true)
        .eq('is_quote_only', false)
        .order('name');

      if (error) {
        console.error('[AdminExperiences] Failed to load catalogue:', error);
        return;
      }
      setCatalogue((data ?? []) as unknown as PickableItem[]);
    }
    loadCatalogue();
  }, []);

  const startNew = () => {
    setEditing({ id: '', name: '', slug: '' } as Experience);
    setName('');
    setSlug('');
    setTagline('');
    setDescription('');
    setImageUrl('');
    setExpiresAt('');
    setLines([]);
  };

  const startEdit = (experience: Experience) => {
    setEditing(experience);
    setName(experience.name);
    setSlug(experience.slug);
    setTagline(experience.tagline ?? '');
    setDescription(experience.description ?? '');
    setImageUrl(experience.image_url ?? '');
    setExpiresAt(experience.expires_at ? experience.expires_at.slice(0, 10) : '');
    setLines(
      (experience.experience_items ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({ item_id: l.item_id, quantity: l.quantity, note: l.note ?? '' })),
    );
  };

  const closeEditor = () => setEditing(null);

  const addLine = (itemId: string) => {
    if (lines.some((l) => l.item_id === itemId)) {
      toast.info('That item is already in this experience');
      return;
    }
    setLines((prev) => [...prev, { item_id: itemId, quantity: 1, note: '' }]);
  };

  const draftTotal = lines.reduce((sum, line) => {
    const item = catalogue.find((c) => c.id === line.item_id);
    return sum + (item?.price_zmw ?? 0) * line.quantity;
  }, 0);

  const draftShops = new Set(
    lines
      .map((l) => catalogue.find((c) => c.id === l.item_id)?.shop?.id)
      .filter(Boolean) as string[],
  );

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error('Give the experience a name');
      return;
    }
    const finalSlug = slug.trim() || slugify(name);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(finalSlug)) {
      toast.error('The web address may only use lowercase letters, numbers and hyphens');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one item');
      return;
    }

    setSaving(true);
    try {
      const record = {
        name: name.trim(),
        slug: finalSlug,
        tagline: tagline.trim() || null,
        description: description.trim() || null,
        image_url: imageUrl.trim() || null,
        expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      let experienceId = editing?.id;

      if (experienceId) {
        const { error } = await supabase.from('experiences').update(record).eq('id', experienceId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('experiences')
          .insert(record)
          .select('id')
          .single();
        if (error) throw error;
        experienceId = data.id;
      }

      // One call replaces the whole contents, so the experience is never
      // momentarily empty mid-save.
      const { error: itemsError } = await supabase.rpc('set_experience_items', {
        p_experience_id: experienceId,
        p_items: lines.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          note: l.note.trim() || null,
        })),
      });
      if (itemsError) throw itemsError;

      toast.success(editing?.id ? 'Experience updated' : 'Experience created');
      closeEditor();
      await reload();
    } catch (err: any) {
      toast.error(parseAuthError(err));
    } finally {
      setSaving(false);
    }
  }, [name, slug, tagline, description, imageUrl, expiresAt, lines, editing, reload]);

  const filteredCatalogue = itemQuery
    ? catalogue.filter(
        (c) =>
          c.name.toLowerCase().includes(itemQuery.toLowerCase()) ||
          c.shop?.name.toLowerCase().includes(itemQuery.toLowerCase()),
      )
    : catalogue.slice(0, 30);

  return (
    <PageShell>
      <AdminPageHeader
        title="Experiences"
        subtitle="Curate items from different shops into one offering"
        onBack={() => navigate('/admin')}
        actions={
          <Button onClick={startNew} className="h-8 bg-white text-primary hover:bg-white/90">
            <Plus className="size-3.5" />
            New experience
          </Button>
        }
      />

      <PageBody>
        <AnimatePresence mode="wait">
          {editing ? (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 gap-6 lg:grid-cols-5"
            >
              {/* Details */}
              <div className="space-y-5 lg:col-span-3">
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <h2 className="mb-4 text-sm font-semibold text-slate-900">
                    {editing.id ? 'Edit experience' : 'New experience'}
                  </h2>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="exp-name">Name</Label>
                      <Input
                        id="exp-name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (!editing.id) setSlug(slugify(e.target.value));
                        }}
                        placeholder="e.g. Spa afternoon and dinner for two"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="exp-slug">Web address</Label>
                      <Input
                        id="exp-slug"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        placeholder="spa-and-dinner"
                      />
                      <p className="text-xs text-slate-400">
                        Appears as /experience/{slug || 'your-address'}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="exp-tagline">Tagline</Label>
                      <Input
                        id="exp-tagline"
                        value={tagline}
                        onChange={(e) => setTagline(e.target.value)}
                        placeholder="One line that sells it"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="exp-description">Description</Label>
                      <Textarea
                        id="exp-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        placeholder="What the recipient can expect"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="exp-image">Image URL</Label>
                      <Input
                        id="exp-image"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="https://…"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="exp-expiry">Claim by</Label>
                      <Input
                        id="exp-expiry"
                        type="date"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                      />
                      <p className="text-xs text-slate-400">
                        Every part of the experience expires on this date, whichever shop it
                        comes from. Leave blank to use each item's own expiry.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Chosen contents */}
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Contents ({lines.length})
                    </h3>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                        Total
                      </p>
                      <p className="text-sm font-medium tabular-nums text-slate-900">
                        {formatCurrency(draftTotal, 'ZMW')}
                      </p>
                    </div>
                  </div>

                  {lines.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                      <Package className="mx-auto mb-2 h-7 w-7 text-slate-200" strokeWidth={1.5} />
                      <p className="text-sm text-slate-400">
                        Pick items from the catalogue on the right.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {lines.map((line, index) => {
                        const item = catalogue.find((c) => c.id === line.item_id);
                        return (
                          <div key={line.item_id} className="flex items-start gap-3 px-5 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-900">
                                {item?.name ?? 'Item'}
                              </p>
                              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                                <Store className="h-3 w-3 shrink-0" strokeWidth={2} />
                                {item?.shop?.name ?? 'Unknown shop'}
                              </p>
                              <Input
                                value={line.note}
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((l, i) =>
                                      i === index ? { ...l, note: e.target.value } : l,
                                    ),
                                  )
                                }
                                placeholder="Note (optional) — e.g. 60 minutes"
                                className="mt-2 h-8 text-xs"
                              />
                            </div>

                            <div className="w-16 shrink-0">
                              <Input
                                type="number"
                                min="1"
                                value={line.quantity}
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((l, i) =>
                                      i === index
                                        ? { ...l, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }
                                        : l,
                                    ),
                                  )
                                }
                                className="h-8"
                              />
                            </div>

                            <button
                              onClick={() =>
                                setLines((prev) => prev.filter((l) => l.item_id !== line.item_id))
                              }
                              className="mt-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500"
                              aria-label="Remove item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
                    <p className="text-xs text-slate-500">
                      {draftShops.size} {draftShops.size === 1 ? 'shop' : 'shops'} taking part
                      {draftShops.size > 1 && ' — one claim code each'}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={closeEditor} disabled={saving}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Catalogue picker */}
              <div className="lg:col-span-2">
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-3">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900">Catalogue</h3>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={itemQuery}
                        onChange={(e) => setItemQuery(e.target.value)}
                        placeholder="Search items or shops…"
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="max-h-[32rem] divide-y divide-slate-50 overflow-y-auto">
                    {filteredCatalogue.length === 0 ? (
                      <p className="px-5 py-8 text-center text-sm text-slate-400">
                        No items match that search.
                      </p>
                    ) : (
                      filteredCatalogue.map((item) => {
                        const chosen = lines.some((l) => l.item_id === item.id);
                        return (
                          <button
                            key={item.id}
                            onClick={() => addLine(item.id)}
                            disabled={chosen}
                            className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                              chosen ? 'bg-slate-50 opacity-60' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                              {item.image_url ? (
                                <img
                                  src={item.image_url}
                                  alt={item.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <Package className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-slate-900">
                                {item.name}
                              </p>
                              <p className="truncate text-[10px] text-slate-400">
                                {item.shop?.name} · {formatCurrency(item.price_zmw, 'ZMW')}
                              </p>
                            </div>
                            {chosen ? (
                              <Check className="h-4 w-4 shrink-0 text-green-500" strokeWidth={2} />
                            ) : (
                              <Plus className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={2} />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Loading experiences…
                </div>
              ) : experiences.length === 0 ? (
                <div className="flex flex-col items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-dark)] px-6 py-16 text-center">
                  <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-tint">
                    <Sparkles className="size-6 text-primary" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-base font-medium tracking-tight">No experiences yet</h3>
                  <p className="mx-auto mt-1 max-w-sm text-sm font-light text-muted-foreground">
                    Combine items from different shops into something no single merchant sells.
                  </p>
                  <Button onClick={startNew} className="mt-5">
                    <Plus className="size-3.5" />
                    Create the first one
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {experiences.map((experience) => {
                    const shops = participatingShops(experience);
                    const total = experienceTotal(experience);
                    return (
                      <div
                        key={experience.id}
                        className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
                      >
                        <div className="relative aspect-[16/9] bg-slate-50">
                          {experience.image_url ? (
                            <img
                              src={experience.image_url}
                              alt={experience.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-tint via-white to-primary-tint">
                              <Sparkles className="h-8 w-8 text-primary/30" strokeWidth={1} />
                            </div>
                          )}
                          <div className="absolute right-2.5 top-2.5">
                            <StatusPill active={experience.is_active} />
                          </div>
                        </div>

                        <div className="flex flex-1 flex-col p-4">
                          <h3 className="truncate text-sm font-semibold text-slate-900">
                            {experience.name}
                          </h3>
                          {experience.tagline && (
                            <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">
                              {experience.tagline}
                            </p>
                          )}

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                            <span className="flex items-center gap-1">
                              <Store className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={2} />
                              {shops.length}
                            </span>
                            <span className="flex items-center gap-1">
                              <Package className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={2} />
                              {(experience.experience_items ?? []).length}
                            </span>
                            {experience.expires_at && (
                              <span className="flex items-center gap-1">
                                <CalendarClock className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={2} />
                                {new Date(experience.expires_at).toLocaleDateString('en-US', {
                                  day: 'numeric',
                                  month: 'short',
                                })}
                              </span>
                            )}
                          </div>

                          <p className="mt-2 text-sm font-medium tabular-nums text-slate-900">
                            {formatCurrency(total, 'ZMW')}
                          </p>

                          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startEdit(experience)}
                              className="flex-1 text-xs"
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleActive(experience.id, experience.is_active)}
                              className="text-xs"
                              aria-label={experience.is_active ? 'Unpublish' : 'Publish'}
                            >
                              {experience.is_active ? (
                                <EyeOff className="size-3.5" />
                              ) : (
                                <Eye className="size-3.5" />
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete "${experience.name}"? Orders already placed are unaffected.`,
                                  )
                                ) {
                                  remove(experience.id);
                                }
                              }}
                              className="text-xs text-red-600 hover:bg-red-50"
                              aria-label="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </PageBody>
    </PageShell>
  );
}
