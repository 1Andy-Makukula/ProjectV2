import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// WHY THIS EXISTS
// ---------------
// On 2026-09-20 every picture on the Welcome page silently failed to render.
// Nothing errored, nothing failed to typecheck, nothing failed to build, and
// the images themselves served 200. The tiles were simply empty.
//
// BreathingImage renders its host as:
//
//     <div className={`relative ${className}`}>
//
// and positions every frame inside it with `absolute inset-0`. A caller that
// passes `absolute inset-0` as `className` therefore produces a host carrying
// BOTH `.relative` and `.absolute`. They have equal specificity, so the winner
// is whichever Tailwind emits later -- and it emits `.relative` after
// `.absolute`. The host stays relative, `inset-0` does nothing to it, and
// because every child is absolutely positioned there is no content to give it
// height. It collapses to zero and the frames have nowhere to be drawn.
//
// theme.css already records this exact cascade trap for `.kl-rim`'s
// `position: relative` beating Tailwind's `fixed`. It cost an afternoon twice.
//
// The rule: a BreathingImage host is SIZED (`h-full w-full`, a height class, an
// aspect ratio) and never POSITIONED. Let it stay relative and let the frames
// position against it.
//
// This cannot be caught by the type system -- `className` is a string and every
// value is valid -- so it is caught here instead.

const root = join(__dirname, '..');

/**
 * Tailwind's position utilities. Any of these on the host fights the
 * `relative` BreathingImage applies itself.
 */
const POSITION = ['absolute', 'fixed', 'sticky', 'static', 'relative'];

const POSITION_IN_CLASSNAME = new RegExp(
  `className=(?:"|\\{\`)[^"\`]*\\b(?:${POSITION.join('|')})\\b`,
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx$/.test(entry.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(root, p).split(sep).join('/');

/**
 * The `className` prop of every `<BreathingImage ... />` in the tree.
 *
 * Deliberately crude: it reads the JSX between the opening tag and its `/>`
 * rather than parsing. A call site complicated enough to defeat this is a call
 * site worth simplifying.
 */
function breathingImageHostClasses(source: string): string[] {
  const found: string[] = [];
  let from = 0;

  for (;;) {
    const open = source.indexOf('<BreathingImage', from);
    if (open === -1) break;
    const close = source.indexOf('/>', open);
    if (close === -1) break;

    const tag = source.slice(open, close);
    // `imageClassName` is applied to the frames, which are SUPPOSED to be
    // absolute. Only the host's own `className` is the one under test.
    const host = tag.replace(/imageClassName=(?:"[^"]*"|\{`[^`]*`\})/g, '');
    const match = host.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
    if (match) found.push(match[1] ?? match[2] ?? '');

    from = close + 2;
  }

  return found;
}

describe('BreathingImage hosts', () => {
  it('are sized, never positioned', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(join(root, 'src'))) {
      if (rel(file).endsWith('BreathingImage.tsx')) continue;

      const source = readFileSync(file, 'utf8');
      for (const className of breathingImageHostClasses(source)) {
        const hit = POSITION.find((p) => new RegExp(`\\b${p}\\b`).test(className));
        if (hit) offenders.push(`${rel(file)}  className="${className.trim()}"  -> "${hit}"`);
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `A BreathingImage host carries a position utility in ${offenders.length} place(s).\n\n` +
          `BreathingImage already makes its host \`relative\` and absolutely\n` +
          `positions every frame inside it. A position class on the host fights\n` +
          `that at equal specificity, \`relative\` wins the cascade, the host\n` +
          `collapses to zero height, and the tile renders NO PICTURE -- with no\n` +
          `error anywhere.\n\n` +
          `Size the host instead: h-full w-full, a height class, or an aspect ratio.\n\n` +
          offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('catches the exact mistake that caused this', () => {
    const bad = `<BreathingImage id={t.id} sources={x} className="absolute inset-0" />`;
    expect(breathingImageHostClasses(bad)).toEqual(['absolute inset-0']);
  });

  it('does not mistake imageClassName for the host', () => {
    const good =
      '<BreathingImage id={t.id} sources={x} className="h-full w-full" ' +
      'imageClassName="absolute inset-0 object-cover" />';
    expect(breathingImageHostClasses(good)).toEqual(['h-full w-full']);
  });
});
