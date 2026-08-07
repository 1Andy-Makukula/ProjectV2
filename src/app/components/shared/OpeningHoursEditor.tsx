import { Copy } from 'lucide-react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { WEEKDAYS, type OpeningHours, type WeekdayKey } from '../../../utils/openingHours';

interface OpeningHoursEditorProps {
  value: OpeningHours;
  onChange: (next: OpeningHours) => void;
  disabled?: boolean;
}

/** What a day gets when it is first switched on. */
const DEFAULT_DAY = { open: '08:00', close: '17:00' } as const;

/**
 * Weekly trading hours editor.
 *
 * Writes the exact shape `shops.opening_hours` stores — a day that is switched
 * off is absent from the object rather than present-and-empty, which is what
 * `is_valid_opening_hours` expects and what the storefront reads as "closed".
 *
 * `<input type="time">` emits "HH:MM" natively, which is already the stored
 * format, so no parsing or formatting sits between this and the database.
 */
export function OpeningHoursEditor({ value, onChange, disabled }: OpeningHoursEditorProps) {
  const setDay = (day: WeekdayKey, next: { open: string; close: string } | null) => {
    const draft = { ...value };
    if (next) {
      draft[day] = next;
    } else {
      delete draft[day];
    }
    onChange(draft);
  };

  const openDays = WEEKDAYS.filter(({ key }) => value[key]);
  const monday = value.mon;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <Label>Opening Hours</Label>
        {monday && openDays.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const draft: OpeningHours = {};
              for (const { key } of openDays) draft[key] = { ...monday };
              onChange(draft);
            }}
          >
            <Copy className="size-3.5" strokeWidth={2} />
            Apply Monday to all open days
          </Button>
        )}
      </div>

      <p className="text-xs font-light text-muted-foreground">
        Shown on your storefront as an Open / Closed badge. Times are Zambian local time.
        Leave every day switched off to publish no hours at all.
      </p>

      <div className="rounded-lg border border-border divide-y divide-border">
        {WEEKDAYS.map(({ key, label }) => {
          const day = value[key];
          return (
            <div key={key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Switch
                id={`hours-${key}`}
                checked={Boolean(day)}
                disabled={disabled}
                onCheckedChange={(checked) => setDay(key, checked ? { ...DEFAULT_DAY } : null)}
              />
              <Label htmlFor={`hours-${key}`} className="w-24 shrink-0 font-normal">
                {label}
              </Label>

              {day ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label={`${label} opening time`}
                    value={day.open}
                    disabled={disabled}
                    onChange={(e) => setDay(key, { ...day, open: e.target.value })}
                    className="w-32"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input
                    type="time"
                    aria-label={`${label} closing time`}
                    value={day.close}
                    disabled={disabled}
                    onChange={(e) => setDay(key, { ...day, close: e.target.value })}
                    className="w-32"
                  />
                </div>
              ) : (
                <span className="text-sm font-light text-muted-foreground">Closed</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
