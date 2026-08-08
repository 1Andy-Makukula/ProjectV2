// Shop compliance documents — licences, permits, certificates.
//
// Deliberately free-form: the platform cannot enumerate the paperwork every
// Zambian trade requires, and a fixed list would block someone from uploading
// something legitimate.

export interface ShopDocument {
  id: string;
  shop_id: string;
  label: string;
  document_url: string;
  /** ISO date, or null for a document that does not expire. */
  expires_at: string | null;
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

  const expiry = new Date(`${doc.expires_at}T00:00:00`);
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
