-- =============================================================================
-- Close the three tables that never had row level security enabled
--
-- Every other table in this schema enables RLS. These three were created in
-- the baseline snapshot and the first money migration and were never revisited,
-- so they sit in `public` reachable by `anon` and `authenticated` with no
-- policy evaluation at all.
--
-- `marketing_campaigns` is the serious one, and it is serious in a way that
-- reads as safe: 20260615000000_harden_and_remediate_data_layer.sql wrote two
-- correct policies for it --
--
--     marketing_campaigns_select  (is_active = true OR admin)
--     marketing_campaigns_admin   (FOR ALL, admin only)
--
-- -- and never ran ALTER TABLE ... ENABLE ROW LEVEL SECURITY. A policy on a
-- table without RLS enabled is inert: Postgres stores it and never consults
-- it. So the table has looked protected in every review since June while
-- actually being world-writable by any authenticated user. `useBannerManager`
-- writes here and `useHome` reads here, which means any signed-in account
-- could rewrite the marketing banners on the public homepage.
--
-- Enabling RLS does not create new rules; it activates the ones already
-- written. Intended behaviour after this migration is exactly what
-- 20260615000000 intended in the first place.
--
-- BLAST RADIUS
-- ------------
-- marketing_campaigns  🟡 read path unchanged for anon and authenticated
--                         (active rows stay readable); write path narrows to
--                         admin, which is what the existing policy says and
--                         what useBannerManager already assumes -- that hook
--                         is only reachable from the admin banner screen.
-- bundles              🟢 no client consumer exists. Searched: there is no
--                         .from('bundles') anywhere in src/. The only reader
--                         is flutterwave-webhook, which uses the service role
--                         and bypasses RLS. Deny-by-default is therefore
--                         invisible today and correct tomorrow.
-- payment_webhook_idempotency
--                      🟢 service-role only by construction. Enabling RLS
--                         with no policy makes that explicit rather than
--                         incidental.
--
-- Deny-by-default (RLS on, no policies) is deliberate for the latter two. If
-- a client ever does need to read them, that read will return empty rather
-- than error -- so the policy should be added in the same change as the
-- reader, not speculatively here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. marketing_campaigns -- activate the policies written in June
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.marketing_campaigns IS
  'Homepage promotional banners. RLS enabled 20260914091000 -- the policies '
  'from 20260615000000 existed but were inert until then, leaving the table '
  'writable by any authenticated user.';

-- ---------------------------------------------------------------------------
-- 2. bundles -- deny by default
-- ---------------------------------------------------------------------------
ALTER TABLE public.bundles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.bundles IS
  'Admin-curated item bundles. RLS enabled with no policies: the only reader '
  'is flutterwave-webhook under the service role. Add a policy alongside the '
  'first client consumer, not before one exists.';

-- ---------------------------------------------------------------------------
-- 3. payment_webhook_idempotency -- deny by default
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_webhook_idempotency ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payment_webhook_idempotency IS
  'Replay guard for gateway callbacks, keyed transaction_id:flutterwave_id. '
  'Service role only; RLS enabled with no policies so nothing else can read '
  'which payments have been seen.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than assume it.
--
-- The whole reason this migration exists is that a policy was written and the
-- enable statement was forgotten, and nothing caught it for three months. So
-- this checks both halves: RLS is on, and marketing_campaigns still carries
-- the two policies that are now finally live.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
  v_enabled BOOLEAN;
  v_policies INTEGER;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['marketing_campaigns', 'bundles', 'payment_webhook_idempotency']
  LOOP
    SELECT c.relrowsecurity INTO v_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_table;

    IF v_enabled IS NULL THEN
      RAISE EXCEPTION 'public.% does not exist', v_table;
    END IF;

    IF NOT v_enabled THEN
      RAISE EXCEPTION 'RLS is still disabled on public.%', v_table;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'marketing_campaigns';

  IF v_policies < 2 THEN
    RAISE EXCEPTION
      'marketing_campaigns has % policies; expected the two from 20260615000000. Enabling RLS without them would lock out the homepage banner read.',
      v_policies;
  END IF;

  RAISE NOTICE 'RLS enabled on 3 tables; marketing_campaigns policies now active (% found).', v_policies;
END;
$$;
