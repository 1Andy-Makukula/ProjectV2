import { AlertTriangle, Layers, Plus, Trash2 } from 'lucide-react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import type { PriceTier } from '../../types/items';

interface PriceTierEditorProps {
  /** Base unit price in ZMW (not ngwee) as typed into the form. */
  basePrice: string;
  tiers: PriceTier[];
  onChange: (next: PriceTier[]) => void;
  disabled?: boolean;
}

/**
 * Quantity breaks: buy this many, pay this much per unit.
 *
 * Replaces the single wholesale rate, which could only express one break and
 * was never applied at checkout anyway. Prices here are in ZMW for the
 * merchant's benefit and converted to ngwee on save, matching every other
 * price field on this form.
 *
 * The database validates each tier against the item's base price and rejects
 * anything that is not actually a discount; the inline warning here is so the
 * merchant finds out before saving rather than through a constraint violation.
 */
export function PriceTierEditor({ basePrice, tiers, onChange, disabled }: PriceTierEditorProps) {
  const base = Number(basePrice);
  const baseValid = Number.isFinite(base) && base > 0;

  const update = (index: number, patch: Partial<PriceTier>) => {
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  };

  const add = () => {
    // Each new row starts one step past the last, so repeated clicks build
    // 6 / 12 / 24 rather than colliding on the same threshold.
    const last = tiers[tiers.length - 1];
    onChange([
      ...tiers,
      {
        min_quantity: last ? last.min_quantity * 2 : 6,
        unit_price_zmw: 0,
      },
    ]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
            Bulk pricing
          </Label>
          <p className="text-sm font-light text-muted-foreground">
            Buy this many or more and every unit drops to the lower price. Checkout applies
            the best one the buyer qualifies for.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
          <Plus className="size-3.5" />
          Add tier
        </Button>
      </div>

      {tiers.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          {tiers.map((tier, index) => {
            const tooExpensive = baseValid && tier.unit_price_zmw >= base && tier.unit_price_zmw > 0;

            return (
              <div key={index} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Buy</span>
                  <Input
                    type="number"
                    min="2"
                    step="1"
                    aria-label={`Tier ${index + 1} minimum quantity`}
                    value={tier.min_quantity || ''}
                    disabled={disabled}
                    onChange={(e) => update(index, { min_quantity: Number(e.target.value) })}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">or more, pay ZMW</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label={`Tier ${index + 1} unit price`}
                    value={tier.unit_price_zmw || ''}
                    disabled={disabled}
                    onChange={(e) => update(index, { unit_price_zmw: Number(e.target.value) })}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">each</span>

                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(tiers.filter((_, i) => i !== index))}
                    aria-label={`Remove tier ${index + 1}`}
                    className="ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" strokeWidth={2} />
                  </button>
                </div>

                {/* Blocks the save. Names the likely mistake rather than
                    restating the rule — nine of ten existing wholesale prices
                    turned out to be the cost of the whole pack. */}
                {tooExpensive && (
                  <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                    <span>
                      Must be below your unit price of ZMW {base.toFixed(2)}. Enter the price of{' '}
                      <strong>one unit</strong> at this quantity, not the total for the pack.
                    </span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
