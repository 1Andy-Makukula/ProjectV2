/**
 * Documents expected RPC contracts for staging smoke tests.
 * Fully skipped unless RUN_INTEGRATION_TESTS=true.
 */
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!shouldRun || !url || !serviceKey)('V2 RPC smoke', () => {
  it('checkout_init_atomic rejects empty cart', async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const buyerId = process.env.TEST_BUYER_ID;
    if (!buyerId) return;

    const { error } = await admin.rpc('checkout_init_atomic', {
      p_buyer_id: buyerId,
      p_origin_type: 'LOCAL',
      p_gateway_tx_ref: `TEST-${Date.now()}`,
      p_vendors: [],
    });

    expect(error?.message).toMatch(/empty|Cart/i);
  });

  it('register_merchant_shop is not callable with service role alone', async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.rpc('register_merchant_shop', {
      p_shop_name: 'Test Shop',
      p_location: 'Lusaka',
    });
    expect(error).toBeTruthy();
  });
});
