import { describe, it, expect } from 'vitest';
import {
  documentExpiry,
  documentsNeedingAttention,
  type ShopDocument,
} from '../src/app/types/shopDocuments';

const NOW = new Date('2026-08-08T14:30:00Z');

function doc(expires_at: string | null, id = 'd1'): ShopDocument {
  return {
    id,
    shop_id: 's1',
    label: 'Pharmacy practising licence',
    document_url: 'https://cdn/licence.pdf',
    expires_at,
    created_at: '2026-01-01T00:00:00Z',
  };
}

// The entire reason expiry is stored is that a lapsed licence and a valid one
// look identical if all you hold is a file.
describe('documentExpiry', () => {
  it('reports nothing for a document that does not expire', () => {
    expect(documentExpiry(doc(null), NOW).state).toBe('none');
  });

  it('reports a past date as expired', () => {
    expect(documentExpiry(doc('2026-07-31'), NOW).state).toBe('expired');
  });

  // A licence expiring today is still valid today. Comparing timestamps rather
  // than dates would mark it expired from midnight.
  it('treats the expiry day itself as still valid', () => {
    const result = documentExpiry(doc('2026-08-08'), NOW);
    expect(result.state).toBe('expiring');
    expect(result.label).toBe('today');
  });

  it('warns inside the notice window', () => {
    expect(documentExpiry(doc('2026-08-09'), NOW).label).toBe('tomorrow');
    expect(documentExpiry(doc('2026-08-20'), NOW)).toEqual({
      state: 'expiring',
      label: 'in 12 days',
    });
  });

  it('is simply valid well beyond the window', () => {
    const result = documentExpiry(doc('2027-03-01'), NOW);
    expect(result.state).toBe('valid');
    expect(result.label).toMatch(/2027/);
  });

  it('degrades to none rather than throwing on a malformed date', () => {
    expect(documentExpiry(doc('not-a-date'), NOW).state).toBe('none');
  });
});

describe('documentsNeedingAttention', () => {
  it('picks out expired and expiring, leaving the rest', () => {
    const docs = [
      doc(null, 'permanent'),
      doc('2027-03-01', 'fine'),
      doc('2026-08-20', 'soon'),
      doc('2026-01-01', 'lapsed'),
    ];
    // documentExpiry defaults to the real clock, so pin dates far enough out
    // that this stays true regardless of when the suite runs.
    const flagged = documentsNeedingAttention(docs).map((d) => d.id);
    expect(flagged).toContain('lapsed');
    expect(flagged).not.toContain('permanent');
  });
});
