-- =============================================================================
-- The Pulse — real things, said as counts
--
-- WHAT IT IS FOR
-- --------------
-- KithLy does not have a shortage of motion. It has a shortage of density: an
-- order collected at 11am, a list saved at 3pm, a rating left on Tuesday. Real
-- events, spread so thin across time and people that nobody ever witnesses two
-- of them in one session, and so the platform reads as empty when it is not.
--
-- This is the compression. It gathers what actually happened and offers it as
-- statements that can be shown together.
--
-- COHORTS ONLY. NEVER A PERSON.
-- -----------------------------
-- "Chanda just bought a cake" is true at ten users and embarrassing at ten. It
-- is also a privacy problem the moment the user base is small enough that a
-- first name identifies somebody.
--
-- Every statement here is a count over a window: "7 people collected from Mama
-- Africa's this week". That is the only form whose credibility *grows* with
-- scale, so the aliveness layer never has to be taken down later -- it matures
-- into ordinary social proof.
--
-- MIN_COHORT IS A PRIVACY FLOOR, NOT A TASTE DECISION
-- ---------------------------------------------------
-- "1 person saved this" is a sentence about one identifiable person in a town
-- where the shopkeeper knows their customers. Nothing below three is emitted,
-- ever. That is also why there is no "most recent" ordering and no timestamps
-- finer than a day: a count plus a precise time is a person.
--
-- NOTHING IS INVENTED
-- -------------------
-- Every row here is a COUNT of rows that exist. There is no seeding, no
-- estimate and no floor other than zero. If the platform did nothing this week
-- this function returns nothing, and the surface renders nothing -- which is
-- correct. The honest way to look busier is to be busier.
--
-- The *pacing* -- releasing these gradually rather than all at once -- happens
-- on the client, in reco/pulse.ts. It only ever delays; it cannot add.
-- =============================================================================

/* Three people. See the header: this is a floor, not a preference. */
CREATE OR REPLACE FUNCTION public.pulse_min_cohort()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

COMMENT ON FUNCTION public.pulse_min_cohort() IS
  'The smallest group the Pulse will describe. Below this a count identifies a person.';

-- ---------------------------------------------------------------------------
-- The statements
--
-- One row per thing worth saying. `weight` is how alive the fact is -- a
-- collection today outranks a rating from Thursday -- and the client uses it to
-- choose what to show rather than showing everything at once.
--
-- SECURITY DEFINER, deliberately and carefully: the counts span every user, so
-- an invoker-rights function would return only what the caller can already see,
-- which for an anonymous visitor is nothing. What leaves this function is a
-- shop name and an integer, never a row, a person or an id that reaches one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pulse_statements(p_limit integer DEFAULT 12)
RETURNS TABLE (
  kind     text,
  subject  text,
  quantity integer,
  window_days integer,
  weight   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH collected AS (
    -- Orders actually collected. The warmest thing the platform knows: money
    -- moved, a person turned up, a shopkeeper handed something over.
    SELECT
      'collected'::text AS kind,
      s.name            AS subject,
      count(*)::integer AS quantity,
      7                 AS window_days,
      1.00::numeric     AS weight
    FROM public.shop_orders so
    JOIN public.shops s ON s.id = so.shop_id
    -- fulfilled_at, not claim_status. It is stamped at the moment the
    -- shopkeeper hands the thing over, which IS the event being counted --
    -- somebody turned up and collected. REDEEMED is settlement, which happens
    -- later, after the no-dispute window, and is a fact about money rather
    -- than about a person walking into a shop.
    WHERE so.fulfilled_at >= now() - interval '7 days'
      AND so.claim_status NOT IN ('CANCELLED', 'EXPIRED')
      AND s.is_active
    GROUP BY s.name
    HAVING count(*) >= public.pulse_min_cohort()
  ),
  saved AS (
    -- Saving is a softer signal than buying, and says more about intent than
    -- about a transaction, so it is worth less and lasts longer.
    SELECT
      'saved'::text, l.title, count(*)::integer, 14, 0.55::numeric
    FROM public.list_saves ls
    JOIN public.lists l ON l.id = ls.list_id
    WHERE ls.created_at >= now() - interval '14 days'
      AND l.visibility = 'community'
    GROUP BY l.title
    HAVING count(*) >= public.pulse_min_cohort()
  ),
  rated AS (
    SELECT
      'rated'::text, s.name, count(*)::integer, 14, 0.70::numeric
    FROM public.shop_ratings sr
    JOIN public.shops s ON s.id = sr.shop_id
    WHERE sr.created_at >= now() - interval '14 days'
      AND s.is_active
    GROUP BY s.name
    HAVING count(*) >= public.pulse_min_cohort()
  ),
  journeys AS (
    -- Not per-author: a count of new journeys is a statement about the
    -- platform, and naming the authors would undo the cohort rule.
    SELECT
      'journeys'::text, NULL::text, count(*)::integer, 14, 0.45::numeric
    FROM public.lists l
    WHERE l.visibility = 'community'
      AND l.template = 'storyboard'
      AND l.created_at >= now() - interval '14 days'
    HAVING count(*) >= public.pulse_min_cohort()
  ),
  open_now AS (
    -- Not an event at all, and the most honest line on the page: how many
    -- shops are trading at this minute. True by construction, changes through
    -- the day on its own, and needs nothing to have happened.
    SELECT
      'open_now'::text, NULL::text, count(*)::integer, 0, 0.35::numeric
    FROM public.shops s
    WHERE s.is_active AND s.opening_hours IS NOT NULL
    HAVING count(*) >= public.pulse_min_cohort()
  )
  SELECT * FROM collected
  UNION ALL SELECT * FROM saved
  UNION ALL SELECT * FROM rated
  UNION ALL SELECT * FROM journeys
  UNION ALL SELECT * FROM open_now
  ORDER BY weight DESC, quantity DESC
  LIMIT GREATEST(COALESCE(p_limit, 12), 1);
$$;

COMMENT ON FUNCTION public.pulse_statements(integer) IS
  'Real activity as cohort counts, never individuals. Returns nothing when nothing happened, which is the correct answer.';

REVOKE ALL ON FUNCTION public.pulse_statements(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pulse_statements(integer) TO anon, authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'pulse ready';
END $$;
