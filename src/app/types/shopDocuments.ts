// Shop compliance documents — licences, permits, certificates.
//
// Deliberately free-form: the platform cannot enumerate the paperwork every
// Zambian trade requires, and a fixed list would block someone from uploading
// something legitimate.

/** The private bucket compliance paperwork lives in. Never public. */
export const SHOP_DOCUMENTS_BUCKET = 'shop-documents';

/** How long a generated view link stays valid. Long enough to open, no longer. */
export const SIGNED_URL_TTL_SECONDS = 60;

export interface ShopDocument {
  id: string;
  shop_id: string;
  label: string;
  /**
   * Object path inside the private bucket, not a URL.
   *
   * A signed URL expires, so storing one would be meaningless; the path is the
   * durable reference and a link is minted per view for whoever is entitled to
   * it. Storing a public URL is what made these readable by anyone.
   */
  storage_path: string;
  /** ISO date, or null for a document that does not expire. */
  expires_at: string | null;
  /**
   * Set when the merchant retires it. The row and its file are kept — these are
   * audit records, so a merchant can stop showing one but cannot destroy it.
   */
  archived_at: string | null;
  created_at: string;
}

export type ExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

export interface DocumentExpiry {
  state: ExpiryState;
  /** Human-readable date, or a relative phrase when it matters. */
  label: string;
}

/** Inside this window a document is flagged as about to lapse. */
export const EXPIRY_WARNING_DAYS = 30;

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * How a document's expiry should read.
 *
 * The whole reason expiry is stored is that a lapsed licence and a valid one
 * are indistinguishable if all you hold is a file — so a date alone is not
 * enough, the state has to be computed and shown.
 *
 * Compared date-only: a licence expiring today is still valid today, and
 * comparing timestamps would mark it expired from midnight.
 */
export function documentExpiry(
  doc: Pick<ShopDocument, 'expires_at'>,
  now: Date = new Date(),
): DocumentExpiry {
  if (!doc.expires_at) return { state: 'none', label: '' };

  // Compared as calendar dates, in whichever timezone the viewer is in.
  //
  // `new Date('2026-08-08')` parses as UTC midnight while `now` is a local
  // instant, so mixing the two shifted the comparison by a day for anyone far
  // enough from UTC — a licence expiring today read as expired in Auckland.
  // Both sides are therefore reduced to local Y/M/D before subtracting.
  const parts = doc.expires_at.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { state: 'none', label: '' };
  }

  const expiry = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(expiry.getTime())) return { state: 'none', label: '' };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return { state: 'expired', label: formatDate(expiry) };
  if (days <= EXPIRY_WARNING_DAYS) {
    return {
      state: 'expiring',
      label: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`,
    };
  }
  return { state: 'valid', label: formatDate(expiry) };
}

/** Documents needing attention, for a compliance summary. */
export function documentsNeedingAttention(docs: ShopDocument[]): ShopDocument[] {
  return docs.filter((doc) => {
    const state = documentExpiry(doc).state;
    return state === 'expired' || state === 'expiring';
  });
}
