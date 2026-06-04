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
  { code: '+1',   flag: '🇺🇸', label: 'USA/Canada', iso: 'US' },
  { code: '+44',  flag: '🇬🇧', label: 'UK',         iso: 'GB' },
  { code: '+61',  flag: '🇦🇺', label: 'Australia',  iso: 'AU' },
];

export const DEFAULT_COUNTRY_CODE = '+260';

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

export function validateAndFormatPhone(phone: string): { isValid: boolean; formatted: string } {
  if (!phone) return { isValid: false, formatted: '' };
  const cleaned = phone.replace(/[^\d+]/g, '');

  // 🇿🇲 Zambia — 9 digits starting with 9x or 7x (x = 5, 6, 7)
  const zmMatch = cleaned.match(/^(?:\+?260|0)?([79][567]\d{7})$/);
  if (zmMatch) return { isValid: true, formatted: `+260${zmMatch[1]}` };

  // 🇺🇸 USA / Canada — NANP 10 digits, area code starts 2-9
  const usMatch = cleaned.match(/^(?:\+?1)?([2-9]\d{9})$/);
  if (usMatch) return { isValid: true, formatted: `+1${usMatch[1]}` };

  // 🇬🇧 UK — mobile starting with 7, 10 digits after 0/44
  const ukMatch = cleaned.match(/^(?:\+?44|0)?(7\d{9})$/);
  if (ukMatch) return { isValid: true, formatted: `+44${ukMatch[1]}` };

  // 🇦🇺 Australia — mobile starting with 4, 9 digits after 0/61
  const auMatch = cleaned.match(/^(?:\+?61|0)?(4\d{8})$/);
  if (auMatch) return { isValid: true, formatted: `+61${auMatch[1]}` };

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
