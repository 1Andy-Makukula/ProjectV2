-- =============================================================================
-- users.phone becomes an identity claim, not a free-text profile field
--
-- ---------------------------------------------------------------------------
-- 1. WHY (the theft path)
-- ---------------------------------------------------------------------------
-- convert_floating_item_to_credits turns an unfulfilled order item into
-- spendable wallet credit. 20260809040000 bound it to the session, so the
-- caller must be the user they claim to be. Its remaining authorisation -- the
-- part that decides WHOSE gift this is -- is a phone-number match:
--
--   SELECT phone INTO v_user_phone FROM public.users WHERE id = p_user_id;
--   IF COALESCE(v_user_phone,'') <> COALESCE(v_recipient_phone,'') THEN ...
--
-- public.users.phone was freely writable by its owner. users_update_own_no_role
-- pinned `role` and nothing else, and no OTP or telecom check has ever stood
-- behind a profile phone edit. So the full exploit was:
--
--   1. Sign up as anyone.
--   2. UPDATE users SET phone = '<victim's number>' WHERE id = auth.uid().
--   3. Call convert_floating_item_to_credits on the victim's FLOATING item.
--   4. The credits land in the ATTACKER's wallet, because step 3 credits
--      p_user_id -- which is now the attacker, and now passes the phone check.
--
-- No SIM, no handset, no code. Escrowed funds, direct to the attacker.
--
-- ---------------------------------------------------------------------------
-- 2. WHY NOT auth.jwt() ->> 'phone'
-- ---------------------------------------------------------------------------
-- The obvious fix -- compare against the phone Supabase Auth itself verified,
-- as the P2P policies in 20260614000000 do -- does not work here, and would
-- break the feature outright.
--
-- Signup is email + password (SignUp.tsx). The phone is collected as a form
-- field, carried in raw_user_meta_data, and written to public.users by
-- handle_new_user. auth.users.phone is never populated and no OTP is ever sent,
-- so `auth.jwt() ->> 'phone'` is NULL for every account on the platform.
-- Switching the check to it would make every legitimate conversion fail with a
-- phone mismatch. (It also means those P2P policies are, as written, matching
-- NULL and therefore already dead -- noted here, not changed here, because
-- loosening them is a separate decision with its own blast radius.)
--
-- ---------------------------------------------------------------------------
-- 3. WHAT THIS DOES INSTEAD
-- ---------------------------------------------------------------------------
-- Removes the mutability that the exploit turns on. `phone` joins `role` as a
-- column its owner cannot change: the signup trigger still sets it, admins can
-- still correct it, and the client UPDATE path can no longer touch it.
--
-- This is containment, not the end state. The end state is a verified phone --
-- supabase.auth.updateUser({ phone }) + verifyOtp, synced into public.users --
-- which needs a paid SMS/WhatsApp channel and a UI flow, and is specified in
-- docs/phone-verification-design.md rather than guessed at here.
--
-- Until then the honest position is: the number was entered at signup and never
-- verified, so nobody -- including its owner -- may quietly change what a money
-- path depends on.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The current caller's phone, read without RLS.
--
-- Mirrors current_user_role(). A bare subquery over public.users inside a
-- policy ON public.users invites the recursion this codebase has already been
-- bitten by; a SECURITY DEFINER helper reads the row once and settles it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_phone()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT phone FROM public.users WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_phone() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_phone() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pin `phone` the same way `role` is pinned.
--
-- IS NOT DISTINCT FROM, not `=`: a NULL phone must compare equal to itself, or
-- every user whose phone is NULL is locked out of editing their own name.
--
-- users_admin_all is a separate permissive policy and is untouched, so support
-- can still correct a number. The signup trigger is SECURITY DEFINER and runs
-- as the table owner, so it bypasses this and continues to set the initial
-- value.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_update_own_no_role ON public.users;
CREATE POLICY users_update_own_no_role ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role  = public.current_user_role()
    AND phone IS NOT DISTINCT FROM public.current_user_phone()
  );

-- =============================================================================
-- 4. One account per number
--
-- The same mutability broke the USSD point of sale, by a different route.
-- ussd-gateway has no JWT -- the aggregator does not send one -- so it resolves
-- the merchant from the caller's MSISDN:
--
--   .from("users").select("id").eq("phone", normalisedPhone).maybeSingle()
--
-- With no UNIQUE constraint, any app user could set their phone to a merchant's
-- number. maybeSingle() then sees two rows, returns PGRST116, and the merchant's
-- handset is told "END Unregistered Merchant Device" -- a remote, targeted,
-- zero-cost denial of service against a live till, triggered by editing a
-- profile field.
--
-- Partial, because NULL and '' are legitimate: not every account has a number,
-- and several accounts may have none.
-- =============================================================================

-- Refuse to proceed on dirty data rather than silently failing on the index.
--
-- A bare CREATE UNIQUE INDEX against existing duplicates fails with Postgres's
-- own message, which names one conflicting value and nothing about which
-- accounts are involved. This says exactly what has to be fixed, and -- because
-- duplicate phones are the precondition for both the theft path above and the
-- USSD outage -- finding any here is a finding, not just a migration blocker.
DO $$
DECLARE
  v_dupes INTEGER;
  v_detail TEXT;
BEGIN
  SELECT count(*), string_agg(sample, '; ')
  INTO v_dupes, v_detail
  FROM (
    SELECT
      -- Masked: this text lands in migration logs.
      repeat('*', greatest(length(btrim(phone)) - 3, 0)) || right(btrim(phone), 3)
        || ' -> user_ids ' || string_agg(id::text, ', ') AS sample
    FROM public.users
    WHERE phone IS NOT NULL AND btrim(phone) <> ''
    GROUP BY btrim(phone)
    HAVING count(*) > 1
  ) d;

  IF COALESCE(v_dupes, 0) > 0 THEN
    RAISE EXCEPTION
      'Cannot make users.phone unique: % number(s) are shared across accounts. Resolve them first, then re-run. Offenders: %',
      v_dupes, v_detail;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
  ON public.users (btrim(phone))
  WHERE phone IS NOT NULL AND btrim(phone) <> '';

COMMENT ON INDEX public.users_phone_unique IS
  'One account per MSISDN. ussd-gateway resolves a merchant by phone alone and '
  'cannot tolerate a second row; convert_floating_item_to_credits authorises on '
  'a phone match and must not be satisfiable by two different people.';

-- ---------------------------------------------------------------------------
-- Verify, or fail the migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_check TEXT;
BEGIN
  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO v_check
  FROM pg_policy pol
  WHERE pol.polrelid = 'public.users'::regclass
    AND pol.polname = 'users_update_own_no_role';

  IF v_check IS NULL OR v_check NOT LIKE '%current_user_phone%' THEN
    RAISE EXCEPTION 'users_update_own_no_role does not pin the phone column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'users_phone_unique'
  ) THEN
    RAISE EXCEPTION 'users_phone_unique was not created';
  END IF;

  RAISE NOTICE 'users.phone is now owner-immutable and unique across accounts';
END $$;
