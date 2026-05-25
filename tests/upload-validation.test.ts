import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, validateImageFile } from '../src/lib/uploadValidation';

describe('validateImageFile', () => {
  it('rejects oversize files', () => {
    const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.jpg', {
      type: 'image/jpeg',
    });
    const result = validateImageFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/5 MB/);
  });

  it('rejects non-image mime types', () => {
    const pdf = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    expect(validateImageFile(pdf).ok).toBe(false);
  });

  it('accepts png', () => {
    const png = new File([new Uint8Array(8)], 'a.png', { type: 'image/png' });
    const result = validateImageFile(png);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.extension).toBe('png');
  });
});
