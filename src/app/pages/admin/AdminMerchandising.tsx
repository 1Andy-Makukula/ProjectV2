// AdminMerchandising — Full storefront control panel at '/admin/merchandising'
// Manages: Banners · Weekly Picks · Shop Logos · Category Flags

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Upload, Trash2, ToggleLeft, ToggleRight,
  Search, Store, Package, Tag,
} from 'lucide-react';
import { useBannerManager } from '../../hooks/useBannerManager';
import { useWeeklyPicks } from '../../hooks/useWeeklyPicks';
import { useShopLogoManager } from '../../hooks/useShopLogoManager';
import { useCategoryFlags } from '../../hooks/useCategoryFlags';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { Button } from '../../components/ui/button';

// ─── Generic helpers ──────────────────────────────────────────────────────────

function cls(...args: (string | false | undefined | null)[]) {
  return args.filter(Boolean).join(' ');
}

function SectionShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="kl-card overflow-hidden">
      <div className="border-b border-[var(--border)] px-6 py-4">
        <h2 className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">{title}</h2>
        <p className="mt-1 text-sm font-light text-muted-foreground/80">{sub}</p>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-ink-700" aria-hidden />;
}

function StatusTag({ ok }: { ok: boolean }) {
  return (
    <span className={cls('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1',
      ok ? 'bg-ok-50 text-ok-700 ring-ok-200' : 'bg-ink-50 text-ink-500 ring-ink-200'
    )}>
      <span className={cls('h-1.5 w-1.5 rounded-full', ok ? 'bg-ok-500' : 'bg-ink-400')} />
      {ok ? 'Active' : 'Inactive'}
    </span>
  );
}

// ─── 1. Banner Manager ────────────────────────────────────────────────────────

function BannerManager() {
  const {
    banners,
    loading,
    saving,
    title,
    setTitle,
    targetRoute,
    setTargetRoute,
    sortOrder,
    setSortOrder,
    file,
    setFile,
    preview,
    setPreview,
    handleAdd,
    toggleActive,
    deleteBanner,
  } = useBannerManager();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    await handleAdd(e);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <SectionShell title="Banner / Campaign Manager" sub="Manages the hero carousel on the storefront. Table: marketing_campaigns.">
      {/* Add form */}
      <form onSubmit={handleFormSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1fr_auto_auto] mb-6">
        <div>
          <label className="block text-xs font-semibold text-ink-600 mb-1">Title</label>
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Campaign headline"
            className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink-600 mb-1">Destination link</label>
          <input
            value={targetRoute} onChange={e => setTargetRoute(e.target.value)}
            placeholder="/shops or /send/<item-id>"
            className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink-600 mb-1">Sort Order</label>
          <input
            type="number" min="0" value={sortOrder} onChange={e => setSortOrder(e.target.value)}
            className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink-600 mb-1">Image</label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-ink-300 px-3 py-2 text-sm text-ink-500 hover:border-ink-500 transition-colors">
            <Upload className="h-4 w-4 shrink-0" />
            {file ? file.name.slice(0, 18) + '…' : 'Choose file'}
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={handleFile} />
          </label>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            aria-busy={saving}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Spinner /> : <Upload className="h-4 w-4" />}
            Add Banner
          </button>
        </div>
      </form>

      {preview && (
        <div className="mb-4 overflow-hidden rounded-lg border border-ink-200 bg-ink-50 h-32 w-full">
          <img src={preview} alt="Preview" className="h-full w-full object-cover" />
        </div>
      )}

      {/* Banner list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-500"><Spinner /> Loading banners...</div>
      ) : banners.length === 0 ? (
        <p className="text-sm text-ink-400">No banners yet.</p>
      ) : (
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 overflow-hidden">
          {banners.map(b => (
            <div key={b.id} className="flex items-center gap-4 px-4 py-3 hover:bg-ink-50 transition-colors">
              <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-ink-100">
                <img src={b.image_url} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">{b.title}</p>
                <p className="truncate text-xs text-ink-400">Sort: {b.sort_order} · Links to: {b.target_route}</p>
              </div>
              <StatusTag ok={b.is_active} />
              <button onClick={() => toggleActive(b)} className="text-ink-400 hover:text-ink-700 transition-colors" title={b.is_active ? 'Deactivate' : 'Activate'}>
                {b.is_active ? <ToggleRight className="h-5 w-5 text-ok-600" /> : <ToggleLeft className="h-5 w-5" />}
              </button>
              <button onClick={() => deleteBanner(b.id)} className="text-danger-400 hover:text-danger-600 transition-colors" title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ─── 2. Weekly Picks Toggles ──────────────────────────────────────────────────

function WeeklyPicksPanel() {
  const {
    loading,
    query,
    setQuery,
    toggling,
    schemaError,
    toggle,
    filtered,
    picksCount,
  } = useWeeklyPicks();

  if (schemaError) {
    return (
      <SectionShell title="Weekly Picks" sub="Toggle items to feature in the storefront grid.">
        <div className="rounded-lg border border-warn-200 bg-warn-50 px-4 py-3 text-sm text-warn-800">
          <strong>Schema migration required:</strong> Add column <code className="font-mono bg-warn-100 px-1 rounded">is_weekly_pick BOOLEAN DEFAULT false</code> to the <code className="font-mono bg-warn-100 px-1 rounded">items</code> table.
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell title="Weekly Picks" sub={`Toggle items to feature on the storefront. ${picksCount} active picks.`}>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search items..."
          className="w-full rounded-md border border-ink-200 py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ink-900"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-500"><Spinner /> Loading items...</div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-400">No items found.</p>
      ) : (
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 overflow-hidden max-h-[420px] overflow-y-auto">
          {filtered.map(item => (
            <div key={item.id} className="flex items-center gap-4 px-4 py-3 hover:bg-ink-50 transition-colors">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-ink-100">
                {item.image_url
                  ? <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full items-center justify-center"><Package className="h-4 w-4 text-ink-300" /></div>
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">{item.name}</p>
                <p className="text-xs text-ink-400">{item.shop?.name ?? '—'}</p>
              </div>
              {toggling === item.id
                ? <Spinner />
                : (
                  <button onClick={() => toggle(item)} className="transition-colors" title="Toggle weekly pick">
                    {item.is_weekly_pick
                      ? <ToggleRight className="h-6 w-6 text-ok-600" />
                      : <ToggleLeft className="h-6 w-6 text-ink-300" />
                    }
                  </button>
                )
              }
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ─── 3. Shop Logo Uploader ────────────────────────────────────────────────────

function ShopLogoPanel() {
  const {
    shops,
    loading,
    uploading,
    handleUpload,
    clearLogo,
  } = useShopLogoManager();
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  return (
    <SectionShell title="Shop Logo Uploader" sub="Upload square images to kithly-images/shops/logos/ and link to shops.logo_url.">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-500"><Spinner /> Loading shops...</div>
      ) : shops.length === 0 ? (
        <p className="text-sm text-ink-400">No shops found.</p>
      ) : (
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 overflow-hidden">
          {shops.map(shop => (
            <div key={shop.id} className="flex items-center gap-4 px-4 py-3 hover:bg-ink-50 transition-colors">
              {/* Current logo */}
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-ink-100">
                {shop.logo_url
                  ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full items-center justify-center"><Store className="h-5 w-5 text-ink-300" /></div>
                }
              </div>
              <p className="flex-1 truncate text-sm font-medium text-ink-900">{shop.name}</p>

              {/* Upload */}
              {uploading === shop.id ? (
                <Spinner />
              ) : (
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:border-ink-400 hover:text-ink-900 transition-colors">
                  <Upload className="h-3.5 w-3.5" />
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    ref={el => { fileInputs.current[shop.id] = el; }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(shop, f); }}
                  />
                </label>
              )}

              {shop.logo_url && (
                <button onClick={() => clearLogo(shop)} className="text-danger-400 hover:text-danger-600 transition-colors" title="Remove logo">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ─── 4. Category Feature Flags ────────────────────────────────────────────────

function CategoryFlagsPanel() {
  const {
    cats,
    loading,
    toggling,
    creating,
    deleting,
    schemaError,
    toggle,
    create,
    remove,
  } = useCategoryFlags();
  const [newName, setNewName] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await create(newName);
    if (ok) setNewName('');
  };

  if (schemaError) {
    return (
      <SectionShell title="Category Feature Flags" sub="Toggle which categories display on the storefront.">
        <div className="rounded-lg border border-warn-200 bg-warn-50 px-4 py-3 text-sm text-warn-800">
          <strong>Schema migration required:</strong> Create a <code className="font-mono bg-warn-100 px-1 rounded">categories</code> table with columns <code className="font-mono bg-warn-100 px-1 rounded">id, name, is_featured</code>. Run: <br />
          <code className="font-mono text-xs bg-warn-100 px-1 rounded block mt-1">CREATE TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, is_featured boolean DEFAULT false);</code>
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell title="Category Feature Flags" sub="Create categories and toggle which ones display in the storefront matrix.">
      {/* Add form */}
      <form onSubmit={handleCreate} className="flex gap-3 mb-6">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New category name"
          className="flex-1 rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900"
        />
        <button
          type="submit"
          aria-busy={creating}
          disabled={creating || !newName.trim()}
          className="flex items-center gap-2 rounded-md bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-700 disabled:opacity-50 transition-colors"
        >
          {creating ? <Spinner /> : <Tag className="h-4 w-4" />}
          Add Category
        </button>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-500"><Spinner /> Loading categories...</div>
      ) : cats.length === 0 ? (
        <p className="text-sm text-ink-400">No categories yet. Add one above.</p>
      ) : (
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 overflow-hidden">
          {cats.map(cat => (
            <div key={cat.id} className="flex items-center gap-4 px-4 py-3 hover:bg-ink-50 transition-colors">
              <Tag className="h-4 w-4 text-ink-300 shrink-0" />
              <p className="flex-1 text-sm font-medium text-ink-900">{cat.name}</p>
              <StatusTag ok={cat.is_featured} />
              {toggling === cat.id
                ? <Spinner />
                : (
                  <button onClick={() => toggle(cat)} className="transition-colors" title={cat.is_featured ? 'Unfeature' : 'Feature'}>
                    {cat.is_featured
                      ? <ToggleRight className="h-6 w-6 text-ok-600" />
                      : <ToggleLeft className="h-6 w-6 text-ink-300" />
                    }
                  </button>
                )
              }
              {deleting === cat.id
                ? <Spinner />
                : (
                  <button onClick={() => remove(cat)} className="text-danger-400 hover:text-danger-600 transition-colors" title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )
              }
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function AdminMerchandising() {
  const navigate = useNavigate();

  return (
    <PageShell>
      <AdminPageHeader
        title="Merchandising Controller"
        subtitle="Banners, weekly picks, shop logos and category flags"
        onBack={() => navigate('/admin')}
        actions={
          <Button
            onClick={() => navigate('/admin/shops')}
            className="bg-white text-primary hover:bg-white/90 h-8"
          >
            <Store className="size-3.5" />
            Manage Shops
          </Button>
        }
      />

      {/* Panels */}
      <PageBody className="space-y-6">
        <BannerManager />
        <WeeklyPicksPanel />
        <ShopLogoPanel />
        <CategoryFlagsPanel />
      </PageBody>
    </PageShell>
  );
}
