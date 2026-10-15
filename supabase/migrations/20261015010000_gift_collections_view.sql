-- =============================================================================
-- "Three collections for this gift" -- the errand, without handing over the keys
--
-- Step 9 of docs/plans/curated-catalogue.md. A gift spanning three shops
-- produces three `shop_orders` and three claim codes, and until now the
-- recipient met them one page at a time with nothing saying they belonged
-- together. Multi-shop is deliberate -- the trips are part of the product,
-- because a gift that asks for an afternoon reads as something you took part
-- in rather than charity -- so the trips have to feel organised rather than
-- scattered.
--
-- WHAT THIS DELIBERATELY DOES NOT RETURN: THE OTHER CODES
-- -------------------------------------------------------
-- The plan asked for each leg "with its own code". That cannot be built the
-- obvious way, and the reason is worth stating so nobody re-adds it.
--
-- `/gift/:claimCode` is a PUBLIC page: the code alone opens it, by design, so a
-- recipient with no account can collect. A function that takes one leg's code
-- and returns its siblings' codes therefore turns ANY ONE CODE INTO A MASTER
-- KEY for the whole basket. A claim code is a bearer instrument, and the people
-- who handle one include every till it is presented at -- so the merchant who
-- scans leg one could read legs two and three and collect them.
--
-- So this returns the shape of the errand and not the means to complete it:
-- which shops, where, when they are open, how many items, and whether that leg
-- is already collected. The recipient already holds every code -- each
-- `shop_order` is messaged to them separately -- so nothing is withheld from
-- the person this is for. Andy chose this option over keying the view on the
-- transaction-level code or returning everything.
--
-- WHAT IT REVEALS, STATED PLAINLY: to a caller who already holds one valid
-- code, the names and addresses of the other shops in the same gift, and each
-- leg's collection status. Nothing about any other gift, and nothing at all
-- for a code that does not exist (NULL, same as get_shop_order_by_claim_code).
--
-- Rate limiting is the same gap the existing lookup has: `20260914*` metered
-- redemption in the Edge Functions, but `get_shop_order_by_claim_code` is
-- reachable from the browser and unmetered, and so is this. Closing it needs
-- Cloudflare or Upstash rather than repo work, and is tracked separately. This
-- function is not a new enumeration oracle -- it answers nothing a valid code
-- does not already answer -- but it should be metered alongside the other when
-- that lands.
--
-- ORDERING: by address then name, so legs in the same part of town sit
-- together. Honest grouping rather than real proximity -- `shops.location` is
-- free text and there is no lat/lng anywhere, so distance sorting is deferred
-- (see §6 of the plan). Alphabetical would have scattered one errand across
-- the city.
--
-- BLAST RADIUS: Local -- one new read-only function. It touches no money, adds
-- no column, and changes nothing that exists. `security_invoker` is not used:
-- it is SECURITY DEFINER on purpose, because the caller is usually signed out
-- and `shop_orders` RLS would show them nothing.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_gift_collections(code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_txn   uuid;
  v_order uuid;
  v_legs  jsonb;
BEGIN
  IF code IS NULL OR btrim(code) = '' THEN
    RETURN NULL;
  END IF;

  -- Resolve the code to its transaction. UPPER + btrim to match
  -- get_shop_order_by_claim_code, which is what the page used to find it.
  SELECT so.transaction_id, so.shop_order_id
    INTO v_txn, v_order
  FROM public.shop_orders so
  WHERE UPPER(so.claim_code) = UPPER(btrim(code));

  IF v_txn IS NULL THEN
    RETURN NULL;
  END IF;

  -- The sort keys are columns beside the object, not fields inside it: a
  -- caller has no use for them, and a payload should not carry the bookkeeping
  -- of its own ordering.
  SELECT jsonb_agg(leg ORDER BY sort_area, sort_name)
    INTO v_legs
  FROM (
    SELECT
      COALESCE(NULLIF(btrim(s.location), ''), NULLIF(btrim(s.address), ''), '') AS sort_area,
      COALESCE(s.name, '')                                                     AS sort_name,
      jsonb_build_object(
             -- No claim_code here, for any leg. See the header.
             'shop_order_id', so.shop_order_id,
             'shop_name',     s.name,
             'shop_address',  COALESCE(NULLIF(btrim(s.address), ''), s.physical_address),
             'shop_area',     COALESCE(NULLIF(btrim(s.location), ''), s.shop_location),
             'opening_hours', s.opening_hours,
             'maps_link',     s.maps_link,
             'claim_status',  so.claim_status,
             'collected',     so.claim_status IN ('CLAIMED', 'FULFILLED', 'COLLECTED'),
             -- Which leg the reader is looking at, so the page can mark it
             -- rather than making them work it out from the shop name.
             'is_current',    so.shop_order_id = v_order,
             'item_count',    (
               SELECT count(*) FROM public.order_items oi
               WHERE oi.shop_order_id = so.shop_order_id
             )
           ) AS leg
    FROM public.shop_orders so
    LEFT JOIN public.shops s ON s.id = so.shop_id
    WHERE so.transaction_id = v_txn
      -- An unpaid leg is not an errand yet, and showing one would promise a
      -- collection that may never exist.
      AND so.claim_status <> 'PENDING_PAYMENT'
  ) legs;

  v_legs := COALESCE(v_legs, '[]'::jsonb);

  RETURN jsonb_build_object(
    'total',     jsonb_array_length(v_legs),
    'collected', (
      SELECT count(*) FROM jsonb_array_elements(v_legs) l
      WHERE (l->>'collected')::boolean
    ),
    'legs',      v_legs
  );
END;
$$;

COMMENT ON FUNCTION public.get_gift_collections(text) IS
  'The other collections belonging to the same gift, for /gift/:claimCode.
   Returns shop, area, hours and status per leg and NEVER another leg''s claim
   code: the page is public and reachable with one code, so returning the
   siblings'' codes would make any single code a master key for the basket.';

-- Supabase grants EXECUTE to anon by default, so PUBLIC alone is not enough --
-- see 20261013000000. Here anon is WANTED: the gift page is public by design.
REVOKE ALL ON FUNCTION public.get_gift_collections(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_collections(text) TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Prove the one property that matters: no claim code leaves this function
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.get_gift_collections(text)'::regprocedure);

  -- The WHERE clause reads claim_code to resolve the input; what must not
  -- happen is claim_code being built into the returned object.
  IF v_def ~* '''claim_code''\s*,' THEN
    RAISE EXCEPTION
      'get_gift_collections returns a claim_code. The gift page is public: one code must not reveal the others.';
  END IF;

  RAISE NOTICE 'get_gift_collections returns the errand, not the codes';
END $$;
