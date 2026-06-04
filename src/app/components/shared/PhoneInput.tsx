/**
 * PhoneInput — Country-code-aware phone number input.
 *
 * Renders a Radix Select dropdown (🇿🇲 +260, 🇺🇸 +1, …) alongside a
 * text input.  On every keystroke or country change the concatenated
 * value is pushed through `validateAndFormatPhone()` and surfaced via
 * `onChange(e164)` and `onValidation({ isValid, formatted })`.
 */

import { useState, useCallback, useId, useEffect, useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Input } from '../ui/input';
import { cn } from '../ui/utils';
import {
  COUNTRY_CODES,
  DEFAULT_COUNTRY_CODE,
  validateAndFormatPhone,
  type CountryCode,
} from '../../../utils/phone';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PhoneInputProps {
  /** Current E.164 value (e.g. "+260975123456") — controlled component */
  value: string;
  /** Fires with the raw concatenated string (code + local digits) */
  onChange: (value: string) => void;
  /** Optional validation callback */
  onValidation?: (result: { isValid: boolean; formatted: string }) => void;
  /** Field id for label association */
  id?: string;
  /** Placeholder for the local-number input */
  placeholder?: string;
  /** Apply invalid styling */
  'aria-invalid'?: boolean;
  /** Disable the entire control */
  disabled?: boolean;
  /** Additional classes on the outer wrapper */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Given a full phone value, split into { countryCode, localNumber } */
function splitPhoneValue(value: string): { countryCode: string; localNumber: string } {
  if (!value) return { countryCode: DEFAULT_COUNTRY_CODE, localNumber: '' };

  // Try matching against known codes (longest first to avoid +1 matching +1x)
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const cc of sorted) {
    if (value.startsWith(cc.code)) {
      return { countryCode: cc.code, localNumber: value.slice(cc.code.length) };
    }
  }

  return { countryCode: DEFAULT_COUNTRY_CODE, localNumber: value.replace(/^\+/, '') };
}

/** Derive placeholder hint from country code */
function getPlaceholder(code: string): string {
  switch (code) {
    case '+260': return '97 123 4567';
    case '+1':   return '(234) 567-8901';
    case '+44':  return '7911 123456';
    case '+61':  return '412 345 678';
    default:     return 'Phone number';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhoneInput({
  value,
  onChange,
  onValidation,
  id,
  placeholder,
  disabled,
  className,
  ...rest
}: PhoneInputProps) {
  const fallbackId = useId();
  const inputId = id || fallbackId;

  // Split incoming controlled value
  const { countryCode: initCode, localNumber: initLocal } = useMemo(
    () => splitPhoneValue(value),
    // Only recompute when the external value actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value],
  );

  const [selectedCode, setSelectedCode] = useState(initCode);
  const [localNumber, setLocalNumber] = useState(initLocal);

  // Sync when external value changes (e.g. form reset)
  useEffect(() => {
    const { countryCode, localNumber: ln } = splitPhoneValue(value);
    setSelectedCode(countryCode);
    setLocalNumber(ln);
  }, [value]);

  // Push changes upstream
  const emitChange = useCallback(
    (code: string, local: string) => {
      const raw = `${code}${local.replace(/\D/g, '')}`;
      onChange(raw);
      if (onValidation) {
        onValidation(validateAndFormatPhone(raw));
      }
    },
    [onChange, onValidation],
  );

  const handleCodeChange = useCallback(
    (code: string) => {
      setSelectedCode(code);
      emitChange(code, localNumber);
    },
    [localNumber, emitChange],
  );

  const handleLocalChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setLocalNumber(raw);
      emitChange(selectedCode, raw);
    },
    [selectedCode, emitChange],
  );

  const ariaInvalid = rest['aria-invalid'];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Country code selector */}
      <Select value={selectedCode} onValueChange={handleCodeChange} disabled={disabled}>
        <SelectTrigger
          id={`${inputId}-country`}
          className={cn(
            'w-[120px] shrink-0 h-10 rounded-xl border-slate-200',
            'focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200',
            ariaInvalid && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          )}
          aria-label="Country code"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COUNTRY_CODES.map((cc: CountryCode) => (
            <SelectItem key={cc.iso} value={cc.code}>
              <span className="flex items-center gap-2">
                <span className="text-base leading-none">{cc.flag}</span>
                <span className="font-mono text-xs">{cc.code}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Local number input */}
      <Input
        id={inputId}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={localNumber}
        onChange={handleLocalChange}
        placeholder={placeholder || getPlaceholder(selectedCode)}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className={cn(
          'flex-1 h-10 rounded-xl border-slate-200',
          'focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all duration-200',
          ariaInvalid && 'border-red-300 focus:border-red-400 focus:ring-red-100',
        )}
      />
    </div>
  );
}
