# SQL migration tests

`pnpm typecheck` excludes `supabase/` and Deno is not installed on most machines
here, so **neither migrations nor edge functions are covered by the standard
commands**. That gap is how a migration reaches production having only ever been
read, never run.

These files close it for migrations. They run a migration against a throwaway
PostgreSQL cluster and assert its behaviour — constraints, RLS, idempotency —
rather than trusting it by eye.

## Running

Needs a local PostgreSQL 18 (`C:\Program Files\PostgreSQL\18\bin` on this
machine). Nothing here touches Supabase or any deployed database.

```bash
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
SCRATCH=/c/Users/Owner/AppData/Local/Temp/kithlypg

initdb -D "$SCRATCH/data" -U postgres -A trust -E UTF8
pg_ctl -D "$SCRATCH/data" \
  -o "-p 54399 -c listen_addresses=localhost -c unix_socket_directories=" \
  -l "$SCRATCH/log" start

psql -h localhost -p 54399 -U postgres -c "CREATE DATABASE kithly;"
psql -h localhost -p 54399 -U postgres -d kithly -v ON_ERROR_STOP=1 \
  -f tests/sql/scaffold.sql

# the shared date engine, extracted from the migration that defines it
sed -n '57,129p' supabase/migrations/20260904010000_occasion_reminders.sql \
  | psql -h localhost -p 54399 -U postgres -d kithly -v ON_ERROR_STOP=1

psql -h localhost -p 54399 -U postgres -d kithly -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260912060000_countries_and_holidays.sql
psql -h localhost -p 54399 -U postgres -d kithly \
  -f tests/sql/assert_countries_and_holidays.sql
```

`unix_socket_directories=` is empty deliberately: a scratch path here exceeds
the 107-byte socket limit and the cluster will not start without it.

## scaffold.sql

Enough of a Supabase-shaped database for a migration to run: the three roles,
`auth.uid()` / `auth.jwt()` stubs driven by `test.uid` / `test.jwt` settings, and
the handful of tables Stage 1 references by foreign key. **Not** a replica —
extend it as later migrations need more.

Two things in it were learned the hard way and must not be removed:

**Supabase's default privileges.** Without `ALTER DEFAULT PRIVILEGES ... GRANT
ALL ON TABLES TO anon, authenticated`, every RLS test is a false negative: a role
with no table grant fails with `permission denied` *before any policy is
consulted*, which looks exactly like a policy correctly denying. No migration in
this repo grants table privileges — `claim_status_feed` is anon-readable in
production with none of its own — so the platform default is the convention and
the scaffold has to reproduce it.

**Conditional role creation.** Roles are cluster-level and survive
`DROP DATABASE`, so a plain `CREATE ROLE` aborts the second run.

**RLS enabled *and* the policy, on every stubbed table.** This one bites twice.
RLS is off by default on a new table, so a stub is wide open while the real
table has it on — and an RLS test against a wide-open table passes vacuously,
which looks exactly like success. But enabling RLS *without* also creating the
policy production has is worse than leaving it off: a policy's subqueries are
themselves subject to RLS, so `contact_occasions_owner_all` — which decides
ownership with an `EXISTS` against `contacts` — silently returns nothing when
`contacts` has RLS on and no policy. Every contact occasion disappears for its
own owner, and the migration under test looks broken when it is not.

Both were live in this harness and both produced a confident, wrong answer
before they were found. If a stub carries RLS, it carries its policy too.

## What an assertion file should cover

The four things reading cannot confirm:

1. **It applies** — and applies *twice*, unchanged. Migrations get replayed.
2. **Constraints reject what they claim to.** Insert the bad rows and expect the
   failure, rather than assuming the `CHECK` says what it means.
3. **RLS gates the right roles.** `SET LOCAL ROLE anon`, then read and write.
4. **Behaviour, not just shape.** `assert_countries_and_holidays.sql` pins a
   fixed "today" and checks the shared date engine returns the dates a person
   would expect — including the roll into next year once a date has passed.
