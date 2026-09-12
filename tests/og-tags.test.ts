import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The link-preview tags in index.html.
 *
 * These exist because their absence is invisible. Facebook's and WhatsApp's
 * crawlers do not execute JavaScript, so index.html *is* the preview card for
 * every link this app shares — and when it carried no Open Graph tags at all,
 * nothing failed, no test went red, and every shared gift, list and shop link
 * simply arrived as a bare blue URL. The app looked fine the whole time.
 *
 * So this file asserts the tags are present rather than asserting their exact
 * wording: copy is allowed to change, silence is not.
 *
 * The per-route cards are built by supabase/functions/og, which CI type-checks
 * with `deno check`. See docs/og-previews.md.
 */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

describe('index.html link previews', () => {
  it('does not ship the test title', () => {
    // Shipped as <title>KithLyTest</title> until 2026-09-12 — the browser tab,
    // the bookmark name, and the fallback title on every shared link.
    expect(html).not.toMatch(/<title>\s*KithLyTest\s*<\/title>/i);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });

  it('carries the Open Graph tags a preview card needs', () => {
    for (const property of ['og:type', 'og:site_name', 'og:title', 'og:description']) {
      expect(html).toContain(`property="${property}"`);
    }
  });

  it('carries a meta description and Twitter card tags', () => {
    expect(html).toContain('name="description"');
    expect(html).toContain('name="twitter:card"');
  });

  it('gives every preview tag a non-empty content value', () => {
    const tags = html.match(/<meta\s+(?:property|name)="(?:og:|twitter:|description)[^"]*"[^>]*>/g);
    expect(tags).not.toBeNull();
    for (const tag of tags ?? []) {
      expect(tag, `empty content on ${tag}`).toMatch(/content="[^"]+"/);
    }
  });
});
