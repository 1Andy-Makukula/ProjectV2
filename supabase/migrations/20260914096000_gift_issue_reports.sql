-- =============================================================================
-- A way for the recipient to say something went wrong
--
-- THE GAP
-- -------
-- The recipient has no account. That is the right design -- requiring a
-- grandmother in a compound to sign up before collecting a gift would lose
-- more gifts than it protects -- but it left her with no channel at all.
--
-- When the shop says the code is already used, or hands over half of what was
-- paid for, or refuses to serve her, her only recourse today is to telephone
-- her daughter in Manchester, who then opens a dispute from 8,000 km away
-- about an event she did not witness. Every piece of dispute machinery in this
-- schema -- twelve migrations of it, plus the settlement window -- is
-- sender-side. The person actually standing at the counter watching it go
-- wrong cannot reach us.
--
-- This is the smallest thing that closes that: the recipient is already on the
-- gift page holding the claim code, so give her a button.
--
-- WHY ANON MAY CALL THIS
-- ----------------------
-- Because the recipient is anonymous by design. The claim code is the
-- credential: `report_gift_issue` resolves it exactly the way
-- get_shop_order_by_claim_code already does for the same anonymous visitor, so
-- this exposes no existence oracle that the gift page did not already expose.
--
-- Abuse is bounded three ways rather than by authentication:
--   1. A valid claim code is required. Without one there is nothing to report
--      against, and guessing codes is now metered by 20260914093000.
--   2. At most 5 open reports per claim code. A gift has one recipient and one
--      problem; a sixth report is someone playing.
--   3. Text is truncated server-side, so the table cannot be used as storage.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- --------------------------------
-- It moves no money, changes no claim_status, and does not pause settlement.
-- A report is a message, not a chargeback -- letting an anonymous caller
-- freeze a merchant's payout by typing into a form would be a far worse hole
-- than the one being closed. An admin acts on it through the existing refund
-- and dispute paths.
--
-- BLAST RADIUS 🟢
-- ---------------
-- Additive: one table, one function. Nothing existing is redefined. The
-- notification to the buyer reuses create_notification, which is the same
-- helper fulfil and expiry already use.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gift_issue_reports (
  report_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_order_id  UUID NOT NULL REFERENCES public.shop_orders(shop_order_id) ON DELETE CASCADE,
  transaction_id UUID,
  shop_id        UUID REFERENCES public.shops(id) ON DELETE SET NULL,
  issue_type     TEXT NOT NULL CHECK (issue_type IN (
                   'code_rejected',      -- "the shop says it is already used"
                   'items_missing',      -- handed over less than was paid for
                   'shop_refused',       -- would not serve me
                   'shop_closed',        -- not trading / cannot find it
                   'wrong_items',        -- not what was ordered
                   'other')),
  description    TEXT,
  contact_phone  TEXT,
  status         TEXT NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolution_note TEXT
);

COMMENT ON TABLE public.gift_issue_reports IS
  'Problems reported by the gift RECIPIENT, who has no account. Raised from '
  'the public gift page with the claim code as the credential. Informational: '
  'creates no financial effect on its own.';

CREATE INDEX IF NOT EXISTS gift_issue_reports_open_idx
  ON public.gift_issue_reports (created_at DESC)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS gift_issue_reports_order_idx
  ON public.gift_issue_reports (shop_order_id);

ALTER TABLE public.gift_issue_reports ENABLE ROW LEVEL SECURITY;

-- Admins triage. The recipient cannot read the table back -- she is anonymous,
-- so there is no "her" to scope a row to, and a readable table keyed on a
-- guessable-ish code would leak other people's complaints.
DROP POLICY IF EXISTS gift_issue_reports_admin ON public.gift_issue_reports;
CREATE POLICY gift_issue_reports_admin ON public.gift_issue_reports
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- The buyer may read reports against their own orders: they paid, and they are
-- the one who will be chasing it.
--
-- Matched on `transactions`, not `shop_orders`, for two reasons.
--
-- First, correctness: `shop_orders` has no buyer_id. One transaction can span
-- several shops -- that is what the MULT- code is for -- so the buyer is a
-- property of the payment, not of the per-shop order. An earlier version read
-- `so.buyer_id` and failed on `supabase db push` with "column so.buyer_id does
-- not exist".
--
-- Second, reach: a policy expression is evaluated with the querying user's own
-- privileges and under the RLS of every table it touches. Joining through
-- shop_orders would make a buyer's access to their own complaint depend on
-- their RLS on a second table as well. `transaction_id` is already denormalised
-- onto the row above, so one table answers the question.
DROP POLICY IF EXISTS gift_issue_reports_buyer_read ON public.gift_issue_reports;
CREATE POLICY gift_issue_reports_buyer_read ON public.gift_issue_reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.transaction_id = gift_issue_reports.transaction_id
        AND t.buyer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- report_gift_issue
--
-- SECURITY DEFINER because the caller is anonymous and must not be given
-- direct INSERT on the table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_gift_issue(
  p_claim_code    TEXT,
  p_issue_type    TEXT,
  p_description   TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code       TEXT := upper(btrim(COALESCE(p_claim_code, '')));
  v_order      RECORD;
  v_open       INTEGER;
  v_report_id  UUID;
  v_shop_name  TEXT;
BEGIN
  IF v_code = '' THEN
    RAISE EXCEPTION 'A gift code is required';
  END IF;

  IF p_issue_type IS NULL OR p_issue_type NOT IN (
    'code_rejected', 'items_missing', 'shop_refused', 'shop_closed', 'wrong_items', 'other'
  ) THEN
    RAISE EXCEPTION 'Unknown issue type';
  END IF;

  -- buyer_id comes from `transactions`; `shop_orders` does not carry one.
  -- LEFT JOIN rather than JOIN so a shop order whose transaction row is
  -- missing still produces a report -- the complaint matters more than the
  -- notification, and create_notification already no-ops on a NULL user.
  SELECT so.shop_order_id, so.transaction_id, so.shop_id, t.buyer_id
  INTO v_order
  FROM public.shop_orders so
  LEFT JOIN public.transactions t ON t.transaction_id = so.transaction_id
  WHERE so.claim_code = v_code;

  -- Same disclosure the public gift page already makes for this code.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'We could not find a gift with that code';
  END IF;

  SELECT count(*) INTO v_open
  FROM public.gift_issue_reports
  WHERE shop_order_id = v_order.shop_order_id
    AND status IN ('OPEN', 'IN_REVIEW');

  IF v_open >= 5 THEN
    RAISE EXCEPTION 'We have already received reports about this gift and are looking into it';
  END IF;

  INSERT INTO public.gift_issue_reports
    (shop_order_id, transaction_id, shop_id, issue_type, description, contact_phone)
  VALUES (
    v_order.shop_order_id,
    v_order.transaction_id,
    v_order.shop_id,
    p_issue_type,
    left(btrim(COALESCE(p_description, '')), 1000),
    left(btrim(COALESCE(p_contact_phone, '')), 32)
  )
  RETURNING report_id INTO v_report_id;

  -- Tell the buyer. They are the one who paid, the one the recipient would
  -- otherwise have telephoned, and the only party with an account.
  SELECT name INTO v_shop_name FROM public.shops WHERE id = v_order.shop_id;

  PERFORM public.create_notification(
    v_order.buyer_id,
    'Your recipient reported a problem collecting their gift from '
      || COALESCE(v_shop_name, 'the shop')
      || '. KithLy support has been notified and will follow up.',
    'warning',
    v_order.shop_order_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'report_id', v_report_id,
    'message', 'Thank you. We have recorded this and someone will look into it.'
  );
END;
$$;

COMMENT ON FUNCTION public.report_gift_issue(TEXT, TEXT, TEXT, TEXT) IS
  'Lets the anonymous gift recipient report a problem at the counter, using '
  'the claim code as the credential. Records and notifies only -- no financial '
  'effect.';

REVOKE ALL ON FUNCTION public.report_gift_issue(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

DO $$
DECLARE
  v_role TEXT;
BEGIN
  -- anon deliberately included: the recipient has no account. This is the
  -- same audience get_shop_order_by_claim_code already serves.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.report_gift_issue(TEXT, TEXT, TEXT, TEXT) TO %I', v_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.gift_issue_reports TO authenticated';
    EXECUTE 'GRANT INSERT, UPDATE ON TABLE public.gift_issue_reports TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.gift_issue_reports TO service_role';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Assert the contract: a bad code is refused, a bad type is refused, anon can
-- reach the function, and the table is not anon-readable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_failed BOOLEAN;
BEGIN
  v_failed := FALSE;
  BEGIN
    PERFORM public.report_gift_issue('NOSUCHCODE', 'other', 'test', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'report_gift_issue accepted an unknown claim code';
  END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM public.report_gift_issue('ANY', 'not_a_real_type', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'report_gift_issue accepted an unknown issue type';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    IF NOT has_function_privilege('anon', 'public.report_gift_issue(text,text,text,text)'::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon cannot call report_gift_issue -- the recipient has no account, so this is the only audience that matters';
    END IF;
    IF has_table_privilege('anon', 'public.gift_issue_reports', 'SELECT') THEN
      RAISE EXCEPTION 'gift_issue_reports is readable by anon -- other people''s complaints would be exposed';
    END IF;
  END IF;

  RAISE NOTICE 'report_gift_issue: anonymous recipients can report, cannot read, and cannot invent codes or types.';
END;
$$;
