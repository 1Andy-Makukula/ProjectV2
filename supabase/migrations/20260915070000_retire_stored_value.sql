-- =============================================================================
-- Retiring stored value
--
-- WHAT IS BEING REMOVED, AND WHY IT IS NOT A DROP
-- -----------------------------------------------
-- §9 removes the sender wallet, the merchant float, and the withdrawal path.
-- All three are stored value -- balances a user controls -- and stored value is
-- a licensed activity KithLy is not licensed for. That is the whole reason this
-- model exists.
--
-- The obvious implementation is DROP FUNCTION. It is the wrong one, for two
-- reasons.
--
-- First, §11 stages this. Until `escrow_mode` reaches `escrow_v2` the legacy
-- path is still the live path, and dropping the functions it calls would take
-- production down on deploy rather than at cutover. The rollback from a bad
-- cutover has to be a settings change, not a migration.
--
-- Second, and more important: dropping the functions I know about does not stop
-- stored value. It stops the call sites I found. Any code path I missed -- an
-- Edge Function, an admin tool, a future migration -- still writes a balance,
-- and the failure is silent.
--
-- SO THE GUARD IS ON THE TABLES, NOT THE FUNCTIONS
-- ------------------------------------------------
-- `wallet_ledger`, `merchant_float_ledger` and `merchant_withdrawals` are where
-- stored value actually comes into existence. A BEFORE INSERT trigger on each
-- refuses the write once escrow_mode is `escrow_v2`, whatever called it. That
-- covers the call sites I have not found, which is the only kind that matters.
--
-- The functions stay defined and become inert. Flipping the mode back restores
-- the old behaviour exactly -- which is what makes the cutover safe to attempt.
--
-- THE ACTUAL DROP
-- ---------------
-- §11.9: drop `wallet_ledger` once dual-write has been clean for a full cycle.
-- That is a later migration written against a production that has already been
-- running on escrow_v2, and it is deliberately not this one. See
-- docs/runbooks/escrow-cutover.md.
--
-- BLAST RADIUS: 🔴 CRITICAL GLOBAL, but inert by default. Nothing changes
-- while escrow_mode is `legacy` or `dual_write`. CI smoke check 1 is extended
-- in the same commit to cover the new ledger.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refuse_stored_value()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mode text;
BEGIN
  SELECT COALESCE(escrow_mode, 'dual_write') INTO v_mode
  FROM public.platform_settings WHERE id = 1;

  IF COALESCE(v_mode, 'legacy') = 'escrow_v2' THEN
    RAISE EXCEPTION
      'Stored value is retired: % may not be written under escrow_v2. '
      'Money moves through ledger_entries and payout_instructions now. '
      '(If this is a legitimate legacy operation, escrow_mode must be rolled '
      'back deliberately -- it is not something to work around.)',
      TG_TABLE_NAME
      USING ERRCODE = 'feature_not_supported';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.refuse_stored_value() IS
  'Blocks every write that creates a user-controlled balance once escrow_mode '
  'is escrow_v2 -- including from call sites nobody remembered.';

DROP TRIGGER IF EXISTS refuse_stored_value_wallet_ledger ON public.wallet_ledger;
CREATE TRIGGER refuse_stored_value_wallet_ledger
  BEFORE INSERT ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.refuse_stored_value();

DROP TRIGGER IF EXISTS refuse_stored_value_merchant_float ON public.merchant_float_ledger;
CREATE TRIGGER refuse_stored_value_merchant_float
  BEFORE INSERT ON public.merchant_float_ledger
  FOR EACH ROW EXECUTE FUNCTION public.refuse_stored_value();

DROP TRIGGER IF EXISTS refuse_stored_value_withdrawals ON public.merchant_withdrawals;
CREATE TRIGGER refuse_stored_value_withdrawals
  BEFORE INSERT ON public.merchant_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.refuse_stored_value();

-- ---------------------------------------------------------------------------
-- 2. The float balance on `shops`
--
-- Not a ledger, so it needs its own guard. Only an INCREASE is refused: a
-- decrease is how an existing float is drained down to zero during migration,
-- and blocking that would strand merchants' money in a balance they can no
-- longer withdraw.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refuse_float_increase()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mode text;
BEGIN
  IF COALESCE(NEW.float_balance, 0) <= COALESCE(OLD.float_balance, 0)
     AND COALESCE(NEW.active_exposure, 0) <= COALESCE(OLD.active_exposure, 0) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(escrow_mode, 'dual_write') INTO v_mode
  FROM public.platform_settings WHERE id = 1;

  IF COALESCE(v_mode, 'legacy') = 'escrow_v2' THEN
    RAISE EXCEPTION
      'Merchant float is retired: shops.float_balance may not increase under '
      'escrow_v2. Merchants are paid out, not banked with.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refuse_float_increase_shops ON public.shops;
CREATE TRIGGER refuse_float_increase_shops
  BEFORE UPDATE OF float_balance, active_exposure ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.refuse_float_increase();

-- ---------------------------------------------------------------------------
-- 3. The legacy expiry sweep stands down
--
-- `process_expired_vouchers` refunds into wallets. Under escrow_v2 that write
-- is refused by the guard above, which would turn a scheduled job into a
-- recurring error rather than a job that has correctly stopped.
--
-- The body below is the live definition extracted from
-- 20260727060000_experiences.sql (lines 241-339), patched by exact string
-- replacement at a single anchor. The complete diff is the five added lines
-- marked ESCROW CUTOVER; no existing line is modified, moved or removed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_expired_vouchers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_refund_percent integer;
  v_sender_refund integer;
  v_merchant_credit integer;
  v_count integer := 0;
  v_owner_id uuid;
BEGIN
  -- ESCROW CUTOVER (20260915070000): escrow_process_expiries owns this now.
  IF COALESCE((SELECT escrow_mode FROM public.platform_settings WHERE id = 1), 'legacy') = 'escrow_v2' THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(expiry_sender_refund_percent, 80) INTO v_refund_percent
  FROM public.platform_settings WHERE id = 1;
  v_refund_percent := COALESCE(v_refund_percent, 80);

  FOR v_item IN
    SELECT oi.order_item_id,
           oi.allocated_price,
           oi.shop_order_id,
           so.transaction_id,
           so.shop_id,
           so.claim_code,
           t.buyer_id
    FROM public.order_items oi
    JOIN public.shop_orders so ON oi.shop_order_id = so.shop_order_id
    JOIN public.transactions t ON so.transaction_id = t.transaction_id
    JOIN public.items it ON it.id = oi.item_id
    WHERE oi.fulfillment_status IN ('PENDING', 'FLOATING')
      AND so.claim_status NOT IN ('REDEEMED', 'CANCELLED', 'EXPIRED')
      AND so.settled IS NOT TRUE
      AND so.disputed_at IS NULL
      AND COALESCE(it.has_expiry, true)
      AND COALESCE(
            so.expires_at,
            public.voucher_expiry_at(
              oi.created_at, so.target_execution_date, it.requires_scheduling, it.valid_for_days
            )
          ) <= now()
    ORDER BY oi.created_at
    LIMIT 1000
    FOR UPDATE OF oi
  LOOP
    v_sender_refund := floor(v_item.allocated_price * v_refund_percent / 100.0)::integer;
    v_merchant_credit := v_item.allocated_price - v_sender_refund;

    UPDATE public.order_items
    SET fulfillment_status = 'EXPIRED', fulfilled_at = now()
    WHERE order_item_id = v_item.order_item_id;

    IF v_sender_refund > 0 THEN
      PERFORM public.increment_wallet_balance(
        v_item.buyer_id, v_sender_refund,
        'REFUND_EXPIRY:' || v_item.order_item_id, v_item.shop_order_id);
    END IF;

    IF v_merchant_credit > 0 THEN
      PERFORM public.increment_merchant_balance(v_item.shop_id, v_merchant_credit);

      INSERT INTO public.payout_ledger
        (shop_order_id, shop_id, amount, commission, status, ledger_type, credit_amount)
      VALUES
        (v_item.shop_order_id, v_item.shop_id, v_merchant_credit, 0,
         'pending_withdrawal', 'EXPIRY_CREDIT', v_merchant_credit);
    END IF;

    INSERT INTO public.transaction_events (transaction_id, event_type, payload)
    VALUES (
      v_item.transaction_id, 'AUTO_EXPIRED',
      jsonb_build_object(
        'order_item_id', v_item.order_item_id,
        'allocated_price', v_item.allocated_price,
        'buyer_id', v_item.buyer_id,
        'sender_refund', v_sender_refund,
        'merchant_credit', v_merchant_credit,
        'refund_percent', v_refund_percent
      ));

    PERFORM public.create_notification(
      v_item.buyer_id,
      'Gift ' || COALESCE(v_item.claim_code, '') || ' went uncollected and has expired. '
        || v_refund_percent::text || '% of its value is back in your wallet.',
      'warning', v_item.shop_order_id::text);

    SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = v_item.shop_id;
    IF v_merchant_credit > 0 AND v_owner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_owner_id,
        'Gift ' || COALESCE(v_item.claim_code, '') || ' expired uncollected. '
          || 'A partial credit has been added to your balance.',
        'info', v_item.shop_order_id::text);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. What a sender is owed, without a wallet
--
-- The sender-facing UI needs a figure to show where the wallet balance used to
-- be. It is NOT a balance: it is the sum of gifts that have been paid for and
-- not yet collected, plus refunds in flight. The sender cannot spend it or
-- direct it -- it is already committed to specific gifts -- and the wording
-- here is deliberately about gifts rather than money for that reason.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sender_escrow_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_open      bigint;
  v_refunding bigint;
  v_held      bigint;
BEGIN
  v_open := public.ledger_account_balance('SENDER_LIABILITY', p_user_id);

  SELECT COALESCE(SUM(amount_ngwee) FILTER (WHERE status IN ('SCHEDULED','CLAIMED','SENT','FAILED')), 0),
         COALESCE(SUM(amount_ngwee) FILTER (WHERE status IN ('REFUND_PENDING','UNCLAIMED')), 0)
  INTO v_refunding, v_held
  FROM public.refund_requests
  WHERE buyer_id = p_user_id;

  RETURN jsonb_build_object(
    'awaiting_collection_ngwee', GREATEST(v_open - v_refunding - v_held, 0),
    'refund_on_the_way_ngwee',   v_refunding,
    'refund_needs_details_ngwee', v_held,
    'total_in_escrow_ngwee',     v_open,
    -- There is no spendable balance, and the UI must not imply one.
    'is_spendable',              false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.refuse_stored_value() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refuse_float_increase() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sender_escrow_summary(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sender_escrow_summary(uuid) TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Where the removals are recorded
-- ---------------------------------------------------------------------------
-- Guarded on existence rather than stated flatly: the SQL test scaffold stubs
-- the stored-value TABLES (so the triggers above can attach) but not the
-- legacy FUNCTIONS, and a COMMENT on a missing function aborts the migration.
-- In production all three exist and all three get their comment.
DO $$
BEGIN
  IF to_regprocedure('public.increment_wallet_balance(uuid, integer, text, uuid)') IS NOT NULL THEN
    COMMENT ON FUNCTION public.increment_wallet_balance(uuid, integer, text, uuid) IS
      'RETIRED by 20260915070000. Inert under escrow_v2: wallet_ledger refuses the '
      'write. Kept defined so a cutover can be rolled back by settings alone. '
      'Dropped by the 11.9 migration once a full clean cycle has passed.';
  END IF;

  IF to_regprocedure('public.request_withdrawal_atomic(uuid, integer)') IS NOT NULL THEN
    COMMENT ON FUNCTION public.request_withdrawal_atomic(uuid, integer) IS
      'RETIRED by 20260915070000. Merchants no longer bank with KithLy; they are '
      'paid out per settlement tier. Inert under escrow_v2.';
  END IF;

  IF to_regprocedure('public.reverse_completed_withdrawal(uuid, text, text)') IS NOT NULL THEN
    COMMENT ON FUNCTION public.reverse_completed_withdrawal(uuid, text, text) IS
      'RETIRED by 20260915070000. There are no withdrawals left to reverse.';
  END IF;
END $$;

COMMENT ON TABLE public.wallet_ledger IS
  'RETIRED by 20260915070000, dropped later per §11.9. Superseded by '
  'ledger_entries. Writes are refused under escrow_v2.';
