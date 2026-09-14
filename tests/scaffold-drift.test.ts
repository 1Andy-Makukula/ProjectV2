import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// WHY THIS EXISTS
// ---------------
// tests/sql/scaffold.sql stubs the tables the migration suite runs against. It
// is hand-written, and on 2026-09-14 that produced exactly the failure it was
// built to prevent: a migration needed a timestamp on `shop_orders`, the
// scaffold was given `updated_at` to satisfy it, every assertion passed, and
// `supabase db push` then failed against production with
//
//     ERROR: column so.updated_at does not exist
//
// The scaffold had made a false assumption true. A harness that can invent the
// schema it is testing against is worse than no harness, because it converts an
// obvious failure into a confident pass.
//
// So: every column the scaffold declares for a real table must exist in
// src/types/database.types.ts, which CLAUDE.md names as canonical and which is
// generated from the database rather than written by hand.
//
// This runs offline with no credentials, so it guards the same thing in CI as
// it does here.

const root = join(__dirname, '..');

/** Columns the scaffold declares, per public table. */
function scaffoldColumns(): Map<string, Set<string>> {
  const sql = readFileSync(join(root, 'tests/sql/scaffold.sql'), 'utf8');
  const tables = new Map<string, Set<string>>();

  const add = (table: string, column: string) => {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table)!.add(column);
  };

  // CREATE TABLE public.x ( ... );
  const createRe = /CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g;
  for (let m = createRe.exec(sql); m; m = createRe.exec(sql)) {
    const [, table, body] = m;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/--.*$/, '').trim();
      if (!line) continue;
      // Skip table-level constraint clauses; only column definitions count.
      if (/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i.test(line)) continue;
      const col = /^([a-z_][a-z0-9_]*)\s+\S/i.exec(line);
      if (col) add(table, col[1]);
    }
  }

  // ALTER TABLE public.x ADD COLUMN [IF NOT EXISTS] y ...
  const alterRe =
    /ALTER TABLE (?:IF EXISTS )?public\.(\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/gi;
  for (let m = alterRe.exec(sql); m; m = alterRe.exec(sql)) {
    add(m[1], m[2]);
  }

  return tables;
}

/** Columns the generated types say each table really has. */
function realColumns(): Map<string, Set<string>> {
  const source = readFileSync(join(root, 'src/types/database.types.ts'), 'utf8');
  const tables = new Map<string, Set<string>>();

  // Each table appears as `name: { Row: { ... } ... }`.
  const tableRe = /^ {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  for (let m = tableRe.exec(source); m; m = tableRe.exec(source)) {
    const [, table, body] = m;
    const columns = new Set<string>();
    for (const line of body.split('\n')) {
      const col = /^\s{10}(\w+)\??:/.exec(line);
      if (col) columns.add(col[1]);
    }
    if (columns.size > 0) tables.set(table, columns);
  }

  return tables;
}

describe('the SQL scaffold does not invent schema', () => {
  const scaffold = scaffoldColumns();
  const real = realColumns();

  it('parsed both sides', () => {
    // A regex that silently matches nothing would make every assertion below
    // pass vacuously -- the same class of bug this file exists to catch.
    expect(scaffold.size).toBeGreaterThan(5);
    expect(real.size).toBeGreaterThan(20);
    expect(real.get('shop_orders')?.size ?? 0).toBeGreaterThan(5);
  });

  it('declares only columns the real tables have', () => {
    const invented: string[] = [];

    for (const [table, columns] of scaffold) {
      const actual = real.get(table);
      // A table the generated types do not know about is not a real table --
      // it is a fixture, and it is free to look however the tests need.
      if (!actual) continue;

      for (const column of columns) {
        if (!actual.has(column)) invented.push(`${table}.${column}`);
      }
    }

    expect(
      invented,
      `The scaffold declares columns that do not exist in the real schema:\n` +
        invented.map((c) => `  - ${c}`).join('\n') +
        `\n\nA migration written against these will pass here and fail on ` +
        `\`supabase db push\`. Check src/types/database.types.ts for the real ` +
        `column, or regenerate it if the schema has moved on.`,
    ).toEqual([]);
  });

  it('still remembers the column that caused this test to exist', () => {
    // shop_orders has fulfilled_at and has never had updated_at. Pinned so the
    // specific mistake cannot quietly return.
    expect(real.get('shop_orders')?.has('fulfilled_at')).toBe(true);
    expect(real.get('shop_orders')?.has('updated_at')).toBe(false);
    expect(scaffold.get('shop_orders')?.has('updated_at')).toBe(false);
  });
});
