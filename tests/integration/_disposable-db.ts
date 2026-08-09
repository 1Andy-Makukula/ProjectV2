/**
 * A guard for tests that write to the money path.
 *
 * The money-path and ledger suites create users, take stock, move credits and
 * confirm payments. None of it can be cleaned up afterwards: wallet_ledger and
 * transaction_events carry `enforce_immutable_ledger`, so their rows cannot be
 * deleted -- and because wallets and transactions are referenced by those rows,
 * they cannot be deleted either. That is correct behaviour for an audit ledger
 * and a deliberate property of the schema. It also means these tests can only
 * ever run against a database that is allowed to be thrown away.
 *
 * The risk is concrete rather than theoretical. `pnpm test:integration` runs
 * every file under tests/integration, and CI's `integration` job supplies
 * SUPABASE_URL and a service role key for a HOSTED project. Without this guard,
 * adding a destructive suite to that directory silently points it at a real
 * database and leaves permanent rows in it.
 *
 * Localhost is therefore required, and the override is deliberately awkward to
 * set by accident.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'host.docker.internal']);

export interface DisposableDbCheck {
  ok: boolean;
  reason: string;
}

/**
 * Whether the configured database is safe to write to destructively.
 *
 * Set `ALLOW_DESTRUCTIVE_INTEGRATION_TESTS=i-know-this-database-is-disposable`
 * to run against a non-local host -- for a scratch project you intend to
 * delete, and nothing else.
 */
export function checkDisposableDb(rawUrl: string | undefined): DisposableDbCheck {
  if (!rawUrl) return { ok: false, reason: 'SUPABASE_URL is not set' };

  const override = process.env.ALLOW_DESTRUCTIVE_INTEGRATION_TESTS;
  if (override === 'i-know-this-database-is-disposable') {
    return { ok: true, reason: 'explicitly overridden' };
  }

  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return { ok: false, reason: `SUPABASE_URL is not a valid URL: ${rawUrl}` };
  }

  if (LOCAL_HOSTS.has(host)) return { ok: true, reason: `local host ${host}` };

  return {
    ok: false,
    reason:
      `refusing to run destructive money-path tests against '${host}'. These create ` +
      `users and ledger entries that cannot be deleted (enforce_immutable_ledger), so ` +
      `they must only run against a disposable database. Use a local stack, or set ` +
      `ALLOW_DESTRUCTIVE_INTEGRATION_TESTS=i-know-this-database-is-disposable.`,
  };
}
