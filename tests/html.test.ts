import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../src/lib/html';

describe('escapeHtml', () => {
  it('escapes script injection', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes quotes', () => {
    expect(escapeHtml(`"onload="`)).toBe('&quot;onload=&quot;');
  });
});
