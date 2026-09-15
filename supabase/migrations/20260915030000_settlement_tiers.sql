-- =============================================================================
-- Tiered settlement — turning the hold into an incentive
--
-- THE CONFLICT THIS RESOLVES
-- --------------------------
-- Instant payout and dispute protection are in direct conflict, and mobile
-- money makes the conflict sharp: an Airtel disbursement is final. Once sent,
-- it cannot be reversed. So any window in which a dispute could arrive is a
-- window in which KithLy must not have paid yet, and any delay is a merchant
-- waiting for money they have already earned.
--
-- A single global `dispute_window_minutes` resolves this badly. It is one
-- number applied to a merchant who has fulfilled two hundred orders and a
-- merchant who registered this morning, so it is necessarily either too slow
-- for the first or too reckless with the second.
--
-- Tiering resolves it, and -- this is the part worth having -- turns the hold
-- from a tax into a reward. "Get paid instantly" becomes a thing a merchant
-- earns, which makes their fulfilment record something they have a reason to
-- care about. That is a better incentive than any rating badge.
--
-- WHY THE TIER IS STORED AND NOT COMPUTED AT READ TIME
-- ----------------------------------------------------
-- The hold is applied at the instant of a scan, inside the redemption
-- transaction. Computing it there would mean aggregating a merchant's dispute
-- and payout-failure history while a customer waits at a counter. The stored
-- column is a cache -- and per this repo's hard-won rule, a cache over a
-- ledger is RECOMPUTED, never incremented. `refresh_settlement_tier` always
-- derives the value from scratch.
--
-- BLAST RADIUS: adds columns to `shops` and a new reference table.
-- `platform_settings.dispute_window_minutes` is left in place and marked
-- deprecated; 20260915040000 stops reading it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The tiers
--
-- A table rather than a CASE expression because the thresholds are a
-- commercial decision that will be tuned against real merchant behaviour, and
-- tuning them should not require a migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settlement_tiers (
  tier                       text PRIMARY KEY,
  label                      text NOT NULL,
  hold_seconds               integer NOT NULL,
  min_successful_redemptions integer NOT NULL,
  requires_manual_review     boolean NOT NULL DEFAULT false,
  sort_order                 integer NOT NULL,

  -- Shown to the merchant. §5: "Merchants see their tier and what promotes
  -- them." A tier the merchant cannot see the exit from is just a punishment.
  merchant_explanation       text NOT NULL,

  CONSTRAINT settlement_tiers_hold_check CHECK (hold_seconds >= 0),
  CONSTRAINT settlement_tiers_min_check  CHECK (min_successful_redemptions >= 0)
);

INSERT INTO public.settlement_tiers
  (tier, label, hold_seconds, min_successful_redemptions, requires_manual_review, sort_order, merchant_explanation)
VALUES
  ('new', 'New shop', 86400, 0, false, 1,
   'Your payouts arrive 24 hours after each collection while we get to know your shop. Complete 10 collections without a dispute and you move to instant payouts.'),
  ('established', 'Instant payouts', 0, 10, false, 2,
   'You are paid the moment a gift is collected. This is yours as long as your collections stay dispute-free.'),
  ('flagged', 'Under review', 259200, 0, true, 3,
   'Payouts are held for 72 hours and reviewed by our team while we look into an open issue. We will be in touch.')
ON CONFLICT (tier) DO UPDATE
SET label                      = EXCLUDED.label,
    hold_seconds               = EXCLUDED.hold_seconds,
    min_successful_redemptions = EXCLUDED.min_successful_redemptions,
    requires_manual_review     = EXCLUDED.requires_manual_review,
    sort_order                 = EXCLUDED.sort_order,
    merchant_explanation       = EXCLUDED.merchant_explanation;

ALTER TABLE public.settlement_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settlement_tiers_read ON public.settlement_tiers;
CREATE POLICY settlement_tiers_read ON public.settlement_tiers
  FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 2. Shop state
-- ---------------------------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS settlement_tier text NOT NULL DEFAULT 'new';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS settlement_tier_updated_at timestamptz;

-- Set by ops, cleared by ops. Distinct from the derived flagged state so that
-- resolving a dispute cannot silently un-flag a merchant a human flagged for a
-- reason the data does not capture.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS settlement_manual_flag boolean NOT NULL DEFAULT false;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS settlement_flag_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_settlement_tier_fkey') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_settlement_tier_fkey
      FOREIGN KEY (settlement_tier) REFERENCES public.settlement_tiers(tier);
  END IF;
END $$;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS settlement_flag_failure_threshold integer NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.platform_settings.dispute_window_minutes IS
  'DEPRECATED as of 20260915030000. Replaced by per-merchant settlement tiers. '
  'Retained only so the legacy fulfilment path keeps working until escrow_mode '
  'reaches escrow_v2; read by nothing in the escrow path.';

-- ---------------------------------------------------------------------------
-- 3. refresh_settlement_tier
--
-- Derives the tier from scratch every time. Order matters: containment beats
-- promotion, so a merchant who qualifies for `established` on volume but has
-- an open dispute is `flagged`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_settlement_tier(p_shop_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop          RECORD;
  v_open_disputes integer;
  v_abandoned     integer;
  v_threshold     integer;
  v_tier          text;
BEGIN
  SELECT id, successful_deliveries, settlement_tier, settlement_manual_flag
  INTO v_shop
  FROM public.shops WHERE id = p_shop_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(settlement_flag_failure_threshold, 3) INTO v_threshold
  FROM public.platform_settings WHERE id = 1;
  v_threshold := COALESCE(v_threshold, 3);

  SELECT COUNT(*) INTO v_open_disputes
  FROM public.shop_orders
  WHERE shop_id = p_shop_id
    AND disputed_at IS NOT NULL
    AND claim_status NOT IN ('CANCELLED', 'EXPIRED', 'REFUNDED');

  -- Elevated failure rate, measured as payouts we gave up on. A merchant whose
  -- money keeps bouncing is either mis-configured or not who they say they
  -- are, and both warrant a slower hold until someone has looked.
  SELECT COUNT(*) INTO v_abandoned
  FROM public.payout_instructions
  WHERE shop_id = p_shop_id
    AND status = 'ABANDONED'
    AND created_at > now() - interval '30 days';

  IF v_shop.settlement_manual_flag
     OR v_open_disputes > 0
     OR v_abandoned >= v_threshold
  THEN
    v_tier := 'flagged';
  ELSE
    SELECT tier INTO v_tier
    FROM public.settlement_tiers
    WHERE NOT requires_manual_review
      AND min_successful_redemptions <= COALESCE(v_shop.successful_deliveries, 0)
    ORDER BY min_successful_redemptions DESC
    LIMIT 1;

    v_tier := COALESCE(v_tier, 'new');
  END IF;

  IF v_tier IS DISTINCT FROM v_shop.settlement_tier THEN
    UPDATE public.shops
    SET settlement_tier = v_tier, settlement_tier_updated_at = now()
    WHERE id = p_shop_id;

    INSERT INTO public.transaction_events (event_type, payload)
    VALUES ('SETTLEMENT_TIER_CHANGED', jsonb_build_object(
      'shop_id', p_shop_id, 'from', v_shop.settlement_tier, 'to', v_tier,
      'successful_redemptions', v_shop.successful_deliveries,
      'open_disputes', v_open_disputes, 'abandoned_payouts_30d', v_abandoned
    ));
  END IF;

  RETURN v_tier;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The hold, in seconds
--
-- Read inside the redemption transaction. One index probe and one lookup on a
-- three-row table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shop_settlement_hold_seconds(p_shop_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT t.hold_seconds
     FROM public.shops s
     JOIN public.settlement_tiers t ON t.tier = s.settlement_tier
     WHERE s.id = p_shop_id),
    -- An unknown shop gets the most cautious hold there is rather than the
    -- fastest. Failing open on a payout delay is a bad default.
    (SELECT MAX(hold_seconds) FROM public.settlement_tiers)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. What the merchant sees
--
-- Returns both where they are and what moves them, because §5's incentive only
-- works if the next step is legible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merchant_settlement_status(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop RECORD;
  v_tier RECORD;
  v_next RECORD;
BEGIN
  SELECT id, settlement_tier, successful_deliveries, settlement_flag_reason,
         settlement_manual_flag, settlement_tier_updated_at
  INTO v_shop FROM public.shops WHERE id = p_shop_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NO_SUCH_SHOP');
  END IF;

  SELECT * INTO v_tier FROM public.settlement_tiers WHERE tier = v_shop.settlement_tier;

  SELECT * INTO v_next
  FROM public.settlement_tiers
  WHERE NOT requires_manual_review
    AND min_successful_redemptions > COALESCE(v_shop.successful_deliveries, 0)
  ORDER BY min_successful_redemptions
  LIMIT 1;

  RETURN jsonb_build_object(
    'tier',                v_shop.settlement_tier,
    'label',               v_tier.label,
    'hold_seconds',        v_tier.hold_seconds,
    'instant',             v_tier.hold_seconds = 0,
    'explanation',         v_tier.merchant_explanation,
    'under_review',        v_tier.requires_manual_review,
    'flag_reason',         v_shop.settlement_flag_reason,
    'successful_redemptions', COALESCE(v_shop.successful_deliveries, 0),
    'next_tier',           v_next.tier,
    'next_tier_label',     v_next.label,
    'redemptions_to_next', CASE
      WHEN v_next.tier IS NULL THEN NULL
      ELSE v_next.min_successful_redemptions - COALESCE(v_shop.successful_deliveries, 0)
    END,
    'since',               v_shop.settlement_tier_updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Ops controls
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_settlement_manual_flag(
  p_shop_id  uuid,
  p_flagged  boolean,
  p_reason   text,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tier text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  IF p_flagged AND COALESCE(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required when flagging a merchant';
  END IF;

  UPDATE public.shops
  SET settlement_manual_flag = p_flagged,
      settlement_flag_reason = CASE WHEN p_flagged THEN trim(p_reason) ELSE NULL END
  WHERE id = p_shop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such shop %', p_shop_id;
  END IF;

  v_tier := public.refresh_settlement_tier(p_shop_id);

  INSERT INTO public.admin_action_log (actor_id, action, target_type, target_id, payload)
  VALUES (p_admin_id,
          CASE WHEN p_flagged THEN 'SETTLEMENT_FLAG_SET' ELSE 'SETTLEMENT_FLAG_CLEARED' END,
          'shop', p_shop_id,
          jsonb_build_object('reason', p_reason, 'resulting_tier', v_tier));

  RETURN jsonb_build_object('shop_id', p_shop_id, 'flagged', p_flagged, 'tier', v_tier);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Initial tier assignment
--
-- Every existing shop is re-derived from its actual record rather than
-- defaulted to `new`. A merchant with two hundred clean fulfilments should not
-- be told they are unproven because we changed our schema.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.shops LOOP
    PERFORM public.refresh_settlement_tier(v_id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.refresh_settlement_tier(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_settlement_hold_seconds(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_settlement_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_settlement_manual_flag(uuid, boolean, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.refresh_settlement_tier(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.shop_settlement_hold_seconds(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_settlement_manual_flag(uuid, boolean, text, uuid) TO service_role;

-- The merchant must be able to read their own tier and what promotes them --
-- that visibility is the mechanism, not a UI nicety.
GRANT EXECUTE ON FUNCTION public.merchant_settlement_status(uuid) TO service_role, authenticated;

GRANT SELECT ON public.settlement_tiers TO anon, authenticated;
