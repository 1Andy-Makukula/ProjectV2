-- =============================================================================
-- Two defects in the escrow money path, found by building the refund dispatcher
--
-- DEFECT 1 -- THE BUYER'S SERVICE FEE WAS NEVER EARNED
-- ----------------------------------------------------
-- `checkout_init_atomic` charges the buyer `items_subtotal + platform_fee`, and
-- `transactions.total_amount` is that gross figure. The escrow funding leg
-- credits SENDER_LIABILITY with the whole of it, which is correct: §4.1 takes
-- nothing at the door.
--
-- Redemption then moved only the ITEM values out of that liability. The buyer's
-- service fee was never moved anywhere. So a fully collected order -- nothing
-- outstanding, nothing owed to anyone -- left the fee sitting in the segregated
-- client funds account, classified as money owed to a sender who was owed
-- nothing. Measured on a K1,000 basket at the 8% local rate:
--
--     CLIENT_FUNDS      108,000 ngwee
--     MERCHANT_PAYABLE   98,000
--     FEE_ACCRUED         2,000   (the 2% merchant fee only)
--     SENDER_LIABILITY    8,000   <- the buyer's fee, stranded permanently
--
-- WHY NOTHING CAUGHT IT. The master invariant still balanced -- drift was
-- exactly zero -- because the money genuinely was in the account. It was only
-- labelled wrong. This is the precise failure mode reconciliation cannot see:
-- it compares a total against the bank, and the total was right.
--
-- It matters for three reasons. The fee sweep only sweeps FEE_ACCRUED, so that
-- revenue would never have been swept. Principle 2 says the segregated account
-- holds customer funds ONLY, and this put KithLy's own money in it in
-- perpetuity. And sender liabilities -- the number that says what KithLy owes
-- the public -- were overstated by the platform fee on all-time volume.
--
-- WHY PRO RATA, AND WHY THIS PARTICULAR ARITHMETIC
-- ------------------------------------------------
-- The fee is charged once, on the whole basket, but redemption is per item and
-- repeatable across shops and days (§4.2). So each item has to carry its own
-- share, and the shares must sum to the fee EXACTLY -- a rounding scheme that
-- loses a ngwee leaves an unsweepable residue behind, which is the same bug in
-- miniature.
--
-- `order_item_fee_share_ngwee` uses the running-total difference method:
--
--     share(i) = floor(F * cum_incl(i) / S) - floor(F * cum_excl(i) / S)
--
-- The floors telescope, so the shares sum to floor(F * S / S) = F, exactly,
-- for any number of items and any split. Ordering is by order_item_id, which
-- is stable, so an item's share is the same number whenever it is asked for --
-- which matters because redemption and expiry ask at different times.
--
-- DEFECT 2 -- REFUNDS WERE ADDRESSED TO THE WRONG IDENTIFIER
-- -----------------------------------------------------------
-- `refund_requests.original_ref` was populated from
-- `transactions.gateway_tx_ref` -- KithLy's own reference, the one we generate
-- and send TO the gateway.
--
-- A Flutterwave refund is issued against Flutterwave's charge id, which this
-- schema stores in `transactions.gateway_reference` (see 20260809010000, which
-- extracts it from the gateway's own response body precisely so it can be
-- trusted). Every refund would have been addressed to an id Flutterwave has
-- never heard of, and failed.
--
-- Not caught earlier because nothing called the refund path: the RPCs existed
-- and had no caller. Building the dispatcher is what surfaced it.
--
-- BLAST RADIUS: replaces two escrow money functions. Both bodies were
-- extracted from their live definitions and patched by exact string
-- replacement at unique anchors; the complete diffs are additive apart from
-- the two `gateway_tx_ref` -> `gateway_reference` lines. No signature changes,
-- so CREATE OR REPLACE preserves both ACLs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. What share of the buyer's fee one order line carries
--
-- STABLE, not VOLATILE: the same item must yield the same share on the day it
-- is redeemed and on the day it would have expired, or the two paths disagree
-- about how much to move and the liability never lands on zero.
-- ---------------------------------------------------------------------------
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

  SELECT public.zmw_to_ngwee(COALESCE(t.platform_fee, 0))
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
  SELECT COALESCE(SUM(public.zmw_to_ngwee(oi.allocated_price)), 0)
  INTO v_subtotal
  FROM public.order_items oi
  JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
  WHERE so.transaction_id = v_tx;

  IF COALESCE(v_subtotal, 0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT
    COALESCE(SUM(public.zmw_to_ngwee(oi.allocated_price))
             FILTER (WHERE oi.order_item_id <= p_order_item_id), 0),
    COALESCE(SUM(public.zmw_to_ngwee(oi.allocated_price))
             FILTER (WHERE oi.order_item_id <  p_order_item_id), 0)
  INTO v_cum_incl, v_cum_excl
  FROM public.order_items oi
  JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
  WHERE so.transaction_id = v_tx;

  RETURN floor(v_fee * v_cum_incl / v_subtotal::numeric)::bigint
       - floor(v_fee * v_cum_excl / v_subtotal::numeric)::bigint;
END;
$$;

COMMENT ON FUNCTION public.order_item_fee_share_ngwee(uuid) IS
  'The share of the buyer platform fee one order line carries. Shares over a '
  'transaction sum to the fee exactly, by construction.';

-- ---------------------------------------------------------------------------
-- 2. Redemption now earns the buyer fee alongside the item value
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
           public.zmw_to_ngwee(oi.allocated_price)
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
    v_item_value := public.zmw_to_ngwee(v_row.allocated_price);
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

-- ---------------------------------------------------------------------------
-- 3. Expiry refunds the buyer fee too, and to the right gateway id
-- ---------------------------------------------------------------------------
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
    v_value := public.zmw_to_ngwee(v_item.allocated_price);
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

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.order_item_fee_share_ngwee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_item_fee_share_ngwee(uuid) TO service_role;
