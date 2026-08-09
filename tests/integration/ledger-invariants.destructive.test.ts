/**
 * Ledger invariants.
 *
 * The case-by-case tests in money-path.destructive.test.ts check that specific
 * operations behave. These check something different and harder to get at: that
 * after an arbitrary sequence of operations the books still balance.
 *
 * The property under test is that `kithly_wallets.balance` is only ever a
 * CACHE. The truth is `wallet_ledger`, which is append-only, and a trigger
 * keeps the cached figure in step. Anything that writes a balance without a
 * matching ledger row -- or a ledger row whose trigger silently failed -- puts
 * the two out of step, and every later decision (what a buyer can spend, what a
 * merchant is owed) is then made against a number nobody can reconstruct.
 *
 * Drift of that kind does not announce itself. It is found weeks later, in a
 * balance that cannot be explained from history.
 *
 * Same setup as the other integration tests:
 *   supabase start
 *   RUN_INTEGRATION_TESTS=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   pnpm test:integration
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkDisposableDb } from './_disposable-db';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const disposable = checkDisposableDb(url);
if (shouldRun && url && !disposable.ok) {
  throw new Error(`[ledger-invariants] ${disposable.reason}`);
}

const TAG = `led-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let admin: SupabaseClient;
let buyerId = '';
let walletId = '';

/**
 * Deterministic pseudo-randomness.
 *
 * A property test that cannot be replayed is a property test that reports a
 * failure nobody can reproduce. The seed is printed on failure so a bad run can
 * be re-run exactly.
 */
const SEED = Number(process.env.LEDGER_SEED ?? Date.now() % 2_147_483_647);
let rngState = SEED;
function nextInt(maxExclusive: number): number {
  // Park-Miller. Small, dependency-free, and good enough to shuffle operations.
  rngState = (rngState * 16_807) % 2_147_483_647;
  return rngState % maxExclusive;
}

describe.skipIf(!shouldRun || !url || !serviceKey)('ledger invariants', () => {
  /** The ledger's own account of the wallet, summed from the immutable rows. */
  async function ledgerSum(): Promise<number> {
    const { data, error } = await admin
      .from('wallet_ledger')
      .select('amount')
      .eq('wallet_id', walletId);
    if (error) throw new Error(`could not read wallet_ledger: ${error.message}`);
    return (data ?? []).reduce((acc, r) => acc + (r.amount as number), 0);
  }

  /** The cached figure the application actually spends against. */
  async function cachedBalance(): Promise<number> {
    const { data, error } = await admin
      .from('kithly_wallets')
      .select('balance')
      .eq('id', walletId)
      .single();
    if (error) throw new Error(`could not read wallet: ${error.message}`);
    return data!.balance as number;
  }

  async function assertBooksBalance(step: string) {
    const [sum, cached] = await Promise.all([ledgerSum(), cachedBalance()]);
    expect(
      cached,
      `balance drifted from the ledger after ${step} (seed ${SEED})`,
    ).toBe(sum);
    // A cached balance below zero would let a buyer spend money that is not
    // theirs; the ledger sum going negative would mean a debit was written with
    // no funding entry behind it.
    expect(cached, `negative balance after ${step} (seed ${SEED})`).toBeGreaterThanOrEqual(0);
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const email = `${TAG}-buyer@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: `${TAG}-Passw0rd!`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`auth user: ${error?.message}`);
    buyerId = data.user.id;

    const { error: profileError } = await admin
      .from('users')
      .upsert({ id: buyerId, name: `${TAG}-buyer`, email }, { onConflict: 'id' });
    if (profileError) throw new Error(`profile: ${profileError.message}`);

    // Created through the same call the application uses, so the wallet exists
    // in whatever shape that path actually produces.
    const { error: seedError } = await admin.rpc('increment_wallet_balance', {
      p_user_id: buyerId,
      p_amount: 1,
      p_reference: `${TAG}-open`,
    });
    if (seedError) throw new Error(`could not open wallet: ${seedError.message}`);

    const { data: wallet, error: walletError } = await admin
      .from('kithly_wallets')
      .select('id')
      .eq('user_id', buyerId)
      .single();
    if (walletError || !wallet) throw new Error(`wallet lookup: ${walletError?.message}`);
    walletId = wallet.id as string;
  });

  // No afterAll on purpose.
  //
  // wallet_ledger rows cannot be deleted -- that is the property the last two
  // tests in this file assert -- and the wallet and user they hang off cannot
  // be deleted while they exist. Pretending to tidy up would mean issuing
  // deletes that always fail and ignoring the errors. This suite runs against a
  // disposable database instead; the guard at the top of the file enforces it.

  it('keeps the cached balance equal to the ledger across a randomised sequence', async () => {
    await assertBooksBalance('setup');

    // Mixed operations, including ones expected to be rejected. A rejected
    // operation must leave the books exactly as it found them -- a partial
    // write that fails halfway is precisely how a cache and its ledger drift.
    for (let i = 0; i < 25; i += 1) {
      const roll = nextInt(4);

      if (roll === 0) {
        const amount = 1 + nextInt(5_000);
        const { error } = await admin.rpc('increment_wallet_balance', {
          p_user_id: buyerId,
          p_amount: amount,
          p_reference: `${TAG}-credit-${i}`,
        });
        expect(error, `credit ${i} failed (seed ${SEED})`).toBeNull();
      } else if (roll === 1) {
        // Zero and negative amounts return early and must write nothing at all.
        const before = await ledgerSum();
        const { error } = await admin.rpc('increment_wallet_balance', {
          p_user_id: buyerId,
          p_amount: nextInt(2) === 0 ? 0 : -(1 + nextInt(500)),
          p_reference: `${TAG}-noop-${i}`,
        });
        expect(error, `no-op credit ${i} errored (seed ${SEED})`).toBeNull();
        expect(await ledgerSum(), `no-op credit ${i} wrote a row (seed ${SEED})`).toBe(before);
      } else if (roll === 2) {
        // A credit for a user with no wallet: must not touch this one.
        const { error } = await admin.rpc('increment_wallet_balance', {
          p_user_id: '00000000-0000-4000-8000-000000000000',
          p_amount: 1 + nextInt(100),
          p_reference: `${TAG}-stranger-${i}`,
        });
        // Whether this errors on the foreign key or quietly does nothing is not
        // the point; it must not alter THIS wallet either way.
        void error;
      } else {
        // Read-only step, to interleave concurrent readers with writers.
        await cachedBalance();
      }

      await assertBooksBalance(`operation ${i} (roll ${roll})`);
    }
  });

  it('applies concurrent credits without losing any of them', async () => {
    const before = await ledgerSum();
    const amounts = [11, 22, 33, 44, 55, 66, 77, 88];

    // Fired together on purpose. The balance cache is maintained by a trigger,
    // so a read-modify-write anywhere in that path would drop increments under
    // concurrency and the total would come up short.
    const results = await Promise.all(
      amounts.map((amount, i) =>
        admin.rpc('increment_wallet_balance', {
          p_user_id: buyerId,
          p_amount: amount,
          p_reference: `${TAG}-concurrent-${i}`,
        }),
      ),
    );
    for (const r of results) expect(r.error).toBeNull();

    const expected = before + amounts.reduce((a, b) => a + b, 0);
    expect(await ledgerSum()).toBe(expected);
    expect(await cachedBalance()).toBe(expected);
  });

  describe('append-only enforcement', () => {
    it('refuses to update a wallet_ledger row', async () => {
      const { data: row } = await admin
        .from('wallet_ledger')
        .select('id, amount')
        .eq('wallet_id', walletId)
        .limit(1)
        .single();
      expect(row).toBeTruthy();

      const { error } = await admin
        .from('wallet_ledger')
        .update({ amount: (row!.amount as number) + 1_000_000 })
        .eq('id', row!.id);

      // Asserted on the message, not merely on "an error". A truthy error
      // could just as easily be RLS, a bad column or a network fault, and this
      // test would then pass against a database with no immutability guard at
      // all -- which is exactly the reassurance it is meant to provide.
      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/cannot be modified or deleted/i);
      await assertBooksBalance('rejected ledger update');
    });

    it('refuses to delete a wallet_ledger row', async () => {
      const { data: row } = await admin
        .from('wallet_ledger')
        .select('id')
        .eq('wallet_id', walletId)
        .limit(1)
        .single();

      const { error } = await admin.from('wallet_ledger').delete().eq('id', row!.id);
      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/cannot be modified or deleted/i);
      await assertBooksBalance('rejected ledger delete');
    });
  });
});
