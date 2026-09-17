import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// WHY THIS EXISTS
// ---------------
// On 2026-09-17 about 2,065 colour decisions lived in components as raw
// Tailwind palette classes -- `text-slate-400`, `bg-orange-50`,
// `border-red-200` -- against roughly 1,100 that went through theme.css. Two
// thirds of the product's colour could not be reached from the token layer at
// all, so editing a token changed a third of the UI and no design change could
// be made from one place.
//
// They were migrated onto six ramps (ink, brand, danger, warn, ok, info), each
// with a hue and saturation knob in theme.css. That migration is worth nothing
// the moment the next component writes `text-slate-500` again, and nothing in
// TypeScript or the build would object: an unknown Tailwind class is not an
// error, it simply produces no CSS and the element silently inherits.
//
// So this is the ratchet. It is the only thing standing between the token layer
// and a slow return to where it started.

const root = join(__dirname, '..');

const FAMILIES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];
const SHADES = '50|100|200|300|400|500|600|700|800|900|950';

/** A complete Tailwind colour utility: <prefix>-<family>-<shade>. */
const RAW_PALETTE = new RegExp(
  `\\b[a-z][a-z-]*-(?:${FAMILIES.join('|')})-(?:${SHADES})\\b`,
  'g',
);

/** The ramps every colour must now come from. */
const RAMPS = ['ink', 'brand', 'danger', 'warn', 'ok', 'info'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(root, p).split(sep).join('/');

describe('design tokens', () => {
  it('no component uses a raw Tailwind palette class', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(join(root, 'src'))) {
      // theme.css is where the ramps are defined, and it names the palette
      // stops it derives from. It is the one file allowed to say "slate".
      if (rel(file) === 'src/styles/theme.css') continue;

      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const hits = line.match(RAW_PALETTE);
        if (hits) offenders.push(`${rel(file)}:${i + 1}  ${[...new Set(hits)].join(', ')}`);
      });
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Raw Tailwind palette classes are back in ${offenders.length} place(s).\n\n` +
          `Colour has to come from a ramp so it can be changed from one place.\n` +
          `Use: ${RAMPS.map(r => `${r}-50..900`).join(' · ')}\n\n` +
          `  slate/gray -> ink      orange -> brand     red/rose -> danger\n` +
          `  amber/yellow -> warn   green/emerald -> ok blue -> info\n\n` +
          offenders.map(o => `  ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('every ramp stop a component uses is defined in theme.css', () => {
    const theme = readFileSync(join(root, 'src/styles/theme.css'), 'utf8');

    // What components actually reference, e.g. text-ink-400 -> ink-400.
    const used = new Set<string>();
    const useRe = new RegExp(`\\b[a-z][a-z-]*-((?:${RAMPS.join('|')})-(?:${SHADES}))\\b`, 'g');
    for (const file of sourceFiles(join(root, 'src'))) {
      if (rel(file) === 'src/styles/theme.css') continue;
      for (const m of readFileSync(file, 'utf8').matchAll(useRe)) used.add(m[1]);
    }

    // A stop is usable only if it is BOTH a custom property and bridged into
    // Tailwind via @theme inline. Missing either one yields a class that
    // compiles to nothing, which is exactly the silent failure this guards.
    const missing = [...used].filter(
      stop => !theme.includes(`--${stop}:`) || !theme.includes(`--color-${stop}:`),
    );

    expect(
      missing.sort(),
      missing.length === 0
        ? ''
        : `These ramp stops are used by components but not fully defined in theme.css.\n` +
          `Each needs BOTH a --<stop> custom property in :root AND a\n` +
          `--color-<stop> entry in @theme inline, or the class produces no CSS:\n\n` +
          missing.map(m => `  ${m}`).join('\n'),
    ).toEqual([]);
  });

  it('each ramp exposes a hue and saturation knob', () => {
    const theme = readFileSync(join(root, 'src/styles/theme.css'), 'utf8');
    for (const ramp of RAMPS) {
      expect(theme, `--${ramp}-hue-shift is missing`).toContain(`--${ramp}-hue-shift:`);
      expect(theme, `--${ramp}-sat is missing`).toContain(`--${ramp}-sat:`);
    }
  });
});
