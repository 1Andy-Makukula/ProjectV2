-- =============================================================================
-- Double-entry ledger — the new source of truth for customer money
--
-- WHY THIS REPLACES wallet_ledger
-- -------------------------------
-- `wallet_ledger` is single-entry: one row, one signed amount, one wallet. It
-- can tell you what a wallet holds. It cannot tell you where that value came
-- from or what it is owed to, and it cannot be checked against anything. A
-- single-entry ledger is internally consistent by construction and therefore
-- proves nothing -- a code path that credits a wallet without a corresponding
-- debit anywhere leaves no trace at all.
--
-- Double entry makes that class of bug loud. Every movement writes exactly two
-- rows sharing an `entry_pair_id`, one DEBIT and one CREDIT of the same
-- amount. Global debits equal global credits, always, and any code path that
-- breaks that fails an assertion rather than quietly losing money.
--
-- THE MASTER INVARIANT
-- --------------------
--   segregated_account_balance == open_sender_liabilities
--                               + pending_merchant_payouts
--                               + accrued_unswept_fees
--
-- The right-hand side is computed here; the left-hand side comes from the bank
-- in the daily reconciliation (20260915060000). That comparison is the single
-- most important control in the system: internal consistency is not
-- correctness, and only the bank can tell us the money is actually there.
--
-- WHY NGWEE AND NOT KWACHA
-- ------------------------
-- The rest of the schema stores whole kwacha (`items.price_zmw`,
-- `order_items.allocated_price` are INTEGER ZMW). The ledger stores ngwee --
-- hundredths -- because a fee of a percentage of a small item rounds to zero
-- in whole kwacha, and a fee that rounds to zero is revenue that silently
-- disappears. `zmw_to_ngwee` is the ONLY conversion boundary; nothing else in
-- this chain may multiply or divide by 100.
--
-- WHY A QUERY AND NOT A BALANCE COLUMN
-- ------------------------------------
-- A stored balance is a cache, and this repo has already shipped one bug where
-- an incrementing balance trigger doubled a customer's wallet
-- (20260809180000 exists to undo exactly that). Balances here are always a
-- query over entries. At KithLy's scale -- tens of shops, thousands of orders
-- -- that is microseconds. When it stops being, the answer is a materialised
-- daily snapshot with the query as its definition, not an incrementing column.
--
-- BLAST RADIUS: this migration is purely additive. It creates new tables and
-- functions and touches no existing one. Nothing reads it until
-- 20260915040000 begins dual-writing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The escrow mode switch
--
-- The cutover from stored value to escrow is staged, not flipped: §11 of the
-- settlement model requires dual-write and a verified equality period before
-- any behaviour changes. This column is what stages it.
--
--   legacy     -- pre-escrow behaviour, no ledger writes. Rollback target.
--   dual_write -- ledger pairs written alongside existing wallet/float moves.
--                 Observable behaviour is IDENTICAL to legacy. This is the
--                 default, and it is safe to deploy into production as-is.
--   escrow_v2  -- the ledger is authoritative: fees accrue at redemption,
--                 refunds go to source, no stored value is created.
--
-- Moving to `escrow_v2` is a deliberate operational act performed only after
-- the reconciliation job has run clean for a full cycle. It is not a deploy
-- step.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS escrow_mode text NOT NULL DEFAULT 'dual_write';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_escrow_mode_check'
  ) THEN
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_escrow_mode_check
      CHECK (escrow_mode IN ('legacy', 'dual_write', 'escrow_v2'));
  END IF;
END $$;

COMMENT ON COLUMN public.platform_settings.escrow_mode IS
  'Staged cutover switch: legacy | dual_write | escrow_v2. See 20260915000000.';

-- ---------------------------------------------------------------------------
-- 2. Unit conversion — the single boundary between kwacha and ngwee
--
-- Every amount entering the ledger from the existing schema passes through
-- here. Nothing else may do the arithmetic: a stray `* 100` in a call site is
-- how a hundredfold error reaches a bank instruction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zmw_to_ngwee(p_zmw integer)
RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT
AS $$ SELECT p_zmw::bigint * 100; $$;

COMMENT ON FUNCTION public.zmw_to_ngwee(integer) IS
  'The only kwacha-to-ngwee conversion in the money path. Never inline this.';

-- ---------------------------------------------------------------------------
-- 3. The ledger itself
--
-- Append-only. Corrections are made by writing a reversing pair, never by
-- editing history -- `enforce_immutable_ledger` makes that structural rather
-- than advisory, and CI smoke check 1 asserts the trigger is still attached.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links the two sides of one movement. Exactly two rows share this value:
  -- one DEBIT and one CREDIT, of equal amount.
  entry_pair_id    uuid NOT NULL,

  account_type     text NOT NULL,
  -- Sender id for SENDER_LIABILITY, shop id for MERCHANT_PAYABLE, NULL for
  -- the house accounts. Constrained below -- a liability with no counterparty
  -- is money nobody can claim.
  account_ref      uuid,

  direction        text NOT NULL,
  amount_ngwee     bigint NOT NULL,

  -- Why this movement happened, in machine-readable form. Not free text: the
  -- reconciliation report groups by it, so it has a closed vocabulary.
  reason           text NOT NULL,

  transaction_id   uuid,
  shop_order_id    uuid,
  order_item_id    uuid,

  -- Flutterwave transaction id, Airtel `airtel_money_id`, bank reference.
  external_ref     text,

  -- Set on both rows of a pair. The unique index below turns this into the
  -- posting idempotency guarantee.
  idempotency_key  text,

  -- Set on a correcting pair, pointing at the pair it reverses.
  reverses_pair_id uuid,

  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entries_account_type_check CHECK (
    account_type IN (
      'CLIENT_FUNDS',      -- asset:     the segregated client funds account
      'SENDER_LIABILITY',  -- liability: funded, not yet redeemed or refunded
      'MERCHANT_PAYABLE',  -- liability: redeemed, not yet paid out
      'FEE_ACCRUED',       -- liability: earned at redemption, not yet swept
      'OPERATING'          -- asset:     KithLy's own money, post-sweep
    )
  ),
  CONSTRAINT ledger_entries_direction_check CHECK (direction IN ('DEBIT', 'CREDIT')),

  -- Zero-value and negative postings are always a caller bug. A movement of
  -- nothing should not be recorded, and a negative debit is a credit written
  -- by someone who did not mean to write one.
  CONSTRAINT ledger_entries_amount_positive_check CHECK (amount_ngwee > 0),

  -- House accounts have no counterparty; party accounts must have one.
  CONSTRAINT ledger_entries_account_ref_check CHECK (
    CASE
      WHEN account_type IN ('SENDER_LIABILITY', 'MERCHANT_PAYABLE') THEN account_ref IS NOT NULL
      ELSE account_ref IS NULL
    END
  ),

  CONSTRAINT ledger_entries_reason_check CHECK (
    reason IN (
      'FUNDING',              -- §4.1 sender pays in
      'REDEMPTION',           -- §4.2 item collected, value moves to the merchant
      'REDEMPTION_FEE',       -- §4.2 KithLy's fee, accrued at redemption
      'PAYOUT',               -- §4.3 merchant paid out
      'FEE_SWEEP',            -- §4.4 accrued fees moved to operating
      'EXPIRY_REFUND',        -- §4.5 unredeemed value returned to source
      'EXPIRY_COMPENSATION',  -- §7   disclosed compensation to the merchant
      'REVERSAL',             -- correction of an earlier pair
      'ADJUSTMENT'            -- deliberate manual correction, admin-logged
    )
  )
);

-- The balance queries filter on exactly this. Without it every balance read is
-- a sequential scan of the entire money history.
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
  ON public.ledger_entries (account_type, account_ref);

CREATE INDEX IF NOT EXISTS ledger_entries_pair_idx
  ON public.ledger_entries (entry_pair_id);

CREATE INDEX IF NOT EXISTS ledger_entries_created_idx
  ON public.ledger_entries (created_at);

CREATE INDEX IF NOT EXISTS ledger_entries_shop_order_idx
  ON public.ledger_entries (shop_order_id)
  WHERE shop_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ledger_entries_external_ref_idx
  ON public.ledger_entries (external_ref)
  WHERE external_ref IS NOT NULL;

-- Posting idempotency, structurally.
--
-- The key is written to BOTH rows of a pair, so a plain unique index on the
-- key alone would reject the pair's own second row. Keying on
-- (idempotency_key, direction) permits exactly one DEBIT and one CREDIT per
-- key -- which is exactly one pair -- and rejects a second posting attempt.
-- This is what makes a retried webhook or a double-scanned QR code harmless.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_idempotency_idx
  ON public.ledger_entries (idempotency_key, direction)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE public.ledger_entries IS
  'Double-entry ledger. Append-only. Two rows per movement sharing entry_pair_id. '
  'Amounts are ngwee. Corrections are reversing pairs, never edits.';

-- ---------------------------------------------------------------------------
-- 4. Immutability
--
-- Same protection the other four ledgers carry. CI smoke check 1 is extended
-- to include this table in the same commit.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS enforce_immutable_ledger_entries ON public.ledger_entries;
CREATE TRIGGER enforce_immutable_ledger_entries
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

-- ---------------------------------------------------------------------------
-- 5. Row level security
--
-- A sender sees the entries against their own liability; a merchant sees the
-- entries against their own payable. Nobody but an admin sees the house
-- accounts, because the house account balances are the platform's financial
-- position.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_entries_select ON public.ledger_entries;
CREATE POLICY ledger_entries_select ON public.ledger_entries
  FOR SELECT TO authenticated
  USING (
    (account_type = 'SENDER_LIABILITY' AND account_ref = auth.uid())
    OR (
      account_type = 'MERCHANT_PAYABLE'
      AND EXISTS (
        SELECT 1 FROM public.merchant_shops ms
        WHERE ms.shop_id = ledger_entries.account_ref AND ms.user_id = auth.uid()
      )
    )
    OR public.current_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 6. post_ledger_pair — the only way to write to this ledger
--
-- Nothing INSERTs into ledger_entries directly. Routing every write through
-- one function is what lets the double-entry guarantee be enforced in one
-- place instead of trusted at every call site.
--
-- Returns the entry_pair_id. On a repeated idempotency key it returns the
-- EXISTING pair id and writes nothing -- a retried webhook is a no-op, not an
-- error, because raising would turn a successful retry into a failed one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_ledger_pair(
  p_debit_account   text,
  p_debit_ref       uuid,
  p_credit_account  text,
  p_credit_ref      uuid,
  p_amount_ngwee    bigint,
  p_reason          text,
  p_transaction_id  uuid    DEFAULT NULL,
  p_shop_order_id   uuid    DEFAULT NULL,
  p_order_item_id   uuid    DEFAULT NULL,
  p_external_ref    text    DEFAULT NULL,
  p_idempotency_key text    DEFAULT NULL,
  p_reverses_pair   uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pair_id uuid;
  v_existing uuid;
BEGIN
  IF p_amount_ngwee IS NULL OR p_amount_ngwee <= 0 THEN
    RAISE EXCEPTION 'post_ledger_pair: amount must be positive ngwee, got %', p_amount_ngwee
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_debit_account = p_credit_account AND p_debit_ref IS NOT DISTINCT FROM p_credit_ref THEN
    RAISE EXCEPTION 'post_ledger_pair: refusing a self-transfer on %', p_debit_account
      USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotency, checked before the write so a retry costs one index probe.
  -- The unique index is still the real guarantee: two concurrent retries both
  -- pass this check, and the loser takes the exception path below.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT entry_pair_id INTO v_existing
    FROM public.ledger_entries
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  v_pair_id := gen_random_uuid();

  BEGIN
    INSERT INTO public.ledger_entries (
      entry_pair_id, account_type, account_ref, direction, amount_ngwee, reason,
      transaction_id, shop_order_id, order_item_id, external_ref, idempotency_key,
      reverses_pair_id
    )
    VALUES
      (v_pair_id, p_debit_account, p_debit_ref, 'DEBIT', p_amount_ngwee, p_reason,
       p_transaction_id, p_shop_order_id, p_order_item_id, p_external_ref, p_idempotency_key,
       p_reverses_pair),
      (v_pair_id, p_credit_account, p_credit_ref, 'CREDIT', p_amount_ngwee, p_reason,
       p_transaction_id, p_shop_order_id, p_order_item_id, p_external_ref, p_idempotency_key,
       p_reverses_pair);
  EXCEPTION
    WHEN unique_violation THEN
      -- A concurrent caller won the race with the same key. Their pair is as
      -- good as ours would have been; return it.
      SELECT entry_pair_id INTO v_existing
      FROM public.ledger_entries
      WHERE idempotency_key = p_idempotency_key
      LIMIT 1;

      IF v_existing IS NULL THEN
        RAISE;
      END IF;
      RETURN v_existing;
  END;

  RETURN v_pair_id;
END;
$$;

COMMENT ON FUNCTION public.post_ledger_pair(text, uuid, text, uuid, bigint, text, uuid, uuid, uuid, text, text, uuid) IS
  'The only writer to ledger_entries. Writes one balanced DEBIT/CREDIT pair. '
  'Idempotent on p_idempotency_key: a repeat returns the existing pair id.';

-- ---------------------------------------------------------------------------
-- 7. reverse_ledger_pair — corrections without rewriting history
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_ledger_pair(
  p_pair_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_debit RECORD;
  v_credit RECORD;
BEGIN
  SELECT * INTO v_debit FROM public.ledger_entries
  WHERE entry_pair_id = p_pair_id AND direction = 'DEBIT';

  SELECT * INTO v_credit FROM public.ledger_entries
  WHERE entry_pair_id = p_pair_id AND direction = 'CREDIT';

  IF v_debit IS NULL OR v_credit IS NULL THEN
    RAISE EXCEPTION 'reverse_ledger_pair: no such pair %', p_pair_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_entries WHERE reverses_pair_id = p_pair_id) THEN
    RAISE EXCEPTION 'reverse_ledger_pair: pair % is already reversed', p_pair_id;
  END IF;

  -- Sides swap: the reversal debits what the original credited.
  RETURN public.post_ledger_pair(
    v_credit.account_type, v_credit.account_ref,
    v_debit.account_type,  v_debit.account_ref,
    v_debit.amount_ngwee,
    'REVERSAL',
    v_debit.transaction_id, v_debit.shop_order_id, v_debit.order_item_id,
    v_debit.external_ref,
    COALESCE(p_idempotency_key, 'reversal:' || p_pair_id::text),
    p_pair_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Balances
--
-- Normal balance by account class: assets are debit-normal, liabilities are
-- credit-normal. Getting this backwards makes every number negative, which is
-- obvious -- so the sign convention is asserted in the test suite rather than
-- trusted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ledger_balances
WITH (security_invoker = true) AS
SELECT
  e.account_type,
  e.account_ref,
  SUM(CASE WHEN e.direction = 'DEBIT'  THEN e.amount_ngwee ELSE 0 END) AS debits_ngwee,
  SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_ngwee ELSE 0 END) AS credits_ngwee,
  CASE
    WHEN e.account_type IN ('CLIENT_FUNDS', 'OPERATING')
      THEN SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_ngwee ELSE -e.amount_ngwee END)
    ELSE SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_ngwee ELSE -e.amount_ngwee END)
  END AS balance_ngwee,
  COUNT(*)      AS entry_count,
  MAX(e.created_at) AS last_entry_at
FROM public.ledger_entries e
GROUP BY e.account_type, e.account_ref;

COMMENT ON VIEW public.ledger_balances IS
  'Per-account balances, signed by normal balance (assets debit-normal, '
  'liabilities credit-normal). A query, never a cache.';

CREATE OR REPLACE FUNCTION public.ledger_account_balance(
  p_account_type text,
  p_account_ref uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN p_account_type IN ('CLIENT_FUNDS', 'OPERATING')
        THEN CASE WHEN e.direction = 'DEBIT' THEN e.amount_ngwee ELSE -e.amount_ngwee END
      ELSE CASE WHEN e.direction = 'CREDIT' THEN e.amount_ngwee ELSE -e.amount_ngwee END
    END
  ), 0)::bigint
  FROM public.ledger_entries e
  WHERE e.account_type = p_account_type
    AND (p_account_ref IS NULL OR e.account_ref = p_account_ref);
$$;

-- ---------------------------------------------------------------------------
-- 9. The invariants
--
-- `ledger_is_balanced` is the structural one: global debits equal global
-- credits. It is guaranteed by post_ledger_pair being the only writer, which
-- is exactly why it must be checked -- the assertion is what detects a future
-- code path that bypasses the function and INSERTs directly.
--
-- `ledger_master_invariant` is the financial one. Given the five account types
-- and balanced pairs, it holds identically:
--
--   (client_funds + operating) - (sender + merchant + fees) == debits - credits == 0
--
-- so any non-zero drift means a single-sided entry exists. The daily
-- reconciliation compares the same figure against the bank.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_is_balanced()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE WHEN direction = 'DEBIT' THEN amount_ngwee ELSE -amount_ngwee END
  ), 0) = 0
  FROM public.ledger_entries;
$$;

CREATE OR REPLACE FUNCTION public.ledger_master_invariant()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_client    bigint;
  v_operating bigint;
  v_sender    bigint;
  v_merchant  bigint;
  v_fees      bigint;
  v_drift     bigint;
BEGIN
  v_client    := public.ledger_account_balance('CLIENT_FUNDS');
  v_operating := public.ledger_account_balance('OPERATING');
  v_sender    := public.ledger_account_balance('SENDER_LIABILITY');
  v_merchant  := public.ledger_account_balance('MERCHANT_PAYABLE');
  v_fees      := public.ledger_account_balance('FEE_ACCRUED');

  v_drift := (v_client + v_operating) - (v_sender + v_merchant + v_fees);

  RETURN jsonb_build_object(
    'client_funds_ngwee',        v_client,
    'operating_ngwee',           v_operating,
    'sender_liabilities_ngwee',  v_sender,
    'merchant_payables_ngwee',   v_merchant,
    'fees_accrued_ngwee',        v_fees,
    'expected_client_funds_ngwee', v_sender + v_merchant + v_fees - v_operating,
    'drift_ngwee',               v_drift,
    'balanced',                  public.ledger_is_balanced(),
    'computed_at',               now()
  );
END;
$$;

-- Raises rather than returning. Used by the reconciliation job and the test
-- suite, where a silent false is worse than a loud failure.
CREATE OR REPLACE FUNCTION public.assert_ledger_balanced()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_delta bigint;
BEGIN
  SELECT COALESCE(SUM(
    CASE WHEN direction = 'DEBIT' THEN amount_ngwee ELSE -amount_ngwee END
  ), 0) INTO v_delta
  FROM public.ledger_entries;

  IF v_delta <> 0 THEN
    RAISE EXCEPTION
      'LEDGER UNBALANCED: debits exceed credits by % ngwee. A code path wrote a single-sided entry.',
      v_delta
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants
--
-- Money movement stays on the service role -- the production exposure found in
-- Aug 2026 was money RPCs reachable with the anon key, and CI smoke check 4
-- now fails the build if that recurs.
--
-- The read-only helpers are granted to `authenticated` deliberately: they
-- return aggregates the RLS policy above already permits, and the merchant
-- payable balance is something a merchant must be able to see (§6.2 -- the
-- debt is recorded AND VISIBLE to the merchant).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.post_ledger_pair(text, uuid, text, uuid, bigint, text, uuid, uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_ledger_pair(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledger_account_balance(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledger_is_balanced() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledger_master_invariant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_ledger_balanced() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zmw_to_ngwee(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.post_ledger_pair(text, uuid, text, uuid, bigint, text, uuid, uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_ledger_pair(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_account_balance(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_is_balanced() TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_master_invariant() TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_ledger_balanced() TO service_role;
GRANT EXECUTE ON FUNCTION public.zmw_to_ngwee(integer) TO service_role, authenticated;

GRANT SELECT ON public.ledger_entries TO authenticated;
GRANT SELECT ON public.ledger_balances TO authenticated;
