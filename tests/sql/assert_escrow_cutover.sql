\set ON_ERROR_STOP on
\pset pager off

-- =============================================================================
-- The cutover: staging, the stored-value guard, and the way back
--
-- The guard is the only thing standing between "we removed the wallet" and
-- "we removed the wallet from the four call sites we remembered". These
-- assertions are about the call sites nobody remembered -- they write to the
-- tables directly, exactly as an unaudited Edge Function would.
-- =============================================================================

TRUNCATE public.ledger_entries;
UPDATE public.platform_settings SET escrow_mode = 'dual_write' WHERE id = 1;

DELETE FROM public.users WHERE id = 'c07c0000-0000-0000-0000-0000000000b1';
INSERT INTO public.users (id, role) VALUES ('c07c0000-0000-0000-0000-0000000000b1', 'sender');

DELETE FROM public.shops WHERE id = 'c07c0000-0000-0000-0000-000000000001';
INSERT INTO public.shops (id, name, is_active, float_balance, active_exposure)
VALUES ('c07c0000-0000-0000-0000-000000000001', 'Cutover Shop', true, 5000, 5000);

INSERT INTO public.kithly_wallets (id, user_id, balance)
VALUES ('c07c0000-0000-0000-0000-00000000dead', 'c07c0000-0000-0000-0000-0000000000b1', 0)
ON CONFLICT (user_id) DO NOTHING;

\echo '--- 1. the default mode changes nothing observable ---'
DO $$
DECLARE v_mode text; v_rows integer;
BEGIN
  SELECT escrow_mode INTO v_mode FROM public.platform_settings WHERE id = 1;
  IF v_mode <> 'dual_write' THEN
    RAISE EXCEPTION 'FAIL: escrow_mode is %, expected dual_write', v_mode;
  END IF;

  -- Stored value still works. This is what makes the migration safe to deploy
  -- ahead of the cutover.
  INSERT INTO public.wallet_ledger (wallet_id, amount, description)
  VALUES ('c07c0000-0000-0000-0000-00000000dead', 2500, 'legacy top-up');

  SELECT COUNT(*) INTO v_rows FROM public.wallet_ledger
  WHERE wallet_id = 'c07c0000-0000-0000-0000-00000000dead';
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FAIL: the legacy wallet write did not land'; END IF;

  RAISE NOTICE 'PASS: deploying the escrow model does not change behaviour by itself';
END $$;

\echo '--- 2. under escrow_v2 no call site can create stored value ---'
DO $$
DECLARE v_leaks text[] := '{}';
BEGIN
  UPDATE public.platform_settings SET escrow_mode = 'escrow_v2' WHERE id = 1;

  -- A sender wallet credit, written directly rather than through the RPC --
  -- which is exactly how a forgotten Edge Function would do it.
  BEGIN
    INSERT INTO public.wallet_ledger (wallet_id, amount, description)
    VALUES ('c07c0000-0000-0000-0000-00000000dead', 9999, 'sneaky credit');
    v_leaks := array_append(v_leaks, 'wallet_ledger');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    INSERT INTO public.merchant_float_ledger (shop_id, amount, entry_type, description)
    VALUES ('c07c0000-0000-0000-0000-000000000001', 9999, 'UPFRONT_ADVANCE', 'sneaky float');
    v_leaks := array_append(v_leaks, 'merchant_float_ledger');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    INSERT INTO public.merchant_withdrawals (shop_id, amount, status, provider)
    VALUES ('c07c0000-0000-0000-0000-000000000001', 9999, 'PENDING', 'flutterwave');
    v_leaks := array_append(v_leaks, 'merchant_withdrawals');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    UPDATE public.shops SET float_balance = float_balance + 9999
    WHERE id = 'c07c0000-0000-0000-0000-000000000001';
    v_leaks := array_append(v_leaks, 'shops.float_balance');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF array_length(v_leaks, 1) > 0 THEN
    RAISE EXCEPTION 'FAIL: stored value can still be created via: %', v_leaks;
  END IF;
  RAISE NOTICE 'PASS: all four stored-value doors are shut, whoever knocks';
END $$;

\echo '--- 3. draining an existing float is still allowed ---'
DO $$
DECLARE v_balance integer;
BEGIN
  -- A merchant with a float when the cutover happens must be able to get it
  -- out. Blocking the decrease would strand their money.
  UPDATE public.shops SET float_balance = float_balance - 5000, active_exposure = 0
  WHERE id = 'c07c0000-0000-0000-0000-000000000001';

  SELECT float_balance INTO v_balance FROM public.shops
  WHERE id = 'c07c0000-0000-0000-0000-000000000001';

  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'FAIL: the float could not be drained -- it reads %', v_balance;
  END IF;
  RAISE NOTICE 'PASS: existing float can be paid down, just never topped up';
END $$;

\echo '--- 4. the legacy expiry sweep stands down rather than erroring ---'
DO $$
DECLARE v_count integer;
BEGIN
  v_count := public.process_expired_vouchers();
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: the legacy sweep processed % items under escrow_v2', v_count;
  END IF;
  RAISE NOTICE 'PASS: the old sweep returns zero instead of failing on every run';
END $$;

\echo '--- 5. the way back is a settings change, not a migration ---'
DO $$
DECLARE v_ok boolean := false;
BEGIN
  UPDATE public.platform_settings SET escrow_mode = 'dual_write' WHERE id = 1;

  INSERT INTO public.wallet_ledger (wallet_id, amount, description)
  VALUES ('c07c0000-0000-0000-0000-00000000dead', 100, 'rollback proof');
  v_ok := true;

  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL: rolling back the mode did not restore the legacy path'; END IF;
  RAISE NOTICE 'PASS: a bad cutover is undone by one UPDATE, with no deploy';
END $$;

\echo '--- 6. escrow_mode only accepts the three real modes ---'
DO $$
DECLARE v_bad boolean := false;
BEGIN
  BEGIN
    UPDATE public.platform_settings SET escrow_mode = 'off' WHERE id = 1;
    v_bad := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_bad THEN RAISE EXCEPTION 'FAIL: an unknown escrow_mode was accepted'; END IF;

  UPDATE public.platform_settings SET escrow_mode = 'dual_write' WHERE id = 1;
  RAISE NOTICE 'PASS: a typo in the cutover switch cannot silently disable the guard';
END $$;

\echo '--- 7. what a sender sees is never presented as spendable ---'
DO $$
DECLARE v_summary jsonb;
BEGIN
  PERFORM public.post_ledger_pair(
    'CLIENT_FUNDS', NULL, 'SENDER_LIABILITY', 'c07c0000-0000-0000-0000-0000000000b1',
    45000, 'FUNDING');

  v_summary := public.sender_escrow_summary('c07c0000-0000-0000-0000-0000000000b1');

  IF (v_summary->>'is_spendable')::boolean THEN
    RAISE EXCEPTION 'FAIL: the sender summary claims a spendable balance';
  END IF;
  IF (v_summary->>'awaiting_collection_ngwee')::bigint <> 45000 THEN
    RAISE EXCEPTION 'FAIL: awaiting collection reads %', v_summary->>'awaiting_collection_ngwee';
  END IF;
  RAISE NOTICE 'PASS: money in escrow is shown as gifts awaiting collection, not credit';
END $$;

\echo '--- 8. the opening journal is a dry run until someone means it ---'
DO $$
DECLARE v_dry jsonb; v_real jsonb; v_before integer; v_after integer;
BEGIN
  INSERT INTO public.transactions (transaction_id, buyer_id, gateway_tx_ref, total_amount, currency, status)
  VALUES ('c07c0000-0000-0000-0000-00000000f001', 'c07c0000-0000-0000-0000-0000000000b1',
          'cutover-open-1', 300, 'ZMW', 'SUCCESS');
  INSERT INTO public.shop_orders (shop_order_id, transaction_id, shop_id, claim_code, claim_status, subtotal)
  VALUES ('c07c0000-0000-0000-0000-00000000e001', 'c07c0000-0000-0000-0000-00000000f001',
          'c07c0000-0000-0000-0000-000000000001', 'CUTOVER1', 'PENDING', 300);
  INSERT INTO public.items (id, shop_id, name, price_zmw, is_available)
  VALUES ('c07c0000-0000-0000-0000-0000000000f1', 'c07c0000-0000-0000-0000-000000000001', 'Open item', 300, true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.order_items (order_item_id, shop_order_id, item_id, allocated_price, fulfillment_status)
  VALUES ('c07c0000-0000-0000-0000-00000000d001', 'c07c0000-0000-0000-0000-00000000e001',
          'c07c0000-0000-0000-0000-0000000000f1', 300, 'PENDING');

  SELECT COUNT(*) INTO v_before FROM public.ledger_entries;
  v_dry := public.escrow_open_balances(true);
  SELECT COUNT(*) INTO v_after FROM public.ledger_entries;

  IF v_after <> v_before THEN
    RAISE EXCEPTION 'FAIL: a dry run wrote % ledger rows', v_after - v_before;
  END IF;
  IF (v_dry->>'transactions')::integer < 1 THEN
    RAISE EXCEPTION 'FAIL: the dry run found no open transactions to report on';
  END IF;

  v_real := public.escrow_open_balances(false);
  IF NOT (v_real->>'ledger_balanced_after')::boolean THEN
    RAISE EXCEPTION 'FAIL: posting opening balances unbalanced the ledger';
  END IF;

  -- Safe to run twice: the second pass finds nothing left to post.
  v_real := public.escrow_open_balances(false);
  IF (v_real->>'transactions')::integer <> 0 THEN
    RAISE EXCEPTION 'FAIL: opening balances would be posted twice (% found again)',
      v_real->>'transactions';
  END IF;

  PERFORM public.assert_ledger_balanced();
  RAISE NOTICE 'PASS: opening balances are previewed first and cannot be posted twice';
END $$;

\echo '--- 9. the stored-value guard is attached, and CI would notice if it were not ---'
DO $$
DECLARE v_table text; v_missing text[] := '{}';
BEGIN
  FOREACH v_table IN ARRAY ARRAY['wallet_ledger', 'merchant_float_ledger', 'merchant_withdrawals']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = v_table AND t.tgfoid = 'public.refuse_stored_value'::regproc
    ) THEN
      v_missing := array_append(v_missing, v_table);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'FAIL: the stored-value guard is missing from: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'ledger_entries' AND t.tgfoid = 'public.enforce_immutable_ledger'::regproc
  ) THEN
    RAISE EXCEPTION 'FAIL: the new ledger lost its immutability trigger';
  END IF;

  RAISE NOTICE 'PASS: guards and immutability are attached where they must be';
END $$;

UPDATE public.platform_settings SET escrow_mode = 'dual_write' WHERE id = 1;
TRUNCATE public.ledger_entries;
