/**
 * Adversarial tests for the money path.
 *
 * These are the cases that cost money when they are wrong: two checkouts
 * racing the last unit of stock, a webhook delivered twice, a payment confirmed
 * without a gateway ever being involved, an anonymous caller reaching an RPC
 * that moves funds. The happy paths are not where the risk lives.
 *
 * Runs against a disposable database, never a real one. `supabase start`
 * provides it; the whole migration chain replays from empty, so what is tested
 * is the schema the chain actually produces rather than whatever a long-lived
 * project has drifted into.
 *
 *   supabase start
 *   RUN_INTEGRATION_TESTS=true \
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<Secret from `supabase status`> \
 *   SUPABASE_ANON_KEY=<Publishable from `supabase status`> \
 *   pnpm test:integration
 *
 * Every fixture is namespaced with a per-run tag so runs cannot collide. Note
 * that most of what these tests create CANNOT be removed afterwards -- ledger
 * and event rows are append-only by design, and the records they reference
 * cannot be deleted while they exist. That is why a disposable database is a
 * hard requirement, enforced by the guard below rather than left to discipline.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkDisposableDb } from './_disposable-db';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

// These tests create users, take stock and confirm payments, and none of it can
// be undone -- see _disposable-db.ts. Never let them touch a real database.
const disposable = checkDisposableDb(url);
if (shouldRun && url && !disposable.ok) {
  throw new Error(`[money-path] ${disposable.reason}`);
}

/** Distinguishes this run's rows from every other run's. */
const TAG = `it-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const ids = {
  /**
   * Filled in by beforeAll from real auth users.
   *
   * public.users.id is a foreign key onto auth.users, so a buyer cannot simply
   * be inserted -- and there is a signup trigger that populates public.users
   * from the auth row, so going through the admin API exercises the same path
   * a real signup does rather than a shape only a test can produce.
   */
  buyer: '',
  merchant: '',
  shop: crypto.randomUUID(),
  shopB: crypto.randomUUID(),
  /** Stock of exactly 3, for the boundary and race cases. */
  limitedItem: crypto.randomUUID(),
  /** Unlimited stock (stock_quantity NULL). */
  openItem: crypto.randomUUID(),
  /** is_available = false. */
  unavailableItem: crypto.randomUUID(),
  /** Belongs to shopB, for the multi-vendor split. */
  itemB: crypto.randomUUID(),
};

const PRICE = 1000;
const PRICE_B = 2500;

let admin: SupabaseClient;

/**
 * A checkout payload with sensible defaults.
 *
 * `overrides` replaces top-level arguments; `context` fills p_context, which is
 * the closed set of everything describing the checkout rather than identifying
 * it. Kept separate so a test cannot accidentally pass a context key as a
 * top-level argument -- the function would reject it, but confusingly.
 */
function checkoutArgs(
  overrides: Record<string, unknown> = {},
  context: Record<string, unknown> = {},
) {
  return {
    p_buyer_id: ids.buyer,
    p_origin_type: 'LOCAL',
    p_gateway_tx_ref: `${TAG}-${crypto.randomUUID()}`,
    p_vendors: [{ shop_id: ids.shop, item_ids: [ids.openItem] }],
    p_context: context,
    ...overrides,
  };
}

describe.skipIf(!shouldRun || !url || !serviceKey)('money path — adversarial', () => {
  /**
   * Insert, or stop the run.
   *
   * Fixture failures must never be silent. A missing item produces the very
   * same "invalid or unavailable" error as a genuinely unavailable one, so an
   * unchecked insert turns a broken fixture into a passing test that proves
   * nothing.
   */
  async function mustInsert(table: string, rows: Record<string, unknown>[]) {
    const { error } = await admin.from(table).insert(rows);
    if (error) {
      throw new Error(`fixture insert into ${table} failed: ${error.message}`);
    }
  }

  /**
   * Create an auth user and make sure a matching public.users row exists.
   *
   * The signup trigger normally creates that row, but it is not this file's job
   * to assert what the trigger does -- so the row is upserted afterwards to
   * guarantee the shape these tests need regardless.
   */
  async function createUser(role: 'buyer' | 'merchant'): Promise<string> {
    const email = `${TAG}-${role}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: `${TAG}-Passw0rd!`,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`could not create ${role} auth user: ${error?.message}`);
    }

    const { error: upsertError } = await admin
      .from('users')
      .upsert({ id: data.user.id, name: `${TAG}-${role}`, email }, { onConflict: 'id' });
    if (upsertError) {
      throw new Error(`could not upsert ${role} profile: ${upsertError.message}`);
    }
    return data.user.id;
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    ids.buyer = await createUser('buyer');
    ids.merchant = await createUser('merchant');

    await mustInsert('shops', [
      { id: ids.shop, name: `${TAG}-shop`, owner_id: ids.merchant, is_active: true },
      { id: ids.shopB, name: `${TAG}-shopB`, owner_id: ids.merchant, is_active: true },
    ]);

    // Money routing resolves the merchant through merchant_shops, not
    // shops.owner_id — see the smoke check that pins that down.
    await mustInsert('merchant_shops', [
      { user_id: ids.merchant, shop_id: ids.shop },
      { user_id: ids.merchant, shop_id: ids.shopB },
    ]);

    await mustInsert('items', [
      {
        id: ids.limitedItem,
        shop_id: ids.shop,
        name: `${TAG}-limited`,
        price_zmw: PRICE,
        stock_quantity: 3,
        is_available: true,
      },
      {
        id: ids.openItem,
        shop_id: ids.shop,
        name: `${TAG}-open`,
        price_zmw: PRICE,
        stock_quantity: null,
        is_available: true,
      },
      {
        id: ids.unavailableItem,
        shop_id: ids.shop,
        name: `${TAG}-unavailable`,
        price_zmw: PRICE,
        is_available: false,
      },
      {
        id: ids.itemB,
        shop_id: ids.shopB,
        name: `${TAG}-itemB`,
        price_zmw: PRICE_B,
        is_available: true,
      },
    ]);
  });

  afterAll(async () => {
    if (!admin) return;

    // Best effort, and deliberately partial.
    //
    // Nothing on the money path can actually be removed: wallet_ledger and
    // transaction_events are append-only (enforce_immutable_ledger), and the
    // transactions and wallets they reference cannot be deleted while those
    // rows exist. Attempting it and swallowing the errors would only look like
    // cleanup. What follows removes the catalogue fixtures that genuinely can
    // go; the rest is why this suite requires a disposable database.
    await admin.from('items').delete().in('shop_id', [ids.shop, ids.shopB]);
    await admin.from('merchant_shops').delete().eq('user_id', ids.merchant);
  });

  // -------------------------------------------------------------------------
  // checkout_init_atomic
  // -------------------------------------------------------------------------
  describe('checkout_init_atomic', () => {
    it('rejects an empty cart', async () => {
      const { error } = await admin.rpc('checkout_init_atomic', checkoutArgs({ p_vendors: [] }));
      expect(error?.message).toMatch(/empty/i);
    });

    it('rejects a vendor group with no items', async () => {
      const { error } = await admin.rpc(
        'checkout_init_atomic',
        checkoutArgs({ p_vendors: [{ shop_id: ids.shop, item_ids: [] }] }),
      );
      expect(error?.message).toMatch(/no items/i);
    });

    it('rejects an unavailable item', async () => {
      const { error } = await admin.rpc(
        'checkout_init_atomic',
        checkoutArgs({ p_vendors: [{ shop_id: ids.shop, item_ids: [ids.unavailableItem] }] }),
      );
      expect(error?.message).toMatch(/invalid or unavailable/i);
    });

    it('rejects a quantity above available stock', async () => {
      const { error } = await admin.rpc(
        'checkout_init_atomic',
        checkoutArgs({
          p_vendors: [
            { shop_id: ids.shop, item_ids: Array(4).fill(ids.limitedItem) },
          ],
        }),
      );
      // Stock is 3; asking for 4 must fail before anything is reserved.
      expect(error?.message).toMatch(/left of|reduce the quantity/i);
    });

    it('splits a multi-vendor cart so subtotals plus fee reconcile to the total', async () => {
      const { data, error } = await admin.rpc(
        'checkout_init_atomic',
        checkoutArgs({
          p_vendors: [
            { shop_id: ids.shop, item_ids: [ids.openItem] },
            { shop_id: ids.shopB, item_ids: [ids.itemB] },
          ],
        }),
      );

      expect(error).toBeNull();
      const result = data as {
        items_subtotal: number;
        platform_fee: number;
        total_amount: number;
        shop_orders: Array<{ subtotal: number }>;
      };

      const summed = result.shop_orders.reduce((acc, o) => acc + o.subtotal, 0);
      expect(result.shop_orders).toHaveLength(2);
      expect(summed).toBe(PRICE + PRICE_B);
      expect(result.items_subtotal).toBe(summed);
      // Cash payable is basket + fee when no credits are applied. If this ever
      // drifts, buyers are being charged something nobody computed.
      expect(result.total_amount).toBe(result.items_subtotal + result.platform_fee);
    });

    it('rejects credits larger than the amount payable', async () => {
      await admin.from('kithly_wallets').upsert(
        { user_id: ids.buyer, balance: 0, currency: 'ZMW' },
        { onConflict: 'user_id' },
      );
      // Credit the wallet through the real path so the ledger and the cached
      // balance agree — writing balance directly would test a state the
      // application cannot actually produce.
      await admin.rpc('increment_wallet_balance', {
        p_user_id: ids.buyer,
        p_amount: 10_000_000,
        p_reference: `${TAG}-seed`,
      });

      const { error } = await admin.rpc(
        'checkout_init_atomic',
        checkoutArgs({}, { credits_to_apply: 9_000_000 }),
      );
      expect(error?.message).toMatch(/exceed the amount payable/i);
    });

    it('rejects negative credits', async () => {
      const { error } = await admin.rpc(
        'checkout_init_atomic',
        checkoutArgs({}, { credits_to_apply: -100 }),
      );
      expect(error?.message).toMatch(/negative/i);
    });

    it('rejects an unknown key in p_context instead of ignoring it', async () => {
      // The whole safety argument for collapsing twelve parameters into one
      // object. If an unrecognised key were ignored, a misspelled
      // 'recipient_phone' would produce an order with no recipient and nothing
      // would say so.
      const { error } = await admin.rpc(
        'checkout_init_atomic',
        checkoutArgs({}, { recipient_phonee: '0977000000' }),
      );
      expect(error?.message).toMatch(/unknown key/i);
      expect(error?.message).toMatch(/recipient_phonee/);
    });

    it('accepts a context carrying every recognised key', async () => {
      // The other direction: the closed set must actually admit its own
      // members, or the check is just breaking checkout.
      const { error } = await admin.rpc(
        'checkout_init_atomic',
        checkoutArgs({}, {
          recipient_name: 'Test Recipient',
          recipient_phone: '0977000000',
          message: 'enjoy',
          sender_phone: '0966000000',
          credits_to_apply: 0,
          target_execution_date: null,
          experience_id: null,
          expires_at: null,
        }),
      );
      expect(error).toBeNull();
    });

    /**
     * The case that decides whether stock can be oversold.
     *
     * Both checkouts ask for all three remaining units at the same time. The
     * function locks item rows in a deterministic id order precisely so this
     * cannot deadlock or double-reserve; exactly one must win.
     */
    it('lets only one of two concurrent checkouts take the last of the stock', async () => {
      const both = [1, 2].map(() =>
        admin.rpc(
          'checkout_init_atomic',
          checkoutArgs({
            p_vendors: [
              { shop_id: ids.shop, item_ids: Array(3).fill(ids.limitedItem) },
            ],
          }),
        ),
      );

      const settled = await Promise.all(both);
      const succeeded = settled.filter((r) => !r.error);
      const failed = settled.filter((r) => r.error);

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].error?.message).toMatch(/left of|reduce the quantity/i);

      const { data: item } = await admin
        .from('items')
        .select('stock_quantity')
        .eq('id', ids.limitedItem)
        .single();
      // Never negative, and never more than was on hand.
      expect(item?.stock_quantity).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // confirm_payment_atomic
  // -------------------------------------------------------------------------
  describe('confirm_payment_atomic', () => {
    /** A fresh GATEWAY_PROCESSING transaction to confirm against. */
    async function freshTransaction(): Promise<{ id: string; total: number }> {
      const { data, error } = await admin.rpc('checkout_init_atomic', checkoutArgs());
      expect(error).toBeNull();
      const result = data as { transaction_id: string; total_amount: number };
      return { id: result.transaction_id, total: result.total_amount };
    }

    it('refuses a payload carrying no gateway charge id', async () => {
      const txn = await freshTransaction();
      const { error } = await admin.rpc('confirm_payment_atomic', {
        p_transaction_id: txn.id,
        p_paid_amount: txn.total,
        p_paid_currency: 'ZMW',
        p_payload: JSON.stringify({ data: { amount: txn.total / 100 } }),
      });
      expect(error?.message).toMatch(/no charge id/i);
    });

    it('refuses an absent payload outright', async () => {
      const txn = await freshTransaction();
      const { error } = await admin.rpc('confirm_payment_atomic', {
        p_transaction_id: txn.id,
        p_paid_amount: txn.total,
        p_paid_currency: 'ZMW',
      });
      expect(error?.message).toMatch(/payload is required/i);
    });

    it('refuses an underpayment', async () => {
      const txn = await freshTransaction();
      const { error } = await admin.rpc('confirm_payment_atomic', {
        p_transaction_id: txn.id,
        p_paid_amount: txn.total - 1,
        p_paid_currency: 'ZMW',
        p_payload: JSON.stringify({ data: { id: 99, amount: 1 } }),
      });
      expect(error?.message).toMatch(/mismatch/i);
    });

    it('refuses a foreign currency while the gate is ZMW-only', async () => {
      const txn = await freshTransaction();
      const { error } = await admin.rpc('confirm_payment_atomic', {
        p_transaction_id: txn.id,
        p_paid_amount: txn.total,
        p_paid_currency: 'GBP',
        p_payload: JSON.stringify({ data: { id: 98 } }),
      });
      expect(error?.message).toMatch(/mismatch/i);
    });

    it('records the gateway reference on a successful confirmation', async () => {
      const txn = await freshTransaction();
      const chargeId = `flw-${Date.now()}`;
      const { error } = await admin.rpc('confirm_payment_atomic', {
        p_transaction_id: txn.id,
        p_paid_amount: txn.total,
        p_paid_currency: 'ZMW',
        p_payload: JSON.stringify({ data: { id: chargeId } }),
        p_idempotency_key: `${TAG}-${txn.id}`,
      });
      expect(error).toBeNull();

      const { data: row } = await admin
        .from('transactions')
        .select('status, gateway_reference')
        .eq('transaction_id', txn.id)
        .single();

      expect(row?.status).toBe('SUCCESS');
      expect(row?.gateway_reference).toBe(chargeId);
    });

    /**
     * Flutterwave retries. A redelivered webhook must not produce a second set
     * of side effects — one WEBHOOK_RECEIVED event, one state change.
     */
    it('applies a redelivered webhook exactly once', async () => {
      const txn = await freshTransaction();
      const key = `${TAG}-dup-${txn.id}`;
      const args = {
        p_transaction_id: txn.id,
        p_paid_amount: txn.total,
        p_paid_currency: 'ZMW',
        p_payload: JSON.stringify({ data: { id: 'flw-dup-1' } }),
        p_idempotency_key: key,
      };

      const first = await admin.rpc('confirm_payment_atomic', args);
      const second = await admin.rpc('confirm_payment_atomic', args);

      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect((second.data as { already_processed?: boolean }).already_processed).toBe(true);

      const { data: events } = await admin
        .from('transaction_events')
        .select('id')
        .eq('transaction_id', txn.id)
        .eq('event_type', 'WEBHOOK_RECEIVED');
      expect(events ?? []).toHaveLength(1);
    });

    it('refuses to confirm a transaction that is not awaiting the gateway', async () => {
      const txn = await freshTransaction();
      const args = {
        p_transaction_id: txn.id,
        p_paid_amount: txn.total,
        p_paid_currency: 'ZMW',
        p_payload: JSON.stringify({ data: { id: 'flw-state-1' } }),
      };
      await admin.rpc('confirm_payment_atomic', args);

      // Second call with no idempotency key: the short-circuit cannot hide it,
      // so this exercises the status guard rather than the key check.
      const { data } = await admin.rpc('confirm_payment_atomic', args);
      expect((data as { already_confirmed?: boolean }).already_confirmed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------------
  describe.skipIf(!anonKey)('anonymous callers', () => {
    const NIL = '00000000-0000-4000-8000-000000000000';

    /**
     * Argument sets matter here, and not for the obvious reason.
     *
     * PostgREST resolves a function by the NAMES of the arguments supplied. Call
     * one with `{}` and it cannot match a signature that has required
     * parameters, so it answers PGRST202 — indistinguishable from the function
     * being hidden, and the permission check is never reached. Each entry below
     * therefore carries a valid-shaped argument set, so the only thing left to
     * stop the call is the grant.
     *
     * Every set is chosen to be inert if it ever DID execute: non-existent ids
     * and zero amounts, so a regression fails the assertion rather than moving
     * money.
     */
    const MONEY_RPCS: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['checkout_init_atomic', {
        p_buyer_id: NIL, p_origin_type: 'LOCAL', p_gateway_tx_ref: 'probe', p_vendors: [],
      }],
      ['confirm_payment_atomic', {
        p_transaction_id: NIL, p_paid_amount: 1, p_paid_currency: 'ZMW',
      }],
      ['fulfill_voucher_atomic', {
        p_claim_code: 'ZZZZZZZZ', p_present_item_ids: [], p_missing_item_ids: [],
        p_merchant_user_id: NIL,
      }],
      ['settle_payout_atomic', { p_shop_order_id: NIL, p_merchant_user_id: NIL }],
      ['complete_redemption', { p_shop_order_id: NIL }],
      ['process_due_redemptions', {}],
      ['increment_wallet_balance', { p_user_id: NIL, p_amount: 0 }],
      ['request_withdrawal_atomic', { target_shop_id: NIL, withdrawal_amount: 0 }],
      ['claim_withdrawal_batch', { p_limit: 0 }],
      ['complete_withdrawal', { p_withdrawal_id: NIL }],
      ['fail_withdrawal', { p_withdrawal_id: NIL, p_reason: 'probe' }],
      ['mark_withdrawal_unverified', { p_withdrawal_id: NIL, p_reason: 'probe' }],
      ['reopen_unverified_withdrawal', { p_withdrawal_id: NIL }],
      ['reverse_completed_withdrawal', { p_withdrawal_id: NIL, p_reason: 'probe' }],
    ];

    it.each(MONEY_RPCS)('cannot execute %s', async (fn, args) => {
      const anon = createClient(url!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await anon.rpc(fn, args);
      // 42501 is the permission denial. A business rule complaining about the
      // arguments would mean the function RAN — which is precisely the
      // regression this guards against.
      expect(error).toBeTruthy();
      expect(error?.code).toBe('42501');
    });

    it('can still resolve its own role, so RLS keeps working', async () => {
      const anon = createClient(url!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await anon.rpc('current_user_role', {});
      expect(error).toBeNull();
    });
  });
});
