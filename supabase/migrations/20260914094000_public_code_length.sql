-- =============================================================================
-- Whole-order public codes: 8 symbols, not 6
--
-- `MULT-` plus six symbols from a 36-symbol alphabet is about 2.2 billion
-- combinations. That sounds large and is not, for a string that resolves
-- straight to a redeemable order: a script running through a merchant account
-- covers a meaningful slice of that space, and until 20260914093000 nothing
-- counted the failures. Eight symbols is 2.8 trillion -- the same strength as
-- the per-shop claim code, which is the right target, because both are bearer
-- instruments that a shop will honour.
--
-- Paired with the rate limiter rather than instead of it. Length raises the
-- cost of guessing; the limiter makes guessing observable and slow. Neither is
-- sufficient alone.
--
-- MIGRATING A LIVE CONSTRAINT
-- ---------------------------
-- transactions_public_code_check is '^MULT-[A-Z0-9]{6}$'. Codes already issued
-- are six symbols and are printed on receipts, sitting in customers' WhatsApp
-- threads, and readable from order pages. Tightening the constraint to {8}
-- would make every existing row fail validation on its next UPDATE -- and
-- confirm_payment_atomic updates transactions.
--
-- So the constraint accepts either length and new codes are minted at eight.
-- Existing codes keep working and age out with their orders. This is a widened
-- constraint, which cannot fail against existing data.
--
-- BLAST RADIUS 🟡
-- ---------------
-- ensure_transaction_code is the only minter (verified: it is the sole caller
-- of gen_claim_code with the 'MULT-' prefix). resolve_claim_code_for_shop
-- matches on equality and is length-agnostic. The UI renders whatever it is
-- given. gen_claim_code(8) already returns 8 uppercase alphanumerics, proven
-- by 20260914090000's own assertions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen the constraint to accept 6 (legacy) or 8 (new).
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_public_code_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_public_code_check
  CHECK (public_code IS NULL OR public_code ~ '^MULT-([A-Z0-9]{6}|[A-Z0-9]{8})$');

COMMENT ON COLUMN public.transactions.public_code IS
  'Whole-order code shown to the buyer. Minted at 8 symbols since '
  '20260914094000; 6-symbol codes issued before then remain valid until their '
  'orders close.';

-- ---------------------------------------------------------------------------
-- 2. Mint at 8.
--
-- Body extracted verbatim from its live definition in
-- 20260807060000_transaction_public_code.sql (lines 55-103) and patched by
-- exact string replacement at a single unique anchor. The complete diff is one
-- line:
--
--     <     v_code := 'MULT-' || public.gen_claim_code(6);
--     >     v_code := 'MULT-' || public.gen_claim_code(8);
--
-- CREATE OR REPLACE, not DROP + CREATE: the signature is unchanged and the
-- grants to authenticated and service_role must survive.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_transaction_code(p_transaction_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_buyer_id uuid;
  v_code text;
  v_attempt integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT buyer_id, public_code INTO v_buyer_id, v_code
  FROM public.transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_buyer_id <> v_uid AND public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only the buyer may see this order code';
  END IF;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  LOOP
    v_code := 'MULT-' || public.gen_claim_code(8);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.transactions WHERE public_code = v_code
    );

    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Could not allocate an order code';
    END IF;
  END LOOP;

  UPDATE public.transactions
  SET public_code = v_code
  WHERE transaction_id = p_transaction_id;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_transaction_code(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ensure_transaction_code(uuid) TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ensure_transaction_code(uuid) TO service_role';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Assert both halves: the minter emits 8, and the constraint still accepts the
-- 6-symbol codes already in customers' hands.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_src   TEXT;
  v_new   TEXT;
  v_legacy TEXT;
BEGIN
  SELECT pg_get_functiondef('public.ensure_transaction_code(uuid)'::regprocedure) INTO v_src;

  IF v_src LIKE '%gen_claim_code(6)%' THEN
    RAISE EXCEPTION 'ensure_transaction_code still mints 6-symbol codes';
  END IF;
  IF v_src NOT LIKE '%gen_claim_code(8)%' THEN
    RAISE EXCEPTION 'ensure_transaction_code is not minting 8-symbol codes -- a later definition may have replaced this one';
  END IF;

  v_new    := 'MULT-' || public.gen_claim_code(8);
  v_legacy := 'MULT-' || public.gen_claim_code(6);

  IF v_new !~ '^MULT-([A-Z0-9]{6}|[A-Z0-9]{8})$' THEN
    RAISE EXCEPTION 'Newly minted code % fails the widened constraint', v_new;
  END IF;
  IF v_legacy !~ '^MULT-([A-Z0-9]{6}|[A-Z0-9]{8})$' THEN
    RAISE EXCEPTION 'Legacy 6-symbol code % would now be rejected -- existing orders would break', v_legacy;
  END IF;
  IF 'MULT-ABC12' ~ '^MULT-([A-Z0-9]{6}|[A-Z0-9]{8})$' THEN
    RAISE EXCEPTION 'Constraint accepts a 5-symbol code; it is not actually constraining length';
  END IF;

  RAISE NOTICE 'public_code: minting at 8, constraint still accepts legacy 6 (% / %).', v_new, v_legacy;
END;
$$;
