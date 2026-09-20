-- =============================================================================
-- What to actually tell the gateway when refunding
--
-- THE PROBLEM THIS SOLVES
-- -----------------------
-- `refund_requests.amount_ngwee` is kwacha, because the ledger is kwacha and
-- the segregated account holds kwacha. But a refund is issued against the
-- original charge, and the original charge may not have been in kwacha: a
-- sender in London is billed in pounds, and `transactions.charge_currency` /
-- `charge_amount_minor` record that (20260809130000).
--
-- So the dispatcher cannot simply divide `amount_ngwee` by 100 and send it. It
-- needs to know what currency to refund in and how much of the original charge
-- this refund represents.
--
-- WHY A PROPORTION OF THE ORIGINAL CHARGE, AND NOT A CONVERSION
-- -------------------------------------------------------------
-- The tempting implementation converts the kwacha figure back at some rate.
-- Every version of that is wrong:
--
--   * At today's rate, the sender gets back a different number of pounds than
--     they paid, for a gift that never happened. They will read that as being
--     charged for nothing, and they will be right.
--   * At the original rate, the arithmetic is sound but it is still a NEW
--     amount computed by us -- and Flutterwave refunds against the charge, so a
--     figure that drifts by a penny from a clean proportion can exceed it.
--
-- The proportion approach avoids converting at all. If 70% of the kwacha value
-- of an order is being refunded, we refund 70% of what the card was charged --
-- in the currency it was charged in. No rate is consulted, so no rate can move.
--
-- WHO CARRIES THE FX MOVE. KithLy does, and deliberately. Between funding and
-- expiry the kwacha we hold may be worth more or less than the pounds we owe
-- back. Passing that to the sender means refunding someone less than they paid
-- because a rate moved while their recipient failed to collect, which is not
-- defensible to them or to a regulator. The exposure is bounded by the
-- redemption window, which is exactly why that window is now a treasury number
-- and not only a product one.
--
-- THE OVER-REFUND GUARD
-- ---------------------
-- Several partial refunds can be issued against one charge -- one item expires
-- this week, another next. Rounding each proportion independently can sum to a
-- minor unit more than the charge. The cap makes that structurally impossible:
-- no instruction may exceed what is left unrefunded on the charge.
--
-- BLAST RADIUS: purely additive. One new read-only function. No existing
-- function or table is touched.
-- =============================================================================

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

  v_funded_ngwee := public.zmw_to_ngwee(COALESCE(v_tx.total_amount, 0));
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

COMMENT ON FUNCTION public.refund_charge_instruction(uuid) IS
  'What to send the gateway for one refund: which charge, which currency, how '
  'much. Refunds a proportion of the original charge rather than converting a '
  'kwacha figure, so no exchange rate is consulted.';

REVOKE ALL ON FUNCTION public.refund_charge_instruction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_charge_instruction(uuid) TO service_role;
