/**
 * Can a recipient see the gift that was sent to them?
 *
 * 20261015000000 changed the recipient branch of two RLS policies --
 * `shop_orders_select` and `transactions_select_buyer` -- from comparing
 * `auth.jwt() ->> 'phone'` (NULL for every account on this platform, because
 * signup is email + password and the number rides in user metadata) to
 * comparing `public.current_user_phone()`, the caller's own profile phone.
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A SQL ASSERTION
 * ------------------------------------------------------
 * `pnpm sql:test` builds its own scaffold, and that scaffold has none of the
 * pieces this behaviour is made of: no `shop_orders_select`, no
 * `is_transaction_buyer`, no `is_transaction_recipient`, no
 * `current_user_phone`. Adding them there would be inventing fixtures to
 * satisfy a migration, which `tests/scaffold-drift.test.ts` exists to stop.
 * The real policies only exist after the full chain is applied, so the test
 * belongs here, against a real stack.
 *
 * It also has to act as a signed-in user rather than through the service role,
 * because service_role bypasses RLS entirely -- which is the one thing under
 * test. So each person signs in with the anon key and reads as themselves.
 *
 * WHY IT MATTERS MORE THAN A USUAL REGRESSION TEST
 * ------------------------------------------------
 * That migration WIDENS read access on two money-path tables. A widening
 * cannot be validated by "nothing broke": the failure mode is someone seeing a
 * row they should not. So the stranger case below is the point of the file, and
 * the recipient case merely proves the feature works at all.
 *
 * Same setup as the other integration tests:
 *   supabase start
 *   RUN_INTEGRATION_TESTS=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   SUPABASE_ANON_KEY=... pnpm test:integration
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkDisposableDb } from './_disposable-db';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

const disposable = checkDisposableDb(url);
if (shouldRun && url && !disposable.ok) {
  throw new Error(`[recipient-visibility] ${disposable.reason}`);
}

// Unique per run: users.phone carries a UNIQUE index (users_phone_unique), so
// a fixed number would collide with the previous run on a reused database.
const TAG = `rcp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const digits = String(Date.now()).slice(-7);
const RECIPIENT_PHONE = `+2609${digits}`;
const STRANGER_PHONE = `+2609${String(Number(digits) + 1).padStart(7, '0')}`;
const PASSWORD = `${TAG}-Passw0rd!`;

let admin: SupabaseClient;
const ids = { buyer: '', recipient: '', stranger: '' };
const emails = { buyer: '', recipient: '', stranger: '' };
let shopId = '';
let transactionId = '';
// Two distinct codes from one base. claim_code is unique, so deriving the
// second by slicing the first to the same length silently reproduces it.
const CODE_BASE = TAG.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
const CLAIM_CODE = `${CODE_BASE}A`;
const ORPHAN_CODE = `${CODE_BASE}B`;

describe.skipIf(!shouldRun || !url || !serviceKey || !anonKey)(
  'a recipient can read their own gift, and only their own',
  () => {
    /**
     * Creates an auth user and gives their profile a phone.
     *
     * The phone is set through the service role on purpose. `users.phone` is
     * owner-immutable at the RLS layer (20260903010000 pins it so a user cannot
     * edit their own number), which is precisely what makes it safe to
     * authorise on -- so the only way to set it in a fixture is to bypass RLS.
     */
    async function createPerson(
      who: 'buyer' | 'recipient' | 'stranger',
      phone: string | null,
    ): Promise<string> {
      const email = `${TAG}-${who}@example.test`;
      emails[who] = email;

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`could not create the ${who} auth user: ${error?.message}`);
      }

      const { error: upsertError } = await admin
        .from('users')
        .upsert(
          { id: data.user.id, name: `${TAG}-${who}`, email, phone },
          { onConflict: 'id' },
        );
      if (upsertError) {
        throw new Error(`could not upsert the ${who} profile: ${upsertError.message}`);
      }
      return data.user.id;
    }

    /** A client that reads as that person, under RLS, the way the app does. */
    async function signIn(who: 'buyer' | 'recipient' | 'stranger'): Promise<SupabaseClient> {
      const client = createClient(url!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithPassword({
        email: emails[who],
        password: PASSWORD,
      });
      if (error) throw new Error(`could not sign in as ${who}: ${error.message}`);
      return client;
    }

    beforeAll(async () => {
      admin = createClient(url!, serviceKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      ids.buyer = await createPerson('buyer', null);
      ids.recipient = await createPerson('recipient', RECIPIENT_PHONE);
      ids.stranger = await createPerson('stranger', STRANGER_PHONE);

      const { data: shop, error: shopError } = await admin
        .from('shops')
        .insert({ name: `${TAG}-shop`, is_active: true })
        .select('id')
        .single();
      if (shopError || !shop) throw new Error(`could not create a shop: ${shopError?.message}`);
      shopId = shop.id;

      const { data: txn, error: txnError } = await admin
        .from('transactions')
        .insert({ buyer_id: ids.buyer, total_amount: 50_000 })
        .select('transaction_id')
        .single();
      if (txnError || !txn) {
        throw new Error(`could not create a transaction: ${txnError?.message}`);
      }
      transactionId = txn.transaction_id;

      const { error: orderError } = await admin.from('shop_orders').insert({
        transaction_id: transactionId,
        shop_id: shopId,
        claim_code: CLAIM_CODE,
        recipient_phone: RECIPIENT_PHONE,
      });
      if (orderError) {
        throw new Error(`could not create a shop order: ${orderError.message}`);
      }
    });

    it('lets the recipient read the order sent to their number', async () => {
      const client = await signIn('recipient');
      const { data, error } = await client
        .from('shop_orders')
        .select('claim_code, recipient_phone')
        .eq('claim_code', CLAIM_CODE);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.recipient_phone).toBe(RECIPIENT_PHONE);
    });

    it('lets the recipient read the parent transaction, for the sender and totals', async () => {
      const client = await signIn('recipient');
      const { data, error } = await client
        .from('transactions')
        .select('transaction_id')
        .eq('transaction_id', transactionId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    // The point of the file. A phone match must identify one person, which is
    // what users_phone_unique and the owner-immutability of users.phone buy.
    it('shows a stranger neither the order nor the transaction', async () => {
      const client = await signIn('stranger');

      const { data: orders, error: orderError } = await client
        .from('shop_orders')
        .select('claim_code')
        .eq('claim_code', CLAIM_CODE);
      expect(orderError).toBeNull();
      expect(orders).toHaveLength(0);

      const { data: txns, error: txnError } = await client
        .from('transactions')
        .select('transaction_id')
        .eq('transaction_id', transactionId);
      expect(txnError).toBeNull();
      expect(txns).toHaveLength(0);
    });

    // The buyer here has no phone at all, so this covers two things at once:
    // the buyer branch still works, and a NULL profile phone is not treated as
    // matching anything.
    it('still lets the buyer read their own order, with no phone recorded', async () => {
      const client = await signIn('buyer');
      const { data, error } = await client
        .from('shop_orders')
        .select('claim_code')
        .eq('claim_code', CLAIM_CODE);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('does not let a user with no phone read an order addressed to nobody', async () => {
      // recipient_phone IS NULL on this one. `NULL = NULL` is NULL, which USING
      // treats as false -- but it is worth pinning, because the obvious
      // rewrite of that branch using IS NOT DISTINCT FROM would hand every
      // phoneless account every unaddressed order on the platform.
      const { error: insertError } = await admin.from('shop_orders').insert({
        transaction_id: transactionId,
        shop_id: shopId,
        claim_code: ORPHAN_CODE,
        recipient_phone: null,
      });
      expect(insertError).toBeNull();

      const client = await signIn('buyer');
      const { data, error } = await client
        .from('shop_orders')
        .select('claim_code')
        .eq('claim_code', ORPHAN_CODE);

      expect(error).toBeNull();
      // The buyer DOES see it -- they bought it -- which is the buyer branch,
      // not the phone branch. The phone branch is what must not fire.
      expect(data).toHaveLength(1);

      const stranger = await signIn('stranger');
      const { data: strangerRows, error: strangerError } = await stranger
        .from('shop_orders')
        .select('claim_code')
        .eq('claim_code', ORPHAN_CODE);
      expect(strangerError).toBeNull();
      expect(strangerRows).toHaveLength(0);
    });
  },
);
