// KithLy Formatters - All data display must pass through these

/**
 * Format Zambian Kwacha (ZMW) with proper currency formatting
 */
export function formatZMW(amount: number): string {
  // Values are stored as ngwee/cents in the database, divide by 100 for display
  return `ZMW ${(amount / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}


/**
 * Generate 8-character handshake claim code
 * Format: XXXX-XXXX
 */
export function generateClaimCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars (0, O, I, 1)
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Validate NRC format (Zambian National Registration Card)
 * Format: 123456/78/9
 */
export function validateNRC(nrc: string): boolean {
  const nrcRegex = /^\d{6}\/\d{2}\/\d$/;
  return nrcRegex.test(nrc);
}

/**
 * Validate TPIN format (Taxpayer Identification Number)
 * Format: 10 digits
 */
export function validateTPIN(tpin: string): boolean {
  const tpinRegex = /^\d{10}$/;
  return tpinRegex.test(tpin);
}

/**
 * Format phone number for display.
 * Supports Zambia (+260), USA/Canada (+1), UK (+44), Australia (+61).
 *
 * @deprecated Prefer importing `formatPhoneDisplay` from `@/utils/phone` directly.
 */
export { formatPhoneDisplay as formatPhoneZM } from '../../utils/phone';

/**
 * Calculate days remaining until expiration
 */
export function daysUntilExpiry(expiryDate: string): number {
  const now = new Date();
  const expiry = new Date(expiryDate);
  const diff = expiry.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Format relative time (e.g., "2 days ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
