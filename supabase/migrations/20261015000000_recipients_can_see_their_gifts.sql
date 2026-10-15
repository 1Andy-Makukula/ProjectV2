-- =============================================================================
-- A recipient can see the gift that was sent to them
--
-- THE BUG, found 13 Oct while auditing whether the P2P policies were dead
-- -----------------------------------------------------------------------
-- `shop_orders_select` and `transactions_select_buyer` each carry a recipient
-- branch that compares the order's `recipient_phone` against
-- `auth.jwt() ->> 'phone'`. That claim is **NULL for every account on this
-- platform**, so the branch has never matched anything.
--
-- Signup is email + password: `AuthContext.signUp` passes the number as
-- `options.data.phone`, so it lands in `auth.users.raw_user_meta_data` and
-- `handle_new_user` copies it to `public.users.phone`. Nothing ever writes
-- `auth.users.phone`, and that column is what Supabase puts in the JWT's
-- `phone` claim. No phone sign-in exists either.
--
-- This was already suspected on 2026-09-03 -- the audit remediation noted that
-- VULN-01's recommended fix relied on the same claim and would have failed for
-- every account -- but the P2P policies were left alone at the time because
-- loosening RLS has its own blast radius. This is that follow-up, done
-- deliberately rather than as a side effect.
--
-- WHAT IT ACTUALLY BROKE
-- ----------------------
-- Nothing is over-exposed: the branch fails CLOSED, and the buyer, merchant
-- and admin branches were unaffected throughout. What a recipient could not do
-- is see what was sent to them. `NotificationSlider` reads
-- `shop_orders` filtered by `.eq('recipient_phone', profile.phone)` to show
-- inbound gifts, and for a recipient who is not also the buyer that query has
-- been returning an empty list -- silently, because RLS answers a forbidden
-- row by omitting it rather than erroring. An empty inbox and a working inbox
-- with nothing in it look identical.
--
-- THE FIX, AND WHY IT IS SAFE NOW AND WAS NOT IN JUNE
-- ---------------------------------------------------
-- Compare against `public.current_user_phone()` -- the signed-in user's own
-- `public.users.phone` -- instead of the empty claim. That function already
-- exists; it was added by 20260903010000, which is also what makes this safe:
--
--   * `users.phone` is OWNER-IMMUTABLE. `users_update_own_no_role` pins it with
--     `phone IS NOT DISTINCT FROM public.current_user_phone()`, so a user
--     cannot edit their own number. Before that migration they could, and this
--     change would then have been a straightforward account-takeover: set your
--     phone to someone else's and read their gifts.
--   * `users_phone_unique` makes one MSISDN mean one account, so the match
--     cannot be satisfied by two different people.
--
-- That is the same foundation `convert_floating_item_to_credits` already
-- stands on to decide whose gift is whose, so this adds no new kind of trust --
-- it uses the one the money path already relies on.
--
-- Both fields are normalised by the same helper before storage
-- (`validateAndFormatPhone`: SignUp.tsx for the profile, useCheckout.ts for
-- the recipient), so they are directly comparable. Rows written before that
-- helper was applied may not match, and those simply stay invisible to the
-- recipient exactly as they are today -- the branch continues to fail closed.
--
-- The policies keep their names, their `TO authenticated`, their helper
-- functions and the order of their branches. `is_transaction_buyer` and
-- `is_transaction_recipient` exist to break an RLS recursion loop
-- (20260614100000) and are still used here for that reason; only the source of
-- the phone changes.
--
-- BLAST RADIUS: Critical global -- these two policies gate read access to
-- `shop_orders` and `transactions`. It WIDENS access, so it is the one kind of
-- change that cannot be judged by "nothing broke". What it widens, precisely:
-- a signed-in user may now read an order, and its parent transaction, whose
-- `recipient_phone` equals their own immutable, unique profile phone. Nothing
-- else changes; no branch is removed; no write path is touched.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. shop_orders -- the recipient leg reads the caller's own profile phone
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shop_orders_select ON public.shop_orders;
CREATE POLICY shop_orders_select ON public.shop_orders
  FOR SELECT TO authenticated
  USING (
    -- a) Use the secure function to check if buyer (breaks loop)
    public.is_transaction_buyer(transaction_id, auth.uid())

    -- b) Merchant who owns the shop
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = shop_orders.shop_id
        AND ms.user_id = auth.uid()
    )

    -- c) Recipient. Was `auth.jwt() ->> 'phone'`, which is NULL for every
    --    account; see the header. current_user_phone() is STABLE and
    --    SECURITY DEFINER, so this is one lookup per statement rather than a
    --    correlated subquery per row, and it reads a column the owner cannot
    --    edit. A NULL on either side yields NULL, which USING treats as false,
    --    so a user with no phone recorded matches nothing.
    OR (
      recipient_phone IS NOT NULL
      AND recipient_phone = public.current_user_phone()
    )

    -- e) Admin
    OR public.current_user_role() = 'admin'
  );


-- ---------------------------------------------------------------------------
-- 2. transactions -- the same substitution, through the same helper
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS transactions_select_buyer ON public.transactions;
CREATE POLICY transactions_select_buyer ON public.transactions
  FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    -- Use the secure function to check recipient (breaks loop). It already
    -- takes the phone as an argument, so only the argument changes.
    OR public.is_transaction_recipient(transaction_id, public.current_user_phone())
    OR public.current_user_role() = 'admin'
  );


-- ---------------------------------------------------------------------------
-- 3. Prove the shape, since a policy that silently matches nothing is exactly
--    the failure being repaired here
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_qual text;
BEGIN
  SELECT qual INTO v_qual FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'shop_orders'
    AND policyname = 'shop_orders_select';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'shop_orders_select is missing';
  END IF;
  IF v_qual LIKE '%jwt%phone%' THEN
    RAISE EXCEPTION 'shop_orders_select still reads the phone JWT claim';
  END IF;
  IF v_qual NOT LIKE '%current_user_phone%' THEN
    RAISE EXCEPTION 'shop_orders_select does not read current_user_phone()';
  END IF;

  SELECT qual INTO v_qual FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'transactions'
    AND policyname = 'transactions_select_buyer';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'transactions_select_buyer is missing';
  END IF;
  IF v_qual LIKE '%jwt%phone%' THEN
    RAISE EXCEPTION 'transactions_select_buyer still reads the phone JWT claim';
  END IF;
  IF v_qual NOT LIKE '%current_user_phone%' THEN
    RAISE EXCEPTION 'transactions_select_buyer does not read current_user_phone()';
  END IF;

  RAISE NOTICE 'recipient legs now read the caller''s own profile phone';
END $$;
