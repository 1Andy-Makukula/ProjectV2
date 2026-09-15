import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// WHY THIS EXISTS
// ---------------
// On 2026-09-15, 20260914096000_gift_issue_reports.sql reached production and
// failed mid-push:
//
//     ERROR: column so.buyer_id does not exist (SQLSTATE 42703)
//
// `shop_orders` has no buyer_id. One transaction can span several shops, so the
// buyer is a property of the payment -- it lives on `transactions`. The
// migration had been verified against a throwaway PostgreSQL cluster, but the
// stub tables for that cluster were hand-written from the same wrong assumption
// as the migration, so the fixture made the false assumption true and every
// assertion passed.
//
// That is exactly the failure tests/scaffold-drift.test.ts was built to stop,
// reached by a different route: scaffold-drift guards tests/sql/scaffold.sql,
// and these migrations were never added to scripts/sql-test.sh, so nothing
// looked at them at all.
//
// So this checks migrations directly, against src/types/database.types.ts --
// which CLAUDE.md names as canonical and which is generated from the database
// rather than written by anyone. It needs no database and no credentials, so it
// guards the same thing in CI as it does locally.
//
// WHAT IT CANNOT DO
// -----------------
// It only resolves columns through an explicit alias (`FROM public.x y` then
// `y.col`). Unaliased references, dynamic SQL and PL/pgSQL record fields are
// invisible to it.
//
// Aliases are also tracked per file rather than per statement, last one wins.
// A file that uses `t` for `transactions` in one statement and `shop_orders` in
// another can therefore hide a bad column behind the other table's definition.
// Found by trying to mutate this very migration to re-break it and watching the
// test stay green -- so reusing one alias for two tables in a single migration
// is worth avoiding regardless of readability.
//
// It is a cheap net for the specific mistake that cost a production deploy, not
// a SQL parser.

const root = join(__dirname, '..');
const migrationsDir = join(root, 'supabase/migrations');

// Migrations that reference columns the schema no longer has.
//
// These are historical: they ran against the schema as it stood at the time and
// are immutable now, so the drift is a record of the schema moving on rather
// than a bug to fix. Grandfathered by name so new drift cannot hide among them.
// Do not add to this list -- a new entry means a migration that will fail on
// `supabase db push`.
const GRANDFATHERED = new Set([
  '20260809190000_release_abandoned_checkouts.sql',
  '20260912070000_contact_groups.sql',
  '20260913020000_occasion_lead_times.sql',
  '20260913040000_wallet_provenance_and_budgets.sql',
  '20260914080000_slate.sql',
]);

/** Table -> column names, from the generated types. */
function canonicalSchema(): Map<string, Set<string>> {
  const src = readFileSync(join(root, 'src/types/database.types.ts'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const tables = new Map<string, Set<string>>();
  const tableRe = /^ {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  for (let m = tableRe.exec(src); m; m = tableRe.exec(src)) {
    const columns = new Set<string>();
    for (const line of m[2].split('\n')) {
      const col = /^\s{10}(\w+)\??:/.exec(line);
      if (col) columns.add(col[1]);
    }
    if (columns.size > 0) tables.set(m[1], columns);
  }
  return tables;
}

// Words that can follow `FROM public.x` without being an alias.
const NOT_AN_ALIAS = new Set([
  'set', 'where', 'on', 'using', 'values', 'select', 'order', 'group', 'limit',
  'for', 'inner', 'left', 'right', 'join', 'as', 'returning', 'union', 'having',
  'and', 'or', 'loop', 'into',
]);

function inventedReferences(sql: string, real: Map<string, Set<string>>): string[] {
  // Comments are stripped first: these files explain their own history, and a
  // note saying "an earlier version read so.buyer_id" is not a reference.
  const body = sql.replace(/--[^\n]*/g, '');

  const aliases = new Map<string, string>();
  const aliasRe = /\b(?:FROM|JOIN|UPDATE)\s+public\.(\w+)\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b/gi;
  for (const m of body.matchAll(aliasRe)) {
    if (NOT_AN_ALIAS.has(m[2].toLowerCase())) continue;
    aliases.set(m[2], m[1]);
  }

  const problems = new Set<string>();
  for (const [alias, table] of aliases) {
    const columns = real.get(table);
    // A table the generated types do not know is one this migration creates,
    // or a fixture. Either way it is not drift.
    if (!columns) continue;
    for (const c of body.matchAll(new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)`, 'g'))) {
      if (!columns.has(c[1])) problems.add(`${table}.${c[1]}`);
    }
  }
  return [...problems];
}

describe('migrations reference columns that exist', () => {
  const real = canonicalSchema();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  it('parsed the canonical schema', () => {
    // A regex matching nothing would make every case below pass vacuously --
    // the same shape of bug this file exists to catch. scaffold-drift was
    // silently doing exactly that on Windows until 2026-09-15.
    expect(real.size).toBeGreaterThan(20);
    expect(real.get('shop_orders')?.has('transaction_id')).toBe(true);
    expect(real.get('shop_orders')?.has('buyer_id')).toBe(false);
    expect(real.get('transactions')?.has('buyer_id')).toBe(true);
    expect(files.length).toBeGreaterThan(50);
  });

  it('declares no column the real schema lacks', () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (GRANDFATHERED.has(file)) continue;
      const found = inventedReferences(readFileSync(join(migrationsDir, file), 'utf8'), real);
      for (const ref of found) offenders.push(`${file}: ${ref}`);
    }

    expect(
      offenders,
      'These migrations reference columns that do not exist in ' +
        'src/types/database.types.ts:\n' +
        offenders.map((o) => `  - ${o}`).join('\n') +
        '\n\nEach one will fail on `supabase db push` with SQLSTATE 42703, ' +
        'after any earlier statements in the same file have already been ' +
        'attempted. Check the generated types for the real column, or ' +
        'regenerate them if the schema has genuinely moved on.',
    ).toEqual([]);
  });

  it('still catches the reference that caused this test to exist', () => {
    // Pinned so the specific mistake cannot quietly return: shop_orders.buyer_id
    // must stay detectable, and the detector must stay honest about comments.
    const withBug = `
      CREATE POLICY p ON public.x FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.shop_orders so WHERE so.buyer_id = auth.uid())
      );`;
    expect(inventedReferences(withBug, real)).toEqual(['shop_orders.buyer_id']);

    const commentOnly = `
      -- An earlier version of this policy read so.buyer_id and failed.
      SELECT 1 FROM public.shop_orders so WHERE so.transaction_id IS NOT NULL;`;
    expect(inventedReferences(commentOnly, real)).toEqual([]);
  });
});
