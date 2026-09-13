-- =============================================================================
-- Where wallet money came from, and money you have set aside
--
-- THE QUESTION THAT DECIDED THIS DESIGN
-- -------------------------------------
-- "Is there a distinction between saved money and residual money from an item
-- that was never available?" Half of one. `wallet_ledger` has no kind column;
-- `description` carries constants by convention -- WALLET_CREDIT,
-- CHECKOUT_CREDITS_APPLIED, WITHDRAWAL_REQUEST, EXPIRY_CREDIT,
-- FULFILLMENT_CREDIT, CHECKOUT_RELEASED, and REFUND_EXPIRY:<id> with an id
-- glued on -- and `increment_wallet_balance` defaults it to WALLET_CREDIT for
-- any caller that passes nothing. Recoverable; not enforced.
--
-- WHY THE COLUMN IS NOT BACKFILLED
-- --------------------------------
-- wallet_ledger carries enforce_immutable_ledger on BEFORE UPDATE OR DELETE,
-- and CI check 1 asserts that trigger is still attached. Rewriting history is
-- therefore not merely discouraged, it is refused -- correctly. So `kind` is
-- forward-only, and `wallet_ledger_kind()` classifies the rows written before
-- it existed from the description they already carry. Nothing is updated.
--
-- RESERVATION, NOT A SECOND LEDGER
-- --------------------------------
-- A goal does not move money. There is one wallet per user and its balance is
-- a cache of sum(wallet_ledger.amount) -- a second ledger would mean a second
-- thing that can disagree with it, which is the bug 20260809180000 was written
-- to fix after an incrementing trigger doubled somebody's balance.
--
-- Instead `kithly_wallets.reserved_zmw` is one number, and available balance is
-- balance minus reserved. Goals hold their own share and the wallet's figure is
-- RECOMPUTED from their sum, never incremented. That distinction is the whole
-- lesson of 20260809180000 and it is repeated here deliberately.
--
-- A BUDGET YOU CAN ACCIDENTALLY SPEND IS NOT A BUDGET
-- ---------------------------------------------------
-- Two guards, because one is not enough on an escrow platform:
--   * checkout consults available balance (20260913050000, next migration)
--   * a trigger refuses any wallet write that would take the balance below
--     what is reserved, whatever path it came from
-- The first is the graceful one. The second is the one that holds when a path
-- nobody thought of appears.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Provenance, forward-only
-- ---------------------------------------------------------------------------
ALTER TABLE public.wallet_ledger
  ADD COLUMN IF NOT EXISTS kind text;

COMMENT ON COLUMN public.wallet_ledger.kind IS
  'Why this money moved. Null on rows written before this column existed -- use wallet_ledger_kind() to classify those.';

ALTER TABLE public.wallet_ledger
  DROP CONSTRAINT IF EXISTS wallet_ledger_kind_check;
ALTER TABLE public.wallet_ledger
  ADD CONSTRAINT wallet_ledger_kind_check CHECK (
    kind IS NULL OR kind IN (
      'topup',       -- money the holder put in
      'residual',    -- came back: an item that was never available, or expired
      'refund',      -- came back: a reversal or correction
      'fulfilment',  -- earned by a merchant
      'spend',       -- applied at checkout
      'withdrawal',
      'release',     -- an abandoned checkout returning its hold
      'adjustment'   -- an admin correction, which should be rare and explained
    )
  );

/* Classifies a legacy row from the description it already carries.
   The order matters: REFUND_EXPIRY is a prefix with an id appended, so it is
   matched by prefix rather than equality. Anything unrecognised is left NULL
   rather than guessed -- an invented provenance is worse than an absent one. */
CREATE OR REPLACE FUNCTION public.wallet_ledger_kind(p_description text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_description IS NULL                              THEN NULL
    WHEN p_description LIKE 'REFUND_EXPIRY%'                THEN 'residual'
    WHEN p_description = 'EXPIRY_CREDIT'                    THEN 'residual'
    WHEN p_description = 'CHECKOUT_CREDITS_APPLIED'         THEN 'spend'
    WHEN p_description = 'CHECKOUT_RELEASED'                THEN 'release'
    WHEN p_description = 'WITHDRAWAL_REQUEST'               THEN 'withdrawal'
    WHEN p_description = 'WITHDRAWAL_REVERSED'              THEN 'refund'
    WHEN p_description = 'FULFILLMENT_CREDIT'               THEN 'fulfilment'
    WHEN p_description = 'WALLET_CREDIT'                    THEN 'topup'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.wallet_ledger_kind(text) IS
  'Best-effort provenance for ledger rows written before wallet_ledger.kind existed. Null when the description says nothing.';

/* One place every reader should use, so nobody reimplements the fallback. */
CREATE OR REPLACE VIEW public.wallet_ledger_classified
WITH (security_invoker = true) AS
SELECT
  wl.*,
  COALESCE(wl.kind, public.wallet_ledger_kind(wl.description)) AS resolved_kind
FROM public.wallet_ledger wl;

COMMENT ON VIEW public.wallet_ledger_classified IS
  'wallet_ledger with provenance resolved: the stored kind, or one inferred from the description for older rows.';

-- ---------------------------------------------------------------------------
-- 2. Reserved balance
-- ---------------------------------------------------------------------------
ALTER TABLE public.kithly_wallets
  ADD COLUMN IF NOT EXISTS reserved_zmw integer NOT NULL DEFAULT 0;

ALTER TABLE public.kithly_wallets
  DROP CONSTRAINT IF EXISTS kithly_wallets_reserved_check;
ALTER TABLE public.kithly_wallets
  ADD CONSTRAINT kithly_wallets_reserved_check CHECK (reserved_zmw >= 0);

COMMENT ON COLUMN public.kithly_wallets.reserved_zmw IS
  'Set aside in budget goals. Available balance is balance - reserved_zmw. Recomputed from budget_goals, never incremented.';

-- ---------------------------------------------------------------------------
-- 3. Goals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budget_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  name          text NOT NULL,
  target_zmw    integer NOT NULL,
  reserved_zmw  integer NOT NULL DEFAULT 0,

  /* All optional, and any combination is legitimate. A goal may be free
     standing ("school fees, January"), about a date, about a specific thing
     ("that fridge"), or about a shop. Three separate objects would have been
     the wrong answer to the same question. */
  occasion_id   uuid REFERENCES public.contact_occasions(id) ON DELETE SET NULL,
  item_id       uuid REFERENCES public.items(id) ON DELETE SET NULL,
  shop_id       uuid REFERENCES public.shops(id) ON DELETE SET NULL,
  due_on        date,

  status        text NOT NULL DEFAULT 'active',

  /* SEAM, NOT A FEATURE. Group purchasing is deliberately out of scope --
     see docs/adr/0002-group-purchasing-deferred.md. The column exists with a
     single permitted value so that admitting another later is a one-line
     migration rather than a table rewrite. Nothing reads it yet, and no UI
     offers it. It is documented rather than half-built on purpose: this
     codebase has already had to strip scaffolds that pretended to work. */
  visibility    text NOT NULL DEFAULT 'private',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_goals_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT budget_goals_target_check CHECK (target_zmw > 0),
  CONSTRAINT budget_goals_reserved_check CHECK (reserved_zmw >= 0),
  CONSTRAINT budget_goals_status_check CHECK (status IN ('active', 'met', 'spent', 'cancelled')),
  CONSTRAINT budget_goals_visibility_check CHECK (visibility IN ('private'))
);

COMMENT ON TABLE public.budget_goals IS
  'Money a shopper has set aside, and what for. reserved_zmw sums into kithly_wallets.reserved_zmw.';

CREATE INDEX IF NOT EXISTS budget_goals_user_idx ON public.budget_goals (user_id, status);

ALTER TABLE public.budget_goals ENABLE ROW LEVEL SECURITY;

/* Read and rename your own goals freely. Moving money in and out of them goes
   through the RPCs below, because reserved_zmw must stay in step with the
   wallet -- so the policy allows everything except a direct write to that
   column, which the trigger in section 4 refuses. */
DROP POLICY IF EXISTS budget_goals_owner_all ON public.budget_goals;
CREATE POLICY budget_goals_owner_all ON public.budget_goals
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.touch_budget_goal_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS budget_goals_touch ON public.budget_goals;
CREATE TRIGGER budget_goals_touch
  BEFORE UPDATE ON public.budget_goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_budget_goal_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Keeping the wallet's figure true
--
-- RECOMPUTED, NOT INCREMENTED. 20260809180000 exists because a trigger that
-- did `balance = balance + NEW.amount` ran twice for one row and doubled a
-- customer's balance, and checkout then trusted the cache. The same mistake is
-- available here and is refused the same way: sum the goals, assign the total.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_wallet_reserved()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_total integer;
BEGIN
  SELECT COALESCE(sum(reserved_zmw), 0) INTO v_total
  FROM public.budget_goals
  WHERE user_id = v_user AND status = 'active';

  UPDATE public.kithly_wallets
     SET reserved_zmw = v_total, updated_at = now()
   WHERE user_id = v_user;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS budget_goals_sync_reserved ON public.budget_goals;
CREATE TRIGGER budget_goals_sync_reserved
AFTER INSERT OR UPDATE OR DELETE ON public.budget_goals
FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_reserved();

/* The backstop. Checkout asks politely; this refuses regardless of the path.
   Any write that would leave the balance below what is reserved is rejected,
   including one from a code path that does not exist yet. */
CREATE OR REPLACE FUNCTION public.guard_wallet_reserved()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.balance < NEW.reserved_zmw THEN
    RAISE EXCEPTION
      'Wallet balance % is below the % reserved in budget goals; release a goal first',
      NEW.balance, NEW.reserved_zmw
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kithly_wallets_guard_reserved ON public.kithly_wallets;
CREATE TRIGGER kithly_wallets_guard_reserved
BEFORE UPDATE ON public.kithly_wallets
FOR EACH ROW EXECUTE FUNCTION public.guard_wallet_reserved();

-- ---------------------------------------------------------------------------
-- 5. Moving money in and out of a goal
--
-- These are the only supported way to change reserved_zmw. They move no value:
-- the wallet balance is untouched and no ledger row is written, because nothing
-- has been spent or received -- the money has only been labelled. That is why
-- they are reachable by `authenticated` where increment_wallet_balance is not:
-- they cannot create or destroy value, only partition what the caller already
-- has. CI check 4's list is about functions that move money; these do not.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_to_goal(p_goal_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user      uuid;
  v_status    text;
  v_balance   integer;
  v_reserved  integer;
  v_new       integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  SELECT user_id, status INTO v_user, v_status
  FROM public.budget_goals WHERE id = p_goal_id FOR UPDATE;

  IF v_user IS NULL THEN RAISE EXCEPTION 'no such goal'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    RAISE EXCEPTION 'not your goal';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'goal is %, not active', v_status;
  END IF;

  SELECT balance, reserved_zmw INTO v_balance, v_reserved
  FROM public.kithly_wallets WHERE user_id = v_user FOR UPDATE;

  IF v_balance IS NULL THEN RAISE EXCEPTION 'no wallet'; END IF;

  IF (v_balance - v_reserved) < p_amount THEN
    RAISE EXCEPTION 'only % available to set aside', (v_balance - v_reserved)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.budget_goals
     SET reserved_zmw = reserved_zmw + p_amount
   WHERE id = p_goal_id
  RETURNING reserved_zmw INTO v_new;

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_from_goal(p_goal_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_held integer;
  v_new  integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  SELECT user_id, reserved_zmw INTO v_user, v_held
  FROM public.budget_goals WHERE id = p_goal_id FOR UPDATE;

  IF v_user IS NULL THEN RAISE EXCEPTION 'no such goal'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    RAISE EXCEPTION 'not your goal';
  END IF;
  IF v_held < p_amount THEN
    RAISE EXCEPTION 'only % is set aside in this goal', v_held
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.budget_goals
     SET reserved_zmw = reserved_zmw - p_amount
   WHERE id = p_goal_id
  RETURNING reserved_zmw INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_to_goal(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_from_goal(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_to_goal(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_from_goal(uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. What a shopper can actually spend
--
-- One definition, so the client, checkout and any later caller agree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_available_zmw(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT GREATEST(COALESCE(balance, 0) - COALESCE(reserved_zmw, 0), 0)
  FROM public.kithly_wallets WHERE user_id = p_user_id;
$$;

COMMENT ON FUNCTION public.wallet_available_zmw(uuid) IS
  'Balance minus what is set aside in budget goals. The figure checkout may apply and the client should offer.';

REVOKE ALL ON FUNCTION public.wallet_available_zmw(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_available_zmw(uuid) TO authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'wallet provenance and budget goals ready';
END $$;
