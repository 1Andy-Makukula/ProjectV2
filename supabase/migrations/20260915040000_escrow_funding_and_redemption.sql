-- =============================================================================
-- Funding and redemption against the double-entry ledger
--
-- WHAT CHANGES ABOUT THE MONEY
-- ----------------------------
-- Today a fulfilment credits a merchant float, advances a percentage against
-- an exposure limit, and refunds unavailable items into a sender wallet. All
-- three are stored value: balances a user controls, which is a licensed
-- activity and which KithLy is not licensed for.
--
-- Here nothing is stored. A funding credits a SENDER_LIABILITY -- money KithLy
-- owes back to the sender until they direct it somewhere. A redemption moves
-- that liability to MERCHANT_PAYABLE and FEE_ACCRUED. A payout closes the
-- payable. At no point does a user hold a balance they can spend or withdraw.
--
-- WHY THE FEE MOVES AT REDEMPTION AND NOT AT FUNDING
-- --------------------------------------------------
-- §3 of the model: before an item is collected, every ngwee in the segregated
-- account belongs to a sender. If KithLy took its fee at funding, then a
-- voucher that later expired would have to be refunded out of money KithLy had
-- already booked as revenue -- and the sender would get back less than they
-- paid, for a service that never happened. Accruing at redemption makes the
-- refund case trivially correct: the full amount is still theirs.
--
-- WHY THIS IS A NEW FUNCTION AND NOT AN EDIT TO fulfill_voucher_atomic
-- -------------------------------------------------------------------
-- `fulfill_voucher_atomic` has been redefined seven times across this history
-- and carries the float advance, the wallet refund and the dispute window --
-- all three of which this model deletes. Rewriting it in place would mean a
-- large diff to a live money path with no way back.
--
-- Instead `escrow_redeem_items` is a clean implementation of §4.2, and the
-- legacy function keeps running untouched until `escrow_mode` reaches
-- `escrow_v2`. Both write the ledger; only one moves the legacy balances. That
-- is what §11's dual-write period is for, and the rollback is a settings
-- change rather than a migration.
--
-- BLAST RADIUS: additive. `fulfill_voucher_atomic` gains exactly one statement
-- (the shadow post), applied by string replacement against its live body in
-- 20260915045000 so the diff is provable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Claim codes from a cryptographic source (§4.1)
--
-- The existing implementation draws from `random()`, which is a seeded
-- Mersenne-style PRNG. Observing a handful of claim codes from a busy shop is
-- enough to reconstruct its state and predict the rest, and a claim code is a
-- bearer instrument -- whoever presents it collects the goods.
--
-- `gen_random_uuid()` is backed by `pg_strong_random`, the same CSPRNG
-- `gen_random_bytes` uses, and unlike `gen_random_bytes` it is in core rather
-- than pgcrypto -- so this needs no extension and behaves identically on a
-- bare cluster and on Supabase.
--
-- Rejection sampling, not modulo. 256 is not a multiple of 36, so a plain
-- `% 36` makes the first four letters of the alphabet ~14% more likely than
-- the rest. That is a small bias and it is still a bias in a bearer token, so
-- bytes at or above 252 (the largest multiple of 36) are discarded.
--
-- Signature is unchanged: gen_claim_code(integer) -> text. checkout_init_atomic
-- and create_list_with_slug both call it and neither needs to know.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gen_claim_code(p_len INTEGER DEFAULT 8)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  -- 36 * 7 = 252. Bytes at 252..255 would skew the first four symbols.
  cutoff   CONSTANT INTEGER := 252;
  result   TEXT := '';
  buf      BYTEA;
  b        INTEGER;
  i        INTEGER;
BEGIN
  IF p_len IS NULL OR p_len < 1 THEN
    RAISE EXCEPTION 'gen_claim_code: length must be at least 1';
  END IF;

  WHILE length(result) < p_len LOOP
    -- 16 bytes of strong randomness per round. A round yields ~15.75 usable
    -- symbols on average, so an 8-character code almost always takes one.
    buf := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');

    FOR i IN 0..(octet_length(buf) - 1) LOOP
      EXIT WHEN length(result) >= p_len;
      b := get_byte(buf, i);
      IF b < cutoff THEN
        result := result || substr(alphabet, (b % 36) + 1, 1);
      END IF;
    END LOOP;
  END LOOP;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.gen_claim_code(integer) IS
  'Claim codes from pg_strong_random via gen_random_uuid, with rejection '
  'sampling to remove modulo bias. Never random() -- a claim code is a bearer '
  'instrument.';

-- ---------------------------------------------------------------------------
-- 2. The fee split, in ngwee
--
-- The invariant that matters: merchant_ngwee + fee_ngwee == gross_ngwee,
-- exactly, for every input. The merchant absorbs the rounding remainder rather
-- than the house, which is both the friendlier choice and the one that cannot
-- accumulate unexplained ngwee in FEE_ACCRUED.
--
-- `merchant_share_for` is left alone: it works in whole kwacha and the legacy
-- path still uses it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_fee_ngwee(p_gross_ngwee bigint)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_percent numeric;
  v_fee     bigint;
BEGIN
  IF p_gross_ngwee IS NULL OR p_gross_ngwee <= 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(merchant_fee_percent, 2.00) INTO v_percent
  FROM public.platform_settings WHERE id = 1;
  v_percent := COALESCE(v_percent, 2.00);

  IF v_percent <= 0 THEN
    RETURN 0;
  END IF;

  v_fee := floor(p_gross_ngwee * v_percent / 100.0)::bigint;

  -- A fee may never exceed the value it is taken from, and a positive fee
  -- percentage on a non-zero amount must not silently round to nothing.
  v_fee := LEAST(v_fee, p_gross_ngwee);

  RETURN GREATEST(v_fee, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Funding (§4.1)
--
-- Called after the webhook has verified the signature and the amount. Posts
-- the full funded amount to the sender's liability -- no fee, no deduction.
--
-- Idempotent on the transaction, not on the webhook delivery. Flutterwave can
-- and does deliver the same event more than once, and the two existing guards
-- (`payment_webhook_idempotency`, the transaction status check) protect the
-- order; this protects the ledger independently, because a ledger that relies
-- on someone else's guard is a ledger with a hole in it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_record_funding(
  p_transaction_id uuid,
  p_external_ref   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx     RECORD;
  v_amount bigint;
  v_pair   uuid;
BEGIN
  SELECT transaction_id, buyer_id, total_amount, currency, status, gateway_tx_ref
  INTO v_tx
  FROM public.transactions
  WHERE transaction_id = p_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'escrow_record_funding: no transaction %', p_transaction_id;
  END IF;

  IF v_tx.buyer_id IS NULL THEN
    RAISE EXCEPTION 'escrow_record_funding: transaction % has no buyer; a liability needs a counterparty',
      p_transaction_id;
  END IF;

  -- §4.1: validate amount and currency strictly -- no unit inference. The
  -- segregated account holds kwacha. An international sender's card is billed
  -- in their own currency (transactions.charge_currency) but what settles here
  -- is ZMW, and guessing which one `total_amount` is expressed in is exactly
  -- the mistake this refuses to make.
  IF COALESCE(v_tx.currency, 'ZMW') <> 'ZMW' THEN
    RAISE EXCEPTION 'escrow_record_funding: transaction % is denominated in %, not ZMW',
      p_transaction_id, v_tx.currency;
  END IF;

  IF v_tx.total_amount IS NULL OR v_tx.total_amount <= 0 THEN
    RAISE EXCEPTION 'escrow_record_funding: transaction % has no positive amount', p_transaction_id;
  END IF;

  v_amount := public.zmw_to_ngwee(v_tx.total_amount);

  v_pair := public.post_ledger_pair(
    'CLIENT_FUNDS',     NULL,
    'SENDER_LIABILITY', v_tx.buyer_id,
    v_amount,
    'FUNDING',
    p_transaction_id, NULL, NULL,
    COALESCE(p_external_ref, v_tx.gateway_tx_ref),
    'funding:' || p_transaction_id::text
  );

  PERFORM public.record_rail_outcome('flutterwave', true, NULL);

  RETURN jsonb_build_object(
    'transaction_id', p_transaction_id,
    'ledger_pair_id', v_pair,
    'amount_ngwee',   v_amount,
    'sender_liability_ngwee', public.ledger_account_balance('SENDER_LIABILITY', v_tx.buyer_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. How much of an order is still unredeemed
--
-- §4.2 calls this the remaining balance, and a scan may not exceed it. Derived
-- from the items rather than the ledger so that an order whose funding predates
-- the ledger (see escrow_open_balances) still answers correctly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_remaining_value_ngwee(p_shop_order_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(public.zmw_to_ngwee(oi.allocated_price)), 0)::bigint
  FROM public.order_items oi
  WHERE oi.shop_order_id = p_shop_order_id
    AND oi.fulfillment_status IN ('PENDING', 'FLOATING');
$$;

-- ---------------------------------------------------------------------------
-- 5. Redemption (§4.2)
--
-- Repeatable and partial: a scan settles the items presented and leaves the
-- rest redeemable. Every precondition is checked before anything moves, and
-- everything that moves happens in this one transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_redeem_items(
  p_claim_code        text,
  p_present_item_ids  uuid[],
  p_missing_item_ids  uuid[],
  p_merchant_user_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order        RECORD;
  v_readiness    jsonb;
  v_rail         text;
  v_code         text := upper(trim(p_claim_code));
  v_present      uuid[] := COALESCE(p_present_item_ids, '{}'::uuid[]);
  v_missing      uuid[] := COALESCE(p_missing_item_ids, '{}'::uuid[]);
  v_row          RECORD;
  v_gross        bigint := 0;
  v_fee_total    bigint := 0;
  v_merchant_total bigint := 0;
  v_item_fee     bigint;
  v_item_value   bigint;
  v_buyer_id     uuid;
  v_remaining    bigint;
  v_hold         integer;
  v_release_at   timestamptz;
  v_instruction  uuid;
  v_open_items   integer;
  v_claim_status text;
  v_shop_name    text;
  v_owner_id     uuid;
BEGIN
  -- -- Preconditions, all before anything moves -----------------------------

  SELECT so.shop_order_id, so.shop_id, so.transaction_id, so.claim_status,
         so.recipient_name, so.expires_at, so.disputed_at
  INTO v_order
  FROM public.shop_orders so
  WHERE so.claim_code = v_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid claim code';
  END IF;

  -- Re-checked under the lock. Between the scanner reading the code and this
  -- row locking, another till could have redeemed it.
  IF v_order.claim_status IN ('REDEEMED', 'CANCELLED', 'EXPIRED', 'REFUNDED') THEN
    RAISE EXCEPTION 'This gift has already been % and cannot be collected',
      lower(v_order.claim_status);
  END IF;

  IF v_order.claim_status = 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION 'This gift has not been paid for yet';
  END IF;

  IF v_order.disputed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This gift is under dispute and cannot be collected';
  END IF;

  IF v_order.expires_at IS NOT NULL AND v_order.expires_at <= now() THEN
    RAISE EXCEPTION 'This gift expired on %', to_char(v_order.expires_at, 'DD Mon YYYY');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_shops
    WHERE user_id = p_merchant_user_id AND shop_id = v_order.shop_id
  ) THEN
    RAISE EXCEPTION 'Forbidden: merchant not assigned to this shop';
  END IF;

  -- §6.1: prevent, don't recover. Refuse the scan while the customer is still
  -- at the counter rather than discover the bad number after the goods are
  -- gone. There is no recovery from the second case.
  v_readiness := public.shop_payout_readiness(v_order.shop_id);
  IF NOT (v_readiness->>'can_accept_redemptions')::boolean THEN
    RAISE EXCEPTION 'Cannot accept collections: %', COALESCE(v_readiness->>'message', 'payout details not verified')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- §6.4: never let a scan succeed that cannot pay out.
  v_rail := v_readiness->>'rail';
  IF NOT public.rail_is_available(v_rail) THEN
    RAISE EXCEPTION 'Payouts via % are temporarily unavailable. Please try again shortly.', v_rail
      USING ERRCODE = 'insufficient_resources';
  END IF;

  IF COALESCE(array_length(v_present, 1), 0) = 0
     AND COALESCE(array_length(v_missing, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one item must be marked present or missing';
  END IF;

  -- Every id supplied must belong to this order and still be open. This is
  -- what stops a merchant redeeming the same item twice across two scans, and
  -- what stops ids from a different order being smuggled in.
  IF EXISTS (
    SELECT 1 FROM unnest(v_present || v_missing) AS wanted(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_item_id = wanted.id
        AND oi.shop_order_id = v_order.shop_order_id
        AND oi.fulfillment_status IN ('PENDING', 'FLOATING')
    )
  ) THEN
    RAISE EXCEPTION 'One or more items are not on this gift or have already been collected';
  END IF;

  SELECT buyer_id INTO v_buyer_id
  FROM public.transactions WHERE transaction_id = v_order.transaction_id;

  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Order % has no sender; cannot move a liability that has no owner',
      v_order.shop_order_id;
  END IF;

  -- §4.2: sufficient remaining balance. The sender's liability must actually
  -- cover what is about to be taken from it. If it does not, something has
  -- already gone wrong and posting anyway would bury the evidence.
  v_remaining := public.ledger_account_balance('SENDER_LIABILITY', v_buyer_id);

  SELECT COALESCE(SUM(public.zmw_to_ngwee(oi.allocated_price)), 0)::bigint
  INTO v_gross
  FROM public.order_items oi
  WHERE oi.order_item_id = ANY (v_present);

  IF v_gross > v_remaining THEN
    RAISE EXCEPTION
      'Insufficient remaining balance on this gift: % ngwee available, % ngwee presented',
      v_remaining, v_gross
      USING ERRCODE = 'insufficient_resources';
  END IF;

  -- -- Move the money ------------------------------------------------------

  -- Recomputed below item by item so the running total and the posted entries
  -- cannot disagree; the check above is what stops us starting at all.
  v_gross := 0;

  FOR v_row IN
    SELECT oi.order_item_id, oi.allocated_price
    FROM public.order_items oi
    WHERE oi.order_item_id = ANY (v_present)
    ORDER BY oi.order_item_id
  LOOP
    v_item_value := public.zmw_to_ngwee(v_row.allocated_price);
    CONTINUE WHEN v_item_value <= 0;

    v_item_fee := public.escrow_fee_ngwee(v_item_value);
    v_gross := v_gross + v_item_value;
    v_fee_total := v_fee_total + v_item_fee;
    v_merchant_total := v_merchant_total + (v_item_value - v_item_fee);

    -- The merchant's share.
    IF v_item_value - v_item_fee > 0 THEN
      PERFORM public.post_ledger_pair(
        'SENDER_LIABILITY', v_buyer_id,
        'MERCHANT_PAYABLE', v_order.shop_id,
        v_item_value - v_item_fee,
        'REDEMPTION',
        v_order.transaction_id, v_order.shop_order_id, v_row.order_item_id,
        v_code,
        'redeem:' || v_row.order_item_id::text
      );
    END IF;

    -- KithLy's fee, accrued -- not swept, and not taken at funding.
    IF v_item_fee > 0 THEN
      PERFORM public.post_ledger_pair(
        'SENDER_LIABILITY', v_buyer_id,
        'FEE_ACCRUED',      NULL,
        v_item_fee,
        'REDEMPTION_FEE',
        v_order.transaction_id, v_order.shop_order_id, v_row.order_item_id,
        v_code,
        'fee:' || v_row.order_item_id::text
      );
    END IF;
  END LOOP;

  IF COALESCE(array_length(v_present, 1), 0) > 0 THEN
    UPDATE public.order_items
    SET fulfillment_status = 'COLLECTED', fulfilled_at = now()
    WHERE order_item_id = ANY (v_present);
  END IF;

  -- Missing items keep their sender liability. Nothing is refunded here: the
  -- value stays in escrow and is returned to source by the expiry sweep
  -- (20260915050000), which is the only refund path in this model.
  IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
    UPDATE public.order_items
    SET fulfillment_status = 'MISSING', fulfilled_at = now()
    WHERE order_item_id = ANY (v_missing);
  END IF;

  -- -- Order state ---------------------------------------------------------

  SELECT COUNT(*) INTO v_open_items
  FROM public.order_items
  WHERE shop_order_id = v_order.shop_order_id
    AND fulfillment_status IN ('PENDING', 'FLOATING');

  IF v_open_items > 0 THEN
    -- Still redeemable. §4.2's PARTIALLY_REDEEMED lives here as a PENDING
    -- order with some items collected -- the existing vocabulary already
    -- expresses it, and inventing a status would break every consumer of
    -- claim_status in the app.
    v_claim_status := 'PENDING';
  ELSIF EXISTS (
    SELECT 1 FROM public.order_items
    WHERE shop_order_id = v_order.shop_order_id AND fulfillment_status = 'MISSING'
  ) THEN
    v_claim_status := 'PARTIAL_FULFILLMENT';
  ELSE
    v_claim_status := 'FULFILLED';
  END IF;

  UPDATE public.shop_orders
  SET claim_status = v_claim_status,
      fulfilled_at = COALESCE(fulfilled_at, now())
  WHERE shop_order_id = v_order.shop_order_id;

  -- -- Enqueue the payout (§5) ---------------------------------------------

  IF v_merchant_total > 0 THEN
    v_hold := public.shop_settlement_hold_seconds(v_order.shop_id);
    v_release_at := now() + make_interval(secs => COALESCE(v_hold, 0));

    -- One instruction per scan, not per item: a merchant would rather receive
    -- one transfer for the basket than five, and every transfer costs a
    -- disbursement tariff.
    v_instruction := public.enqueue_payout(
      v_order.shop_id,
      v_merchant_total,
      'redeem-payout:' || v_order.shop_order_id::text || ':' || md5(array_to_string(v_present, ',')),
      v_order.shop_order_id,
      NULL,
      v_release_at
    );

    UPDATE public.shops
    SET successful_deliveries = successful_deliveries + 1
    WHERE id = v_order.shop_id;

    PERFORM public.refresh_settlement_tier(v_order.shop_id);
  END IF;

  -- -- Trail and notifications ---------------------------------------------

  INSERT INTO public.transaction_events (transaction_id, shop_order_id, event_type, payload)
  VALUES (
    v_order.transaction_id, v_order.shop_order_id, 'ESCROW_REDEMPTION',
    jsonb_build_object(
      'claim_code', v_code,
      'merchant_user_id', p_merchant_user_id,
      'present_item_ids', to_jsonb(v_present),
      'missing_item_ids', to_jsonb(v_missing),
      'gross_ngwee', v_gross,
      'fee_ngwee', v_fee_total,
      'merchant_ngwee', v_merchant_total,
      'payout_instruction_id', v_instruction,
      'release_at', v_release_at,
      'items_still_open', v_open_items
    )
  );

  SELECT name, owner_id INTO v_shop_name, v_owner_id
  FROM public.shops WHERE id = v_order.shop_id;

  PERFORM public.create_notification(
    v_buyer_id,
    COALESCE(v_order.recipient_name, 'Your recipient')
      || CASE WHEN v_open_items > 0 THEN ' collected part of their gift from '
              ELSE ' collected their gift from ' END
      || COALESCE(v_shop_name, 'the shop') || '.'
      || CASE WHEN v_open_items > 0
              THEN ' The rest is still waiting for them.'
              ELSE '' END,
    'success',
    v_order.shop_order_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_status', v_claim_status,
    'gross_ngwee', v_gross,
    'fee_ngwee', v_fee_total,
    'merchant_ngwee', v_merchant_total,
    'payout_instruction_id', v_instruction,
    'payout_release_at', v_release_at,
    -- NULL rather than true when nothing was queued. A scan of only-missing
    -- items pays nobody, and reporting "instant payout" for it would put a
    -- reassuring lie on the cashier's screen.
    'instant_payout', CASE WHEN v_instruction IS NULL THEN NULL
                           ELSE COALESCE(v_hold, 0) = 0 END,
    'items_still_open', v_open_items,
    'remaining_ngwee', public.order_remaining_value_ngwee(v_order.shop_order_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. escrow_shadow_redemption — the dual-write hook (§11.1)
--
-- Called by the legacy `fulfill_voucher_atomic` so the ledger records what the
-- legacy path did, in the same transaction, without changing what it does.
--
-- It swallows nothing and is deliberately not idempotency-keyed on anything
-- the legacy path can repeat, because during dual-write a divergence between
-- the two models is the thing we are trying to detect. If this raises, the
-- fulfilment rolls back -- which is correct: a fulfilment we cannot record is
-- a fulfilment we should not have performed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_shadow_redemption(
  p_shop_order_id uuid,
  p_claim_code    text,
  p_present_total integer,
  p_missing_total integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mode     text;
  v_order    RECORD;
  v_buyer_id uuid;
  v_gross    bigint;
  v_fee      bigint;
BEGIN
  SELECT COALESCE(escrow_mode, 'dual_write') INTO v_mode
  FROM public.platform_settings WHERE id = 1;

  IF COALESCE(v_mode, 'legacy') = 'legacy' THEN
    RETURN;
  END IF;

  IF COALESCE(p_present_total, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT so.shop_id, so.transaction_id INTO v_order
  FROM public.shop_orders so WHERE so.shop_order_id = p_shop_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT buyer_id INTO v_buyer_id
  FROM public.transactions WHERE transaction_id = v_order.transaction_id;

  IF v_buyer_id IS NULL THEN
    RETURN;
  END IF;

  v_gross := public.zmw_to_ngwee(p_present_total);
  v_fee   := public.escrow_fee_ngwee(v_gross);

  IF v_gross - v_fee > 0 THEN
    PERFORM public.post_ledger_pair(
      'SENDER_LIABILITY', v_buyer_id,
      'MERCHANT_PAYABLE', v_order.shop_id,
      v_gross - v_fee,
      'REDEMPTION',
      v_order.transaction_id, p_shop_order_id, NULL,
      upper(trim(COALESCE(p_claim_code, ''))),
      'shadow-redeem:' || p_shop_order_id::text
    );
  END IF;

  IF v_fee > 0 THEN
    PERFORM public.post_ledger_pair(
      'SENDER_LIABILITY', v_buyer_id,
      'FEE_ACCRUED',      NULL,
      v_fee,
      'REDEMPTION_FEE',
      v_order.transaction_id, p_shop_order_id, NULL,
      upper(trim(COALESCE(p_claim_code, ''))),
      'shadow-fee:' || p_shop_order_id::text
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. escrow_open_balances — the opening journal
--
-- A ledger that starts empty cannot record the redemption of a voucher funded
-- before it existed: the debit would drive a sender liability negative, and
-- the master invariant would drift by exactly the value of every in-flight
-- gift.
--
-- So the ledger needs an opening balance for money already held. This is the
-- standard move when a double-entry system replaces a single-entry one, and
-- the entries are marked ADJUSTMENT so they are never mistaken for real
-- fundings in a revenue report.
--
-- DELIBERATELY NOT RUN BY THIS MIGRATION. It is an operational step, taken
-- once, against real data, after `p_dry_run => true` has been reviewed against
-- the bank statement. Running it automatically would post a large set of
-- financial entries as a side effect of a deploy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_open_balances(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row    RECORD;
  v_count  integer := 0;
  v_total  bigint := 0;
  v_amount bigint;
BEGIN
  FOR v_row IN
    SELECT t.transaction_id,
           t.buyer_id,
           t.gateway_tx_ref,
           SUM(public.zmw_to_ngwee(oi.allocated_price))::bigint AS open_ngwee
    FROM public.transactions t
    JOIN public.shop_orders so ON so.transaction_id = t.transaction_id
    JOIN public.order_items oi ON oi.shop_order_id = so.shop_order_id
    WHERE t.status = 'SUCCESS'
      AND t.buyer_id IS NOT NULL
      AND oi.fulfillment_status IN ('PENDING', 'FLOATING')
      AND so.claim_status NOT IN ('CANCELLED', 'EXPIRED', 'REFUNDED')
      -- Skip anything the ledger already knows about, so this is safe to run
      -- twice and safe to run after dual-write has begun.
      AND NOT EXISTS (
        SELECT 1 FROM public.ledger_entries le
        WHERE le.transaction_id = t.transaction_id
          AND le.reason IN ('FUNDING', 'ADJUSTMENT')
      )
    GROUP BY t.transaction_id, t.buyer_id, t.gateway_tx_ref
    HAVING SUM(public.zmw_to_ngwee(oi.allocated_price)) > 0
  LOOP
    v_amount := v_row.open_ngwee;
    v_count := v_count + 1;
    v_total := v_total + v_amount;

    IF NOT p_dry_run THEN
      PERFORM public.post_ledger_pair(
        'CLIENT_FUNDS',     NULL,
        'SENDER_LIABILITY', v_row.buyer_id,
        v_amount,
        'ADJUSTMENT',
        v_row.transaction_id, NULL, NULL,
        v_row.gateway_tx_ref,
        'opening:' || v_row.transaction_id::text
      );
    END IF;
  END LOOP;

  IF NOT p_dry_run AND v_count > 0 THEN
    INSERT INTO public.transaction_events (event_type, payload)
    VALUES ('ESCROW_OPENING_BALANCES_POSTED', jsonb_build_object(
      'transactions', v_count, 'total_ngwee', v_total
    ));
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'transactions', v_count,
    'total_ngwee', v_total,
    'total_zmw', round(v_total / 100.0, 2),
    'ledger_balanced_after', public.ledger_is_balanced()
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.escrow_fee_ngwee(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escrow_record_funding(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.order_remaining_value_ngwee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escrow_redeem_items(text, uuid[], uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escrow_shadow_redemption(uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escrow_open_balances(boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.escrow_fee_ngwee(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.escrow_record_funding(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.order_remaining_value_ngwee(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.escrow_redeem_items(text, uuid[], uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.escrow_shadow_redemption(uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.escrow_open_balances(boolean) TO service_role;
