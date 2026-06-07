// AdminMerchandising — Full storefront control panel at '/admin-merch'
// Manages: Banners · Weekly Picks · Shop Logos · Category Flags

import { useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft, Upload, Trash2, ToggleLeft, ToggleRight,
  Search, Store, Package, Tag, RefreshCw,
} from 'lucide-react';
import { useBannerManager, Banner } from '../../hooks/useBannerManager';
import { useWeeklyPicks, Item } from '../../hooks/useWeeklyPicks';
import { useShopLogoManager, ShopRow } from '../../hooks/useShopLogoManager';
import { useCategoryFlags, Category } from '../../hooks/useCategoryFlags';

// ─── Generic helpers ──────────────────────────────────────────────────────────

function cls(...args: (string | false | undefined | null)[]) {
  return args.filter(Boolean).join(' ');
}

function SectionShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" aria-hidden />;
}

function StatusTag({ ok }: { ok: boolean }) {
  return (
    <span className={cls('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1',
      ok ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-slate-50 text-slate-500 ring-slate-200'
    )}>
      <span className={cls('h-1.5 w-1.5 rounded-full', ok ? 'bg-green-500' : 'bg-slate-400')} />
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
    <SectionShell title="Banner / Campaign Manager" sub="Manages the hero carousel on the storefront. Table: banners.">
      {/* Add form */}
      <form onSubmit={handleFormSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto_auto] mb-6">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Title</label>
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Campaign headline"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Sort Order</label>
          <input
            type="number" min="0" value={sortOrder} onChange={e => setSortOrder(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Image</label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-slate-500 transition-colors">
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
            className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Spinner /> : <Upload className="h-4 w-4" />}
            Add Banner
          </button>
        </div>
      </form>

      {preview && (
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 h-32 w-full">
          <img src={preview} alt="Preview" className="h-full w-full object-cover" />
        </div>
      )}

      {/* Banner list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading banners...</div>
      ) : banners.length === 0 ? (
        <p className="text-sm text-slate-400">No banners yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
          {banners.map(b => (
            <div key={b.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
              <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-slate-100">
                <img src={b.image_url} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{b.title}</p>
                <p className="text-xs text-slate-400">Sort: {b.sort_order}</p>
              </div>
              <StatusTag ok={b.is_active} />
              <button onClick={() => toggleActive(b)} className="text-slate-400 hover:text-slate-700 transition-colors" title={b.is_active ? 'Deactivate' : 'Activate'}>
                {b.is_active ? <ToggleRight className="h-5 w-5 text-green-600" /> : <ToggleLeft className="h-5 w-5" />}
              </button>
              <button onClick={() => deleteBanner(b.id)} className="text-red-400 hover:text-red-600 transition-colors" title="Delete">
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
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Schema migration required:</strong> Add column <code className="font-mono bg-amber-100 px-1 rounded">is_weekly_pick BOOLEAN DEFAULT false</code> to the <code className="font-mono bg-amber-100 px-1 rounded">items</code> table.
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell title="Weekly Picks" sub={`Toggle items to feature on the storefront. ${picksCount} active picks.`}>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search items..."
          className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading items...</div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400">No items found.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden max-h-[420px] overflow-y-auto">
          {filtered.map(item => (
            <div key={item.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-slate-100">
                {item.image_url
                  ? <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full items-center justify-center"><Package className="h-4 w-4 text-slate-300" /></div>
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                <p className="text-xs text-slate-400">{item.shop?.name ?? '—'}</p>
              </div>
              {toggling === item.id
                ? <Spinner />
                : (
                  <button onClick={() => toggle(item)} className="transition-colors" title="Toggle weekly pick">
                    {item.is_weekly_pick
                      ? <ToggleRight className="h-6 w-6 text-green-600" />
                      : <ToggleLeft className="h-6 w-6 text-slate-300" />
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
        <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading shops...</div>
      ) : shops.length === 0 ? (
        <p className="text-sm text-slate-400">No shops found.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
          {shops.map(shop => (
            <div key={shop.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
              {/* Current logo */}
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                {shop.logo_url
                  ? <img src={shop.logo_url} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full items-center justify-center"><Store className="h-5 w-5 text-slate-300" /></div>
                }
              </div>
              <p className="flex-1 truncate text-sm font-medium text-slate-900">{shop.name}</p>

              {/* Upload */}
              {uploading === shop.id ? (
                <Spinner />
              ) : (
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900 transition-colors">
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
                <button onClick={() => clearLogo(shop)} className="text-red-400 hover:text-red-600 transition-colors" title="Remove logo">
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
    schemaError,
    toggle,
  } = useCategoryFlags();

  if (schemaError) {
    return (
      <SectionShell title="Category Feature Flags" sub="Toggle which categories display on the storefront.">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Schema migration required:</strong> Create a <code className="font-mono bg-amber-100 px-1 rounded">categories</code> table with columns <code className="font-mono bg-amber-100 px-1 rounded">id, name, is_featured</code>. Run: <br />
          <code className="font-mono text-xs bg-amber-100 px-1 rounded block mt-1">CREATE TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, is_featured boolean DEFAULT false);</code>
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell title="Category Feature Flags" sub="Toggle which categories display in the storefront matrix.">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading categories...</div>
      ) : cats.length === 0 ? (
        <p className="text-sm text-slate-400">No categories found. Insert rows into the <code className="font-mono text-xs">categories</code> table.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
          {cats.map(cat => (
            <div key={cat.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
              <Tag className="h-4 w-4 text-slate-300 shrink-0" />
              <p className="flex-1 text-sm font-medium text-slate-900">{cat.name}</p>
              <StatusTag ok={cat.is_featured} />
              {toggling === cat.id
                ? <Spinner />
                : (
                  <button onClick={() => toggle(cat)} className="transition-colors">
                    {cat.is_featured
                      ? <ToggleRight className="h-6 w-6 text-green-600" />
                      : <ToggleLeft className="h-6 w-6 text-slate-300" />
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

// ─── Root component ───────────────────────────────────────────────────────────

export function AdminMerchandising() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-5 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/admin')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Admin</p>
              <h1 className="text-base font-bold text-slate-900 leading-tight">Merchandising Controller</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/admin/shops')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
            >
              <Store className="h-3.5 w-3.5" />
              Manage Shops
            </button>
            <button
              onClick={() => navigate('/admin')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Admin Home
            </button>
          </div>
        </div>
      </div>

      {/* Panels */}
      <div className="mx-auto max-w-5xl px-5 sm:px-8 py-8 space-y-6">
        <BannerManager />
        <WeeklyPicksPanel />
        <ShopLogoPanel />
        <CategoryFlagsPanel />
      </div>
    </div>
  );
}
