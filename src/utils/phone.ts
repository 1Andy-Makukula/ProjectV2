/**
 * Universal phone validation and formatting utility.
 *
 * Supports KithLy's primary diaspora markets:
 *   🇿🇲  Zambia     (+260)  — Airtel 97/77, MTN 96/76, Zamtel 95/75
 *   🇺🇸  USA/Canada (+1)    — NANP 10-digit
 *   🇬🇧  UK         (+44)   — Mobile 7xxx
 *   🇦🇺  Australia  (+61)   — Mobile 4xx
 *
 * All outputs are E.164 formatted (e.g. +260975123456).
 */

// ---------------------------------------------------------------------------
// Country code configuration — single source of truth for UI + validation
// ---------------------------------------------------------------------------

export interface CountryCode {
  code: string;   // E.164 dial code with '+'
  flag: string;   // Emoji flag
  label: string;  // Display label
  iso: string;    // ISO 3166-1 alpha-2
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: '+260', flag: '🇿🇲', label: 'Zambia',     iso: 'ZM' },
  { code: '+234', flag: '🇳🇬', label: 'Nigeria',    iso: 'NG' },
  { code: '+254', flag: '🇰🇪', label: 'Kenya',      iso: 'KE' },
  { code: '+27',  flag: '🇿🇦', label: 'South Africa', iso: 'ZA' },
  { code: '+233', flag: '🇬🇭', label: 'Ghana',      iso: 'GH' },
  { code: '+250', flag: '🇷🇼', label: 'Rwanda',     iso: 'RW' },
  { code: '+256', flag: '🇺🇬', label: 'Uganda',     iso: 'UG' },
  { code: '+255', flag: '🇹🇿', label: 'Tanzania',   iso: 'TZ' },
  { code: '+1',   flag: '🇺🇸', label: 'USA/Canada', iso: 'US' },
  { code: '+44',  flag: '🇬🇧', label: 'UK',         iso: 'GB' },
  { code: '+61',  flag: '🇦🇺', label: 'Australia',  iso: 'AU' },
  { code: '+971', flag: '🇦🇪', label: 'UAE',        iso: 'AE' },
  { code: '+91',  flag: '🇮🇳', label: 'India',      iso: 'IN' },
  { code: '+86',  flag: '🇨🇳', label: 'China',      iso: 'CN' },
];

export const DEFAULT_COUNTRY_CODE = '+260';

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

export function validateAndFormatPhone(phone: string): { isValid: boolean; formatted: string } {
  if (!phone) return { isValid: false, formatted: '' };
  
  const cleaned = phone.replace(/[^\d+]/g, '');

  // 🇿🇲 Zambia Strict validation — 9 digits starting with 9x or 7x
  const zmMatch = cleaned.match(/^(?:\+?260|0)?([79][567]\d{7})$/);
  if (zmMatch) return { isValid: true, formatted: `+260${zmMatch[1]}` };

  // 🇺🇸 USA / Canada Strict validation
  const usMatch = cleaned.match(/^(?:\+?1)?([2-9]\d{9})$/);
  if (usMatch) return { isValid: true, formatted: `+1${usMatch[1]}` };

  // Generic fallback for all other countries (E.164: + followed by 10 to 15 digits)
  // Ensure we at least have a valid looking international number
  if (cleaned.startsWith('+')) {
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) {
      return { isValid: true, formatted: `+${digits}` };
    }
  }

  // If they didn't supply a '+' but it's 10-15 digits, assume they just forgot the + 
  // (We rely on the UI to prepend the country code, so this shouldn't happen via PhoneInput)
  const genericDigits = cleaned.replace(/\D/g, '');
  if (genericDigits.length >= 10 && genericDigits.length <= 15) {
      return { isValid: true, formatted: `+${genericDigits}` };
  }

  return { isValid: false, formatted: phone };
}

// ---------------------------------------------------------------------------
// Display formatter — prettify an E.164 number for human reading
// ---------------------------------------------------------------------------

export function formatPhoneDisplay(phone: string): string {
  if (!phone) return '';

  // Zambia: +260 97 123 4567
  if (phone.startsWith('+260')) {
    const n = phone.slice(4);
    return `+260 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  }

  // USA/Canada: +1 (234) 567-8901
  if (phone.startsWith('+1') && phone.length === 12) {
    const n = phone.slice(2);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }

  // UK: +44 7911 123456
  if (phone.startsWith('+44')) {
    const n = phone.slice(3);
    return `+44 ${n.slice(0, 4)} ${n.slice(4)}`;
  }

  // Australia: +61 412 345 678
  if (phone.startsWith('+61')) {
    const n = phone.slice(3);
    return `+61 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }

  return phone;
}

// ---------------------------------------------------------------------------
// Legacy re-export — keeps existing call-sites working if any reference it
// ---------------------------------------------------------------------------

/** @deprecated Use `validateAndFormatPhone` instead. */
export const validateAndFormatZambianPhone = validateAndFormatPhone;
