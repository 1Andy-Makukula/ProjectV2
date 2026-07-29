-- =============================================================================
-- Payout bank/network code verification
--
-- batch-payout-sweeper hardcoded three-letter codes (ATL, MTN, ZMT) for
-- mobile money and, for bank transfers, passed the literal payout_method
-- string ("bank") straight into Flutterwave's account_bank field. None of
-- these were ever confirmed against Flutterwave's real API or documentation:
-- Flutterwave's own GET /v3/banks/:country endpoint documents NG, GH, KE, UG,
-- ZA and TZ as supported countries and does not list Zambia, so the normal
-- "look up the real code" path does not exist for ZM, and no verbatim Zambia
-- transfer example could be found in Flutterwave's reachable documentation.
-- A wrong routing code does not fail loudly -- it risks silently misrouting a
-- real transfer, which is worse than a payout that visibly does not go out.
--
-- This does not guess a replacement code. It adds a reference table that
-- starts every payout destination -- mobile money included -- as unverified,
-- and changes the sweeper (in the same commit) to refuse to dispatch a
-- transfer against an unverified row rather than gamble on an unconfirmed
-- code. A human with real Flutterwave API access (dashboard, a sandbox
-- transfer, or Flutterwave support) confirms the true code and flips
-- is_verified once known -- nothing in this migration can do that itself.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payout_bank_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method_key        text NOT NULL UNIQUE,
  display_name      text NOT NULL,
  category          text NOT NULL,
  flutterwave_code  text,
  is_verified       boolean NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payout_bank_codes_category_check
    CHECK (category IN ('mobile_money', 'bank'))
);

COMMENT ON TABLE public.payout_bank_codes IS
  'Reference list of payout destinations. is_verified must be manually flipped to true, with a confirmed flutterwave_code, before the sweeper will use a row to dispatch a transfer.';
COMMENT ON COLUMN public.payout_bank_codes.method_key IS
  'Matches shops.payout_method for mobile money (airtel/mtn/zamtel), or shops.payout_bank_name for category = bank.';

ALTER TABLE public.payout_bank_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_bank_codes_read ON public.payout_bank_codes;
CREATE POLICY payout_bank_codes_read ON public.payout_bank_codes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS payout_bank_codes_admin_write ON public.payout_bank_codes;
CREATE POLICY payout_bank_codes_admin_write ON public.payout_bank_codes
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Every row starts unverified. The mobile money notes explain why codes that
-- were already sitting in the sweeper's source code are not treated as
-- pre-verified just because they were written down first.
INSERT INTO public.payout_bank_codes (method_key, display_name, category, flutterwave_code, is_verified, notes)
VALUES
  ('airtel', 'Airtel Money', 'mobile_money', 'ATL', false,
   'Carried over from the pre-existing sweeper code, not from a confirmed Flutterwave source. Flutterwave''s public bank-list endpoint documents NG/GH/KE/UG/ZA/TZ only -- not ZM -- so this could not be looked up. Confirm with a real transfer, the Flutterwave dashboard, or Flutterwave support before trusting.'),
  ('mtn', 'MTN Money', 'mobile_money', 'MTN', false,
   'Same caveat as airtel. Plausible in form (Flutterwave uses short mnemonic codes elsewhere, e.g. "MPS" for Kenyan M-Pesa) but unverified for Zambia specifically.'),
  ('zamtel', 'Zamtel Money', 'mobile_money', 'ZMT', false,
   'Same caveat as airtel/mtn. Note: the shop payout form never actually offered "Zamtel" as a choice even though the sweeper already special-cased it -- added to the form alongside this migration.'),
  ('zanaco', 'Zanaco (Zambia National Commercial Bank)', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('stanbic_zm', 'Stanbic Bank Zambia', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('standard_chartered_zm', 'Standard Chartered Bank Zambia', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('absa_zm', 'Absa Bank Zambia', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('fnb_zm', 'First National Bank Zambia', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('access_zm', 'Access Bank Zambia', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('indo_zambia', 'Indo Zambia Bank', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('ecobank_zm', 'Ecobank Zambia', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('citibank_zm', 'Citibank Zambia', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.'),
  ('uba_zm', 'United Bank for Africa Zambia', 'bank', NULL, false, 'Bank name only -- no Flutterwave routing code confirmed.')
ON CONFLICT (method_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Shop payout profile additions.
--
-- Bank transfers previously had no way to identify which bank at all --
-- payout_details was one free-text box regardless of method, so "bank" was
-- passed to Flutterwave as if it were itself a routing code. payout_bank_name
-- gives bank transfers a specific, selectable bank; payout_account_name is
-- carried through to the transfer so a human (and, per the notes above, the
-- shop owner reviewing their own settings) has something to sanity-check a
-- typo'd account number against.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS payout_bank_name text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS payout_account_name text;

COMMENT ON COLUMN public.shops.payout_bank_name IS
  'References payout_bank_codes.method_key. Only meaningful when payout_method = ''bank''.';
COMMENT ON COLUMN public.shops.payout_account_name IS
  'Name on the mobile money or bank account, carried through to the transfer as a sanity check against typo''d account numbers.';

-- ---------------------------------------------------------------------------
-- claim_withdrawal_batch: now resolves and returns the verification state
-- alongside the raw payout details, so the sweeper can refuse to dispatch
-- against anything unverified instead of guessing. Changing the returned
-- column list requires a drop -- CREATE OR REPLACE cannot alter a table
-- function's output columns in place.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_withdrawal_batch(integer);

CREATE FUNCTION public.claim_withdrawal_batch(p_limit integer DEFAULT 25)
RETURNS TABLE (
  withdrawal_id       uuid,
  shop_id             uuid,
  shop_name           text,
  amount              integer,
  payout_method       text,
  payout_details      text,
  payout_account_name text,
  bank_category       text,
  flutterwave_code    text,
  is_verified         boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT mw.id
    FROM public.merchant_withdrawals mw
    WHERE mw.status = 'pending'
    ORDER BY mw.created_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  ),
  moved AS (
    UPDATE public.merchant_withdrawals mw
    SET status = 'processing', updated_at = now()
    FROM claimed c
    WHERE mw.id = c.id
    RETURNING mw.id, mw.shop_id, mw.amount
  )
  SELECT
    m.id,
    m.shop_id,
    s.name,
    m.amount,
    s.payout_method,
    s.payout_details::text,
    s.payout_account_name,
    pbc.category,
    pbc.flutterwave_code,
    COALESCE(pbc.is_verified, false)
  FROM moved m
  JOIN public.shops s ON s.id = m.shop_id
  LEFT JOIN public.payout_bank_codes pbc
    ON pbc.method_key = CASE WHEN s.payout_method = 'bank' THEN s.payout_bank_name ELSE s.payout_method END;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_withdrawal_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_withdrawal_batch(integer) TO service_role;
