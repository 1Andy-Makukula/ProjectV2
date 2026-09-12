/**
 * Performance baseline harness.
 *
 * Stage 0 of the V3 plan asks for a number rather than an impression. This
 * measures the one that decides how a phone in Lusaka experiences KithLy: the
 * bytes that must arrive before anything is interactive.
 *
 * WHAT IT MEASURES, AND WHY THAT AND NOT "BUNDLE SIZE"
 * ---------------------------------------------------
 * "Main bundle" is a misleading figure here. `index.js` is only one of six
 * files the browser is told to fetch immediately -- Vite emits a
 * <link rel="modulepreload"> for every vendor chunk the entry depends on, so
 * they are all on the critical path even though none is "the bundle".
 *
 * So this reads dist/index.html and measures exactly what it asks for:
 * the entry script, every preloaded module, and the stylesheet. That total is
 * the number a later stage must not quietly make worse.
 *
 * GZIP, NOT RAW
 * -------------
 * Transfer size is what costs time on a metered 3G connection. Raw size is
 * reported alongside because it is what the device must then parse, which is
 * the half that hurts on a cheap Android CPU.
 *
 * TWO THRESHOLDS, DELIBERATELY
 * ----------------------------
 * `ceiling` is a ratchet: the measured baseline plus a small margin. Exceeding
 * it fails, because that means a stage made the app slower and should say so
 * before it lands.
 *
 * `target` is where this should end up. It is not enforced -- failing a build
 * for a goal nobody has done the work for yet would only teach people to pass
 * --no-check. It is printed every run so the gap stays visible.
 *
 *   pnpm build && node scripts/perf-baseline.mjs
 *   node scripts/perf-baseline.mjs --json      # machine-readable
 *   node scripts/perf-baseline.mjs --update    # rewrite the recorded baseline
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const RECORD = join(ROOT, 'docs', 'performance-baseline.json');

/* Both in gzipped bytes, for the critical path as a whole. See header. */
const CEILING = 500 * 1024;
const TARGET = 250 * 1024;

const asJson = process.argv.includes('--json');
const update = process.argv.includes('--update');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No dist/index.html. Run `pnpm build` first.');
  process.exit(2);
}

/**
 * Everything index.html tells the browser to fetch before it can render.
 *
 * Matches the entry <script src>, every <link rel="modulepreload" href> and
 * every stylesheet. Anything reached later by a dynamic import is not here,
 * which is the point -- a lazy route is not on the critical path.
 */
function criticalPath() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const seen = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) seen.add(m[1]);
  return [...seen]
    .map((url) => {
      const path = join(DIST, url.replace(/^\//, ''));
      if (!existsSync(path)) return null;
      const buf = readFileSync(path);
      return { name: basename(path), url, raw: buf.length, gzip: gzipSync(buf).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.gzip - a.gzip);
}

/** The heaviest chunks that are NOT on the critical path, for context. */
function heaviestLazy(critical) {
  const onPath = new Set(critical.map((f) => f.name));
  const assets = join(DIST, 'assets');
  if (!existsSync(assets)) return [];
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js') && !onPath.has(f))
    .map((f) => {
      const path = join(assets, f);
      if (!statSync(path).isFile()) return null;
      const buf = readFileSync(path);
      return { name: f, raw: buf.length, gzip: gzipSync(buf).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.gzip - a.gzip)
    .slice(0, 5);
}

const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' KB';

const files = criticalPath();
const totalGzip = files.reduce((n, f) => n + f.gzip, 0);
const totalRaw = files.reduce((n, f) => n + f.raw, 0);

const result = {
  measuredAt: new Date().toISOString().slice(0, 10),
  criticalPath: { gzip: totalGzip, raw: totalRaw, files },
  ceiling: CEILING,
  target: TARGET,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('\nCritical path — what loads before anything is interactive\n');
  for (const f of files) {
    console.log(`  ${f.name.padEnd(34)} ${kb(f.raw)} raw   ${kb(f.gzip)} gzip`);
  }
  console.log('  ' + '-'.repeat(64));
  console.log(`  ${'TOTAL'.padEnd(34)} ${kb(totalRaw)} raw   ${kb(totalGzip)} gzip\n`);
  console.log(`  ceiling ${kb(CEILING)} gzip   ${totalGzip <= CEILING ? 'OK' : 'EXCEEDED'}`);
  console.log(`  target  ${kb(TARGET)} gzip   ${(totalGzip / TARGET).toFixed(2)}x over\n`);

  const lazy = heaviestLazy(files);
  if (lazy.length) {
    console.log('Heaviest lazy chunks (not on the critical path)\n');
    for (const f of lazy) console.log(`  ${f.name.padEnd(34)} ${kb(f.gzip)} gzip`);
    console.log('');
  }
}

if (update) {
  writeFileSync(RECORD, JSON.stringify(result, null, 2) + '\n');
  console.log(`Recorded baseline -> ${RECORD}`);
}

if (totalGzip > CEILING) {
  console.error(`Critical path ${kb(totalGzip)} gzip exceeds the ${kb(CEILING)} ceiling.`);
  process.exit(1);
}
