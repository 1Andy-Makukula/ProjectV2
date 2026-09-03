import { useState } from 'react';
import { Package, Search } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { useCatalog } from '../../hooks/useCatalog';
import { formatCurrency, toCents } from '../../../utils/currency';

interface CatalogImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  /** Called after a successful import so the caller can refresh its list. */
  onImported: () => void;
}

/**
 * Pick a ready-made listing and pull it into this shop.
 *
 * The price is asked for up front because it is the one thing that genuinely
 * differs per shop — the catalogue's suggested price is only a starting point,
 * and import_catalog_item_to_shop refuses an import without one.
 *
 * What lands in the shop is an independent copy: editing or retiring the
 * catalogue entry afterwards has no effect on it.
 */
export function CatalogImportDialog({
  open,
  onOpenChange,
  shopId,
  onImported,
}: CatalogImportDialogProps) {
  const { items, loading, importing, importToShop } = useCatalog();
  const [query, setQuery] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const available = items
    .filter((item) => item.is_active)
    .filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));

  const handleImport = async (catalogItemId: string, suggested: number | null) => {
    const typed = prices[catalogItemId]?.trim();
    const zmw = typed ? Number(typed) : suggested != null ? suggested / 100 : NaN;

    if (!Number.isFinite(zmw) || zmw <= 0) {
      setPrices((current) => ({ ...current, [catalogItemId]: current[catalogItemId] ?? '' }));
      return;
    }

    setPendingId(catalogItemId);
    const ok = await importToShop(catalogItemId, shopId, toCents(zmw));
    setPendingId(null);

    if (ok) {
      onImported();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from the catalogue</DialogTitle>
          <DialogDescription>
            You get your own copy — set your price now, and edit everything else afterwards
            without affecting anyone else.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the catalogue"
            className="pl-9"
          />
        </div>

        <DialogBody>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading catalogue…</p>
        ) : available.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query ? 'Nothing matches that search.' : 'The catalogue is empty right now.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {available.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {item.images[0] ? (
                    <img src={item.images[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Package className="size-5 text-muted-foreground/40" strokeWidth={1.5} />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs font-light text-muted-foreground">
                    {item.suggested_price_zmw != null
                      ? `Suggested ${formatCurrency(item.suggested_price_zmw, 'ZMW')}`
                      : 'No suggested price'}
                  </p>
                </div>

                <Badge variant="secondary">{item.item_type}</Badge>

                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label={`Your price for ${item.name}`}
                  value={
                    prices[item.id] ??
                    (item.suggested_price_zmw != null
                      ? String(item.suggested_price_zmw / 100)
                      : '')
                  }
                  onChange={(e) =>
                    setPrices((current) => ({ ...current, [item.id]: e.target.value }))
                  }
                  placeholder="Your price"
                  className="w-28"
                />

                <Button
                  size="sm"
                  disabled={importing}
                  onClick={() => handleImport(item.id, item.suggested_price_zmw)}
                >
                  {pendingId === item.id ? 'Importing…' : 'Import'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
