-- =============================================================================
-- Phase 6b — One code for an order that spans several shops
--
-- Buying a list produces one transaction with a shop_orders row per business,
-- each with its own claim_code. The buyer would otherwise have to carry four
-- codes for one purchase and know which belongs to which shop.
--
-- ---------------------------------------------------------------------------
-- Why this does not touch checkout
-- ---------------------------------------------------------------------------
-- The obvious place to mint the code is checkout_init_atomic, but that is the
-- money path and it does not need reopening for a display concern. The code is
-- allocated lazily instead: the first time the buyer views their order and the
-- QR is rendered, the client asks for one. Idempotent, so repeat views and
-- concurrent tabs converge on the same code.
--
-- ---------------------------------------------------------------------------
-- Redemption is unchanged
-- ---------------------------------------------------------------------------
-- Per-shop claim codes remain exactly as they are and stay individually
-- redeemable — handing one shop's code to a friend still works. The public code
-- is only an extra way in: the fulfil Edge Function resolves it down to the
-- scanning merchant's own shop_order and then calls atomic_fulfill_voucher with
-- that order's existing claim_code. The financial RPC is not modified.
--
-- Format is NNNN-NNNNNN, which the function's existing claim_code validation
-- already accepts as its namespace form.
-- =============================================================================

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS public_code text;

COMMENT ON COLUMN public.transactions.public_code IS
  'One buyer-facing code for the whole order. Each merchant scanning it redeems only their own shop_order. Allocated on demand, never at checkout.';

CREATE UNIQUE INDEX IF NOT EXISTS transactions_public_code_idx
  ON public.transactions (public_code)
  WHERE public_code IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_public_code_check') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_public_code_check
      CHECK (public_code IS NULL OR public_code ~ '^MULT-[A-Z0-9]{6}$');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ensure_transaction_code
--
-- Returns the order's public code, allocating one on first use.
--
-- The row is locked before the check so two tabs opening the order at once
-- cannot each mint a code and have one overwrite the other.
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
    v_code := 'MULT-' || public.gen_claim_code(6);
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
GRANT EXECUTE ON FUNCTION public.ensure_transaction_code(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- resolve_claim_code_for_shop
--
-- Given either a per-shop claim code or a whole-order public code, returns the
-- claim code this shop should actually redeem. Called by the fulfil Edge
-- Function before it hands over to atomic_fulfill_voucher, so that function
-- keeps seeing nothing but ordinary per-shop codes.
--
-- Returns NULL when the order has nothing for this shop, which the caller
-- reports as an unknown code rather than leaking that the order exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_claim_code_for_shop(
  p_code    text,
  p_shop_id uuid
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT so.claim_code
  FROM public.shop_orders so
  WHERE so.shop_id = p_shop_id
    AND (
      so.claim_code = upper(btrim(p_code))
      OR so.transaction_id = (
        SELECT t.transaction_id
        FROM public.transactions t
        WHERE t.public_code = upper(btrim(p_code))
      )
    )
  ORDER BY so.created_at
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_claim_code_for_shop(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_claim_code_for_shop(text, uuid) TO service_role;
