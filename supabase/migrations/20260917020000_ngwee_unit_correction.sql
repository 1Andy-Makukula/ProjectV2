-- =============================================================================
-- The escrow ledger was recording every amount at one hundred times its value
--
-- WHAT WENT WRONG
-- ---------------
-- 20260915000000 asserted that "the rest of the schema stores whole kwacha
-- (`items.price_zmw`, `order_items.allocated_price` are INTEGER ZMW)" and built
-- `zmw_to_ngwee` as the single conversion boundary into the ledger.
--
-- The premise was false. This schema already stores minor units everywhere:
--
--   * `formatCurrency(amountInNgwee)` divides by 100, and the storefront calls
--     it directly on `items.price_zmw` -- so price_zmw is ngwee.
--   * `flutterwave-webhook` sends `Math.round(data.amount * 100)` as
--     `p_paid_amount`, converting the gateway's major-unit ZMW to ngwee, and
--     `confirm_payment_atomic` compares that straight against
--     `transactions.total_amount`. So total_amount is ngwee.
--   * `price_basket_zmw` returns `basket_zmw_minor`. So the FX path agrees.
--
-- The column is NAMED for the currency and VALUED in its minor unit. Reading
-- `price_zmw INTEGER` and inferring kwacha is how this happened, and checking
-- one formatter would have settled it.
--
-- WHAT IT WOULD HAVE COST
-- -----------------------
-- Every figure in `ledger_entries` a hundred times too large. Not merely
-- cosmetic: `escrow_redeem_items` refuses a scan whose value exceeds the
-- sender's remaining liability, and both sides were inflated equally, so the
-- guard would have passed. Merchants would have been queued payouts of a
-- hundred times what they were owed, and `payout-dispatcher` would have
-- instructed Airtel to send it.
--
-- WHY THE INVARIANT DID NOT CATCH IT, AND WHAT WOULD HAVE
-- -------------------------------------------------------
-- Every account was inflated by the same factor, so debits still equalled
-- credits and `drift` stayed at zero. Internal consistency is preserved by a
-- uniform error -- which is precisely the argument in 20260915060000 for why
-- the daily bank comparison is the control that matters. THAT check would have
-- caught this on its first run, because the bank would have held one hundredth
-- of what the ledger claimed. The design worked; it just had not run yet.
--
-- Caught before cutover. `escrow_mode` has never left `dual_write`, so no real
-- payout, refund or sweep was ever computed from these numbers.
--
-- WHAT CHANGES
-- ------------
-- Thirteen calls to `zmw_to_ngwee` removed from eight functions. Each body was
-- extracted from its live definition and the wrapper stripped by exact string
-- replacement; nothing else was edited. No signature changes, so every ACL is
-- preserved.
--
-- `zmw_to_ngwee` itself survives, unused by the money path. It is correct
-- arithmetic for converting a genuinely kwacha-denominated figure -- a
-- human-entered admin amount, say -- and deleting it would only tempt someone
-- to write `* 100` inline later.
--
-- BLAST RADIUS: replaces eight escrow functions. Behaviour is otherwise
-- identical; only the magnitude of what they record changes.
-- =============================================================================

COMMENT ON FUNCTION public.zmw_to_ngwee(integer) IS
  'Kwacha to ngwee. NOT for schema columns: items.price_zmw, '
  'order_items.allocated_price, shop_orders.subtotal, transactions.total_amount '
  'and transactions.platform_fee are ALREADY ngwee despite their names. '
  'Applying this to any of them multiplies by a hundred -- see 20260917020000.';

-- -------------------------------------------------------------------------
-- escrow_record_funding
-- -------------------------------------------------------------------------
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

  v_amount := v_tx.total_amount;

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

-- -------------------------------------------------------------------------
-- order_remaining_value_ngwee
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_remaining_value_ngwee(p_shop_order_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(oi.allocated_price::bigint), 0)::bigint
  FROM public.order_items oi
  WHERE oi.shop_order_id = p_shop_order_id
    AND oi.fulfillment_status IN ('PENDING', 'FLOATING');
$$;

-- -------------------------------------------------------------------------
-- escrow_shadow_redemption
-- -------------------------------------------------------------------------
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

  v_gross := p_present_total::bigint;
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

-- -------------------------------------------------------------------------
-- escrow_open_balances
-- -------------------------------------------------------------------------
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
           SUM(oi.allocated_price::bigint)::bigint AS open_ngwee
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
    HAVING SUM(oi.allocated_price::bigint) > 0
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

-- -------------------------------------------------------------------------
-- escrow_redeem_items
-- -------------------------------------------------------------------------
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
  v_buyer_share  bigint;
  v_buyer_total  bigint := 0;
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

  SELECT COALESCE(SUM(
           oi.allocated_price::bigint
           + public.order_item_fee_share_ngwee(oi.order_item_id)
         ), 0)::bigint
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
    v_item_value := v_row.allocated_price::bigint;
    CONTINUE WHEN v_item_value <= 0;

    v_item_fee := public.escrow_fee_ngwee(v_item_value);
    v_buyer_share := public.order_item_fee_share_ngwee(v_row.order_item_id);
    v_gross := v_gross + v_item_value + v_buyer_share;
    v_buyer_total := v_buyer_total + v_buyer_share;
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

    -- The buyer's service fee, earned only now.
    --
    -- It was credited to SENDER_LIABILITY at funding along with everything
    -- else (§4.1 takes nothing at the door), and before this it was never
    -- moved out -- so a fully collected order left the fee sitting in the
    -- segregated account, classified as money owed to a sender who was owed
    -- nothing. The invariant still balanced, which is exactly why nothing
    -- caught it: the money was really there, just labelled wrong.
    IF v_buyer_share > 0 THEN
      PERFORM public.post_ledger_pair(
        'SENDER_LIABILITY', v_buyer_id,
        'FEE_ACCRUED',      NULL,
        v_buyer_share,
        'REDEMPTION_FEE',
        v_order.transaction_id, v_order.shop_order_id, v_row.order_item_id,
        v_code,
        'buyerfee:' || v_row.order_item_id::text
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
      'buyer_fee_ngwee', v_buyer_total,
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
    'buyer_fee_ngwee', v_buyer_total,
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

-- -------------------------------------------------------------------------
-- escrow_process_expiries
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escrow_process_expiries(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item        RECORD;
  v_value       bigint;
  v_comp        bigint;
  v_refund      bigint;
  v_buyer_share bigint;
  v_count       integer := 0;
  v_comp_total  bigint := 0;
  v_refund_total bigint := 0;
  v_hold        integer;
  v_owner_id    uuid;
BEGIN
  FOR v_item IN
    SELECT oi.order_item_id,
           oi.allocated_price,
           oi.shop_order_id,
           oi.compensation_percent_at_purchase,
           oi.fulfillment_status,
           so.transaction_id,
           so.shop_id,
           so.claim_code,
           t.buyer_id,
           t.gateway_reference
    FROM public.order_items oi
    JOIN public.shop_orders so ON oi.shop_order_id = so.shop_order_id
    JOIN public.transactions t ON so.transaction_id = t.transaction_id
    JOIN public.items it ON it.id = oi.item_id
    WHERE oi.fulfillment_status IN ('PENDING', 'FLOATING', 'MISSING')
      AND so.claim_status NOT IN ('CANCELLED', 'EXPIRED', 'REFUNDED')
      AND so.disputed_at IS NULL
      AND t.buyer_id IS NOT NULL
      AND (
        -- A merchant who says the item is unavailable has ended the sender's
        -- chance of collecting it at that shop. Holding their money until the
        -- window runs out would be punishing them for the shop's stockout, so
        -- MISSING refunds immediately rather than waiting.
        oi.fulfillment_status = 'MISSING'
        OR (
          COALESCE(it.has_expiry, true)
          AND COALESCE(
                so.expires_at,
                public.voucher_expiry_at(
                  oi.created_at, so.target_execution_date,
                  it.requires_scheduling, it.valid_for_days
                )
              ) <= now()
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.refund_requests r WHERE r.order_item_id = oi.order_item_id
      )
    ORDER BY oi.created_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE OF oi
  LOOP
    v_value := v_item.allocated_price::bigint;
    CONTINUE WHEN v_value <= 0;

    -- §7: compensation only where it was disclosed, and only on a genuine
    -- expiry. An item the shop could not supply earns them nothing.
    IF v_item.fulfillment_status = 'MISSING' THEN
      v_comp := 0;
    ELSE
      v_comp := floor(v_value * COALESCE(v_item.compensation_percent_at_purchase, 0) / 100.0)::bigint;
    END IF;
    v_comp := LEAST(GREATEST(v_comp, 0), v_value);

    -- The buyer's service fee comes back too. The gift never happened, and
    -- charging a service fee for a service that did not occur is the same
    -- thing §7 refuses to do with merchant compensation. Compensation is
    -- taken from the item's value only -- never from the fee.
    v_buyer_share := public.order_item_fee_share_ngwee(v_item.order_item_id);
    v_refund := (v_value - v_comp) + v_buyer_share;

    UPDATE public.order_items
    SET fulfillment_status = 'EXPIRED', fulfilled_at = now()
    WHERE order_item_id = v_item.order_item_id;

    IF v_comp > 0 THEN
      PERFORM public.post_ledger_pair(
        'SENDER_LIABILITY', v_item.buyer_id,
        'MERCHANT_PAYABLE', v_item.shop_id,
        v_comp,
        'EXPIRY_COMPENSATION',
        v_item.transaction_id, v_item.shop_order_id, v_item.order_item_id,
        v_item.claim_code,
        'expiry-comp:' || v_item.order_item_id::text
      );

      -- Compensation is money owed, so it is paid out like any other payable
      -- -- through the tier, through the queue, to a verified destination.
      IF public.shop_can_accept_redemptions(v_item.shop_id) THEN
        v_hold := public.shop_settlement_hold_seconds(v_item.shop_id);
        PERFORM public.enqueue_payout(
          v_item.shop_id, v_comp,
          'expiry-comp-payout:' || v_item.order_item_id::text,
          v_item.shop_order_id, v_item.order_item_id,
          now() + make_interval(secs => COALESCE(v_hold, 0))
        );
      END IF;

      v_comp_total := v_comp_total + v_comp;
    END IF;

    IF v_refund > 0 THEN
      INSERT INTO public.refund_requests (
        transaction_id, shop_order_id, order_item_id, buyer_id,
        amount_ngwee, reason, original_ref, idempotency_key
      )
      VALUES (
        v_item.transaction_id, v_item.shop_order_id, v_item.order_item_id, v_item.buyer_id,
        v_refund,
        CASE WHEN v_item.fulfillment_status = 'MISSING' THEN 'ITEM_UNAVAILABLE' ELSE 'EXPIRY' END,
        v_item.gateway_reference,
        'refund:' || v_item.order_item_id::text
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

      v_refund_total := v_refund_total + v_refund;
    END IF;

    v_count := v_count + 1;

    INSERT INTO public.transaction_events (transaction_id, shop_order_id, event_type, payload)
    VALUES (v_item.transaction_id, v_item.shop_order_id, 'ESCROW_EXPIRED', jsonb_build_object(
      'order_item_id', v_item.order_item_id,
      'value_ngwee', v_value,
      'buyer_fee_refunded_ngwee', v_buyer_share,
      'compensation_ngwee', v_comp,
      'refund_ngwee', v_refund,
      'compensation_percent', COALESCE(v_item.compensation_percent_at_purchase, 0),
      'was_missing', v_item.fulfillment_status = 'MISSING'
    ));

    PERFORM public.create_notification(
      v_item.buyer_id,
      CASE
        WHEN v_item.fulfillment_status = 'MISSING' THEN
          'An item on gift ' || COALESCE(v_item.claim_code, '') || ' was unavailable. '
            || 'We are refunding it to the card or account you paid with.'
        WHEN v_comp > 0 THEN
          'Gift ' || COALESCE(v_item.claim_code, '') || ' went uncollected. '
            || 'As shown at checkout, the shop keeps '
            || COALESCE(v_item.compensation_percent_at_purchase, 0)::text
            || '% for the stock they held; the rest is on its way back to the way you paid.'
        ELSE
          'Gift ' || COALESCE(v_item.claim_code, '') || ' went uncollected. '
            || 'We are refunding it in full to the card or account you paid with.'
      END,
      'warning', v_item.shop_order_id::text
    );

    IF v_comp > 0 THEN
      SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_item.shop_id;
      IF v_owner_id IS NOT NULL THEN
        PERFORM public.create_notification(
          v_owner_id,
          'Gift ' || COALESCE(v_item.claim_code, '') || ' expired uncollected. '
            || 'Your agreed share is on its way to you.',
          'info', v_item.shop_id::text
        );
      END IF;
    END IF;
  END LOOP;

  -- Orders with nothing left open are closed out.
  UPDATE public.shop_orders so
  SET claim_status = 'EXPIRED'
  WHERE so.claim_status NOT IN ('CANCELLED', 'EXPIRED', 'REFUNDED', 'REDEEMED')
    AND EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.shop_order_id = so.shop_order_id AND oi.fulfillment_status = 'EXPIRED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.shop_order_id = so.shop_order_id
        AND oi.fulfillment_status IN ('PENDING', 'FLOATING', 'MISSING')
    );

  RETURN jsonb_build_object(
    'items_expired', v_count,
    'compensation_ngwee', v_comp_total,
    'refunds_created_ngwee', v_refund_total
  );
END;
$$;

-- -------------------------------------------------------------------------
-- order_item_fee_share_ngwee
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_item_fee_share_ngwee(p_order_item_id uuid)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx        uuid;
  v_fee       bigint;
  v_subtotal  bigint;
  v_cum_incl  bigint;
  v_cum_excl  bigint;
BEGIN
  SELECT so.transaction_id INTO v_tx
  FROM public.order_items oi
  JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
  WHERE oi.order_item_id = p_order_item_id;

  IF v_tx IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(t.platform_fee, 0)::bigint
  INTO v_fee
  FROM public.transactions t
  WHERE t.transaction_id = v_tx;

  IF COALESCE(v_fee, 0) <= 0 THEN
    RETURN 0;
  END IF;

  -- The item total this fee was actually computed from. Derived from the order
  -- lines rather than read from transactions.items_subtotal, because the shares
  -- have to sum to the fee against the lines that EXIST -- if the two ever
  -- disagree, trusting the stored figure would strand the difference.
  SELECT COALESCE(SUM(oi.allocated_price::bigint), 0)
  INTO v_subtotal
  FROM public.order_items oi
  JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
  WHERE so.transaction_id = v_tx;

  IF COALESCE(v_subtotal, 0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT
    COALESCE(SUM(oi.allocated_price::bigint)
             FILTER (WHERE oi.order_item_id <= p_order_item_id), 0),
    COALESCE(SUM(oi.allocated_price::bigint)
             FILTER (WHERE oi.order_item_id <  p_order_item_id), 0)
  INTO v_cum_incl, v_cum_excl
  FROM public.order_items oi
  JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
  WHERE so.transaction_id = v_tx;

  RETURN floor(v_fee * v_cum_incl / v_subtotal::numeric)::bigint
       - floor(v_fee * v_cum_excl / v_subtotal::numeric)::bigint;
END;
$$;

-- -------------------------------------------------------------------------
-- refund_charge_instruction
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_charge_instruction(p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_refund        RECORD;
  v_tx            RECORD;
  v_funded_ngwee  bigint;
  v_proportion    numeric;
  v_already       bigint;
  v_headroom      bigint;
  v_amount_minor  bigint;
  v_currency      text;
BEGIN
  SELECT * INTO v_refund FROM public.refund_requests WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_REFUND');
  END IF;

  SELECT transaction_id, total_amount, currency, charge_currency,
         charge_amount_minor, gateway_reference
  INTO v_tx
  FROM public.transactions
  WHERE transaction_id = v_refund.transaction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_TRANSACTION');
  END IF;

  -- Without the gateway's own charge id there is nothing to refund against.
  -- Refusing is right: guessing an identifier sends money at a stranger.
  IF COALESCE(btrim(COALESCE(v_tx.gateway_reference, '')), '') = '' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'NO_GATEWAY_REFERENCE',
      'detail', 'This transaction has no gateway charge id, so no refund can be addressed to it.'
    );
  END IF;

  v_funded_ngwee := COALESCE(v_tx.total_amount, 0);
  IF v_funded_ngwee <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_FUNDED_AMOUNT');
  END IF;

  v_proportion := LEAST(v_refund.amount_ngwee::numeric / v_funded_ngwee::numeric, 1.0);

  -- ---------------------------------------------------------------------
  -- Domestic, and the international fallback: the card was charged kwacha,
  -- so the refund is kwacha and the proportion is already exact.
  -- ---------------------------------------------------------------------
  IF v_tx.charge_currency IS NULL THEN
    v_currency := 'ZMW';
    v_amount_minor := v_refund.amount_ngwee;

    SELECT COALESCE(SUM(r.amount_ngwee), 0) INTO v_already
    FROM public.refund_requests r
    WHERE r.transaction_id = v_refund.transaction_id
      AND r.status = 'COMPLETED'
      AND r.id <> p_refund_id;

    v_headroom := GREATEST(v_funded_ngwee - v_already, 0);
  ELSE
    -- -------------------------------------------------------------------
    -- Charged in a foreign currency. Refund that same proportion of that
    -- same charge, in that same currency.
    -- -------------------------------------------------------------------
    v_currency := v_tx.charge_currency;

    IF COALESCE(v_tx.charge_amount_minor, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NO_CHARGE_AMOUNT');
    END IF;

    v_amount_minor := round(v_tx.charge_amount_minor::numeric * v_proportion)::bigint;

    SELECT COALESCE(SUM(
             round(v_tx.charge_amount_minor::numeric
                   * LEAST(r.amount_ngwee::numeric / v_funded_ngwee::numeric, 1.0))
           ), 0)::bigint
    INTO v_already
    FROM public.refund_requests r
    WHERE r.transaction_id = v_refund.transaction_id
      AND r.status = 'COMPLETED'
      AND r.id <> p_refund_id;

    v_headroom := GREATEST(v_tx.charge_amount_minor - v_already, 0);
  END IF;

  IF v_headroom <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'FULLY_REFUNDED',
      'detail', 'The original charge has already been refunded in full.'
    );
  END IF;

  -- The cap. A sequence of independently rounded partials can otherwise creep
  -- past the charge by a minor unit, which the gateway rejects outright.
  v_amount_minor := LEAST(v_amount_minor, v_headroom);

  IF v_amount_minor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ROUNDS_TO_ZERO');
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'gateway_charge_id', v_tx.gateway_reference,
    'currency',          v_currency,
    'amount_minor',      v_amount_minor,
    -- Flutterwave takes major units on the wire. Rendered here, once, so the
    -- dispatcher never does currency arithmetic of its own.
    'amount_major',      to_char(v_amount_minor / 100.0, 'FM999999999990.00'),
    'proportion',        round(v_proportion, 6),
    'is_foreign',        v_tx.charge_currency IS NOT NULL,
    'refund_ngwee',      v_refund.amount_ngwee
  );
END;
$$;
