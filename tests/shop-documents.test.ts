import { describe, it, expect } from 'vitest';
import {
  documentExpiry,
  documentsNeedingAttention,
  type ShopDocument,
} from '../src/app/types/shopDocuments';

// Local midday, not a UTC instant. An instant would land on a different
// calendar day depending on where the suite runs, so "expires today" would
// read as expired anywhere far enough east.
const NOW = new Date(2026, 7, 8, 12, 0, 0);

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
  // Uses the real clock, so the fixtures are pinned relative to today rather
  // than to fixed dates that would silently stop meaning anything.
  const daysFromNow = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  };

  it('picks out expired and expiring, leaving the rest', () => {
    const docs = [
      doc(null, 'permanent'),
      doc(daysFromNow(400), 'fine'),
      doc(daysFromNow(10), 'soon'),
      doc(daysFromNow(-30), 'lapsed'),
    ];

    expect(documentsNeedingAttention(docs).map((d) => d.id).sort()).toEqual(['lapsed', 'soon']);
  });
});
