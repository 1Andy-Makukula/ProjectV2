/**
 * Integration tests — require a Supabase test project.
 *
 * Run locally:
 *   RUN_INTEGRATION_TESTS=true \
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   pnpm test:integration
 */
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!shouldRun || !url || !serviceKey)(
  'payment RPC integration',
  () => {
    it('confirm_payment_atomic is idempotent', async () => {
      const admin = createClient(url!, serviceKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const fakeId = '00000000-0000-0000-0000-000000000099';
      const key = `test:${fakeId}:1`;

      const first = await admin.rpc('confirm_payment_atomic', {
        p_transaction_id: fakeId,
        p_paid_amount: 0,
        p_paid_currency: 'ZMW',
        // Was '{}'. Since 20260809010000 the payload must carry the gateway's
        // own charge id, so an empty object is now rejected before the
        // transaction is ever looked up — which made this assert the wrong
        // thing. The guard itself is covered in money-path.integration.test.ts;
        // here the payload just has to be well-formed enough to get past it so
        // the original intent, that the RPC is callable and reports a missing
        // transaction, is what gets tested.
        p_payload: JSON.stringify({ data: { id: 'flw-smoke-1' } }),
        p_idempotency_key: key,
      });

      // Expect not found OR already processed — we only assert RPC is callable
      expect(first.error?.message ?? '').toMatch(
        /not found|Transaction|duplicate|already/i,
      );
    });
  },
);
