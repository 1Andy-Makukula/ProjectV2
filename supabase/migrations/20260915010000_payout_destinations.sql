-- =============================================================================
-- Merchant payout destinations, and the verification that gates redemption
--
-- WHY THIS IS A TABLE AND NOT TWO COLUMNS ON `shops`
-- --------------------------------------------------
-- `shops` already carries `payout_method` and `payout_details` as free text.
-- Those columns record where money goes but not whether that destination was
-- ever proven to exist, and they are overwritten in place -- so after a
-- merchant changes their number there is no record of where the previous six
-- months of money actually went. For a financial platform that is not a
-- nice-to-have; it is the first thing anyone investigating a misdirected
-- payout asks for.
--
-- Destinations here are rows, not fields. Changing a destination deactivates
-- the old row and inserts a new one. The history survives, and every payout
-- instruction (20260915030000) snapshots the destination id it paid, so
-- "where did this money go" is answerable years later.
--
-- WHY VERIFICATION BLOCKS REDEMPTION RATHER THAN PAYOUT
-- -----------------------------------------------------
-- §6.1: prevent, don't recover. A redemption is the moment goods leave the
-- counter. If the payout fails afterwards the merchant has given away stock
-- against a promise KithLy cannot keep, and there is no mechanism to get the
-- goods back. Discovering a bad number at payout time is discovering it too
-- late.
--
-- So `shop_can_accept_redemptions` is checked BEFORE the scan succeeds, not
-- after. A merchant with an unverified destination is told to fix it while the
-- customer is still standing there -- which is annoying, and is the correct
-- trade against handing over goods for nothing.
--
-- WHY AIRTEL IS THE DEFAULT
-- -------------------------
-- Settlement in seconds versus one to three days, and §4 wants the merchant
-- leg of custody measured in seconds. Bank remains available because some
-- merchants will insist; it is offered as the slower choice, with the speed
-- difference shown at the point of choice rather than buried.
--
-- BLAST RADIUS: additive. `shops.payout_method` / `payout_details` are left
-- untouched and still read by the legacy withdrawal path until
-- 20260915070000 retires it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The destinations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_payout_destinations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,

  rail                 text NOT NULL,

  -- Airtel: the MSISDN in E.164. Bank: the account number. One column because
  -- both are "the string the rail routes on", and splitting them produces two
  -- always-half-null columns.
  account_identifier   text NOT NULL,

  -- What the merchant SAYS the account is called. `verified_account_name` is
  -- what the rail says it is called. The two being different is the entire
  -- point of a name lookup.
  account_name         text NOT NULL,
  verified_account_name text,

  -- Bank only; NULL for mobile money.
  bank_name            text,
  bank_branch          text,

  verification_status  text NOT NULL DEFAULT 'unverified',
  verification_method  text,
  verification_ref     text,
  verification_error   text,
  verified_at          timestamptz,
  last_attempt_at      timestamptz,
  attempt_count        integer NOT NULL DEFAULT 0,

  -- Micro-deposit verification for bank rails. The amount is generated
  -- server-side and never shown until the merchant reports what landed.
  micro_deposit_ngwee  bigint,
  micro_deposit_sent_at timestamptz,

  is_active            boolean NOT NULL DEFAULT true,
  deactivated_at       timestamptz,

  created_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT merchant_payout_destinations_rail_check
    CHECK (rail IN ('airtel_money', 'bank')),

  CONSTRAINT merchant_payout_destinations_status_check
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'failed')),

  CONSTRAINT merchant_payout_destinations_method_check
    CHECK (verification_method IS NULL
           OR verification_method IN ('airtel_name_lookup', 'micro_deposit', 'manual_admin')),

  -- A bank destination without a bank name cannot be instructed.
  CONSTRAINT merchant_payout_destinations_bank_name_check
    CHECK (rail <> 'bank' OR bank_name IS NOT NULL),

  -- Verified means we know when, and by what. An unexplained `verified` is the
  -- exact state an attacker or a careless admin UI would try to produce.
  CONSTRAINT merchant_payout_destinations_verified_check
    CHECK (verification_status <> 'verified'
           OR (verified_at IS NOT NULL AND verification_method IS NOT NULL))
);

-- One active destination per shop. §2: merchants configure ONE destination.
-- Two active rows would make "where does this shop get paid" ambiguous at
-- exactly the moment it must not be.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_payout_destinations_one_active_idx
  ON public.merchant_payout_destinations (shop_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS merchant_payout_destinations_shop_idx
  ON public.merchant_payout_destinations (shop_id, created_at DESC);

COMMENT ON TABLE public.merchant_payout_destinations IS
  'Where a shop gets paid, with proof it exists. Append-only in practice: '
  'changing a destination deactivates the old row and inserts a new one.';

ALTER TABLE public.merchant_payout_destinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchant_payout_destinations_select ON public.merchant_payout_destinations;
CREATE POLICY merchant_payout_destinations_select ON public.merchant_payout_destinations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = merchant_payout_destinations.shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- No INSERT/UPDATE policy at all. Writes go through the RPCs below, which run
-- SECURITY DEFINER and are granted to service_role only. A merchant editing
-- their own payout row directly is the single highest-value write in the
-- system to compromise.

-- ---------------------------------------------------------------------------
-- 2. set_payout_destination — replaces whatever was active
--
-- Always lands `unverified`. There is no path that sets a destination and a
-- verified status in the same call, because that is the path someone would
-- later use to skip verification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_payout_destination(
  p_shop_id            uuid,
  p_actor_user_id      uuid,
  p_rail               text,
  p_account_identifier text,
  p_account_name       text,
  p_bank_name          text DEFAULT NULL,
  p_bank_branch        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id       uuid;
  v_existing RECORD;
  v_ident    text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_shops
    WHERE user_id = p_actor_user_id AND shop_id = p_shop_id
  ) AND COALESCE(public.current_user_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Forbidden: not assigned to this shop';
  END IF;

  v_ident := regexp_replace(COALESCE(p_account_identifier, ''), '\s', '', 'g');

  IF v_ident = '' THEN
    RAISE EXCEPTION 'Payout account identifier is required';
  END IF;

  IF COALESCE(trim(p_account_name), '') = '' THEN
    RAISE EXCEPTION 'Payout account name is required';
  END IF;

  IF p_rail = 'airtel_money' THEN
    -- Zambian MSISDN, normalised to E.164. Accepting 0977..., 26097... and
    -- +26097... and storing three different shapes of the same number is how
    -- a duplicate-destination check silently stops working.
    IF v_ident ~ '^0[0-9]{9}$' THEN
      v_ident := '+26' || v_ident;
    ELSIF v_ident ~ '^26[0-9]{10}$' THEN
      v_ident := '+' || v_ident;
    ELSIF v_ident ~ '^\+26[0-9]{10}$' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Not a valid Zambian mobile number: %', p_account_identifier;
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.merchant_payout_destinations
  WHERE shop_id = p_shop_id AND is_active
  FOR UPDATE;

  -- Re-submitting the identical destination must not throw away an existing
  -- verification. A merchant who opens the form and presses save without
  -- changing anything should not be blocked from trading for a day.
  IF FOUND
     AND v_existing.rail = p_rail
     AND v_existing.account_identifier = v_ident
     AND v_existing.verification_status = 'verified'
  THEN
    RETURN jsonb_build_object(
      'destination_id', v_existing.id,
      'verification_status', v_existing.verification_status,
      'unchanged', true
    );
  END IF;

  IF FOUND THEN
    UPDATE public.merchant_payout_destinations
    SET is_active = false, deactivated_at = now()
    WHERE id = v_existing.id;
  END IF;

  INSERT INTO public.merchant_payout_destinations (
    shop_id, rail, account_identifier, account_name, bank_name, bank_branch,
    verification_status, created_by
  )
  VALUES (
    p_shop_id, p_rail, v_ident, trim(p_account_name),
    NULLIF(trim(COALESCE(p_bank_name, '')), ''),
    NULLIF(trim(COALESCE(p_bank_branch, '')), ''),
    'unverified', p_actor_user_id
  )
  RETURNING id INTO v_id;

  INSERT INTO public.transaction_events (event_type, payload)
  VALUES ('PAYOUT_DESTINATION_SET', jsonb_build_object(
    'shop_id', p_shop_id,
    'destination_id', v_id,
    'rail', p_rail,
    'actor', p_actor_user_id,
    'replaced', v_existing.id
  ));

  RETURN jsonb_build_object(
    'destination_id', v_id,
    'verification_status', 'unverified',
    'unchanged', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Verification outcomes
--
-- The rail call itself happens in an Edge Function (`verify-payout-destination`)
-- because it is an outbound HTTP request; these record what it found.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_destination_verifying(p_destination_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.merchant_payout_destinations
  SET verification_status = 'pending',
      last_attempt_at = now(),
      attempt_count = attempt_count + 1
  WHERE id = p_destination_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active destination %', p_destination_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_destination_verified(
  p_destination_id uuid,
  p_method         text,
  p_verified_name  text DEFAULT NULL,
  p_reference      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  UPDATE public.merchant_payout_destinations
  SET verification_status   = 'verified',
      verification_method   = p_method,
      verified_account_name = COALESCE(p_verified_name, verified_account_name),
      verification_ref      = COALESCE(p_reference, verification_ref),
      verification_error    = NULL,
      verified_at           = now()
  WHERE id = p_destination_id AND is_active
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active destination %', p_destination_id;
  END IF;

  INSERT INTO public.transaction_events (event_type, payload)
  VALUES ('PAYOUT_DESTINATION_VERIFIED', jsonb_build_object(
    'shop_id', v_row.shop_id,
    'destination_id', p_destination_id,
    'method', p_method,
    'claimed_name', v_row.account_name,
    'verified_name', v_row.verified_account_name
  ));

  RETURN jsonb_build_object(
    'destination_id', p_destination_id,
    'verification_status', 'verified',
    'verified_account_name', v_row.verified_account_name,
    -- Surfaced, not enforced. A name mismatch between "Mary Banda" and
    -- "M BANDA" is routine; between "Mary Banda" and someone else entirely it
    -- is fraud. A human decides which, and the UI shows them both strings.
    'name_matches_claim', v_row.verified_account_name IS NULL
      OR upper(regexp_replace(v_row.verified_account_name, '[^a-zA-Z]', '', 'g'))
       = upper(regexp_replace(v_row.account_name, '[^a-zA-Z]', '', 'g'))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_destination_failed(
  p_destination_id uuid,
  p_error          text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop uuid;
  v_owner uuid;
BEGIN
  UPDATE public.merchant_payout_destinations
  SET verification_status = 'failed',
      verification_error  = p_error
  WHERE id = p_destination_id AND is_active
  RETURNING shop_id INTO v_shop;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active destination %', p_destination_id;
  END IF;

  INSERT INTO public.transaction_events (event_type, payload)
  VALUES ('PAYOUT_DESTINATION_VERIFICATION_FAILED', jsonb_build_object(
    'shop_id', v_shop, 'destination_id', p_destination_id, 'error', p_error
  ));

  SELECT owner_id INTO v_owner FROM public.shops WHERE id = v_shop;
  IF v_owner IS NOT NULL THEN
    PERFORM public.create_notification(
      v_owner,
      'We could not verify your payout details. Until they are verified you cannot accept gift collections. Please check the number and try again.',
      'error',
      v_shop::text
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The gate
--
-- One function, asked in two places: the merchant panel (to explain why the
-- scanner is disabled) and the redemption RPC (to refuse the scan). Both must
-- agree, which is why there is one function and not two predicates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shop_payout_readiness(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dest RECORD;
BEGIN
  SELECT id, rail, account_identifier, account_name, verified_account_name,
         verification_status, verification_error, verified_at
  INTO v_dest
  FROM public.merchant_payout_destinations
  WHERE shop_id = p_shop_id AND is_active;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'can_accept_redemptions', false,
      'reason', 'NO_DESTINATION',
      'message', 'Add the mobile money number or bank account where you want to be paid.'
    );
  END IF;

  IF v_dest.verification_status <> 'verified' THEN
    RETURN jsonb_build_object(
      'can_accept_redemptions', false,
      'reason', 'DESTINATION_' || upper(v_dest.verification_status),
      'destination_id', v_dest.id,
      'rail', v_dest.rail,
      'error', v_dest.verification_error,
      'message', CASE v_dest.verification_status
        WHEN 'pending' THEN 'We are checking your payout details. This usually takes under a minute.'
        WHEN 'failed'  THEN 'Your payout details could not be verified. Please correct them.'
        ELSE 'Your payout details need verifying before you can accept collections.'
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'can_accept_redemptions', true,
    'reason', 'READY',
    'destination_id', v_dest.id,
    'rail', v_dest.rail,
    'account_identifier', v_dest.account_identifier,
    'account_name', COALESCE(v_dest.verified_account_name, v_dest.account_name),
    'verified_at', v_dest.verified_at
  );
END;
$$;

-- The boolean form, for use inside other SQL where the jsonb is noise.
CREATE OR REPLACE FUNCTION public.shop_can_accept_redemptions(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_payout_destinations
    WHERE shop_id = p_shop_id AND is_active AND verification_status = 'verified'
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Backfill: carry existing payout details across as UNVERIFIED
--
-- Deliberately not verified. Every one of these numbers was typed into a free
-- text field and never checked against anything. Marking them verified would
-- be asserting a fact nobody established, and the whole point of §6.1 is that
-- an unproven destination is treated as a bad one.
--
-- The consequence is real and intended: on cutover, every existing merchant
-- must verify before they can accept a collection. That is a migration task
-- with an outreach plan, not something to paper over with a default.
-- ---------------------------------------------------------------------------
INSERT INTO public.merchant_payout_destinations (
  shop_id, rail, account_identifier, account_name, bank_name,
  verification_status, created_at
)
SELECT
  s.id,
  CASE WHEN s.payout_method = 'bank' THEN 'bank' ELSE 'airtel_money' END,
  regexp_replace(s.payout_details, '\s', '', 'g'),
  COALESCE(NULLIF(trim(s.payout_account_name), ''), s.name),
  s.payout_bank_name,
  'unverified',
  now()
FROM public.shops s
WHERE COALESCE(trim(s.payout_details), '') <> ''
  -- Only rails this model supports. MTN MoMo is an open question (§10) and a
  -- destination we cannot pay is worse than no destination at all: it looks
  -- configured.
  AND COALESCE(s.payout_method, 'airtel') IN ('airtel', 'bank')
  AND NOT EXISTS (
    SELECT 1 FROM public.merchant_payout_destinations d
    WHERE d.shop_id = s.id AND d.is_active
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_payout_destination(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_destination_verifying(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_destination_verified(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_destination_failed(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_payout_readiness(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_can_accept_redemptions(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_payout_destination(uuid, uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_destination_verifying(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_destination_verified(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_destination_failed(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.shop_can_accept_redemptions(uuid) TO service_role;

-- Readiness is readable by the merchant: the panel has to be able to say why
-- the scanner is off. It returns no account digits the caller cannot already
-- see through the RLS policy above.
GRANT EXECUTE ON FUNCTION public.shop_payout_readiness(uuid) TO service_role, authenticated;

GRANT SELECT ON public.merchant_payout_destinations TO authenticated;
