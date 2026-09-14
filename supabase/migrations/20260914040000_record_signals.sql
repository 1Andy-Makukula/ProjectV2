-- =============================================================================
-- The one permitted reference from public to kithly_reco
--
-- WHY IT EXISTS
-- -------------
-- `kithly_reco.signals` has been waiting since Stage 1d for something to write
-- to it, and PostgREST only exposes schemas listed in the project's API
-- settings -- `public` alone, by default. So a browser cannot reach
-- `kithly_reco.signals` directly, and the log stays empty however much
-- instrumentation ships.
--
-- The alternative was to expose `kithly_reco` over the API. That needs a change
-- in the hosted project's dashboard as well as in config.toml, which is outside
-- this repository and cannot be verified from it -- and it would put every
-- table the recommender ever adds on the public API by default, which is a much
-- larger surface than one insert needs.
--
-- SO THIS IS AN EXCEPTION, AND IT IS NAMED AS ONE
-- -----------------------------------------------
-- Stage 1d established that `public` never references `kithly_reco`, so the
-- recommender can be dropped and rebuilt wholesale without touching anything
-- that matters. That rule now has exactly one exception, and it is written
-- here rather than discovered later.
--
-- It is kept safe by being *soft*: if `kithly_reco` is dropped, this function
-- does nothing instead of failing. The platform therefore still survives the
-- recommender being deleted, which was the whole purpose of the rule. A
-- shopper tapping a tile must never see an error because a log is missing.
--
-- WRITE-ONLY, AND ONLY ABOUT YOURSELF
-- -----------------------------------
-- It inserts and returns nothing. There is no read path here, so this cannot
-- become a way to query the log. Every row is stamped with `auth.uid()` by the
-- function rather than taken from the caller, so a client cannot attribute
-- behaviour to somebody else however it shapes its payload -- which matters,
-- because poisoned signals become a poisoned ranker.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_signals(p_signals jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF p_signals IS NULL OR jsonb_typeof(p_signals) <> 'array' THEN
    RETURN;
  END IF;

  -- A cap, so one client cannot post ten thousand rows in a call. The batch
  -- size on the client is twenty; a hundred is generous and still bounded.
  IF jsonb_array_length(p_signals) > 100 THEN
    RAISE EXCEPTION 'too many signals in one call';
  END IF;

  -- Soft dependency: no recommender, no logging, no error. See the header.
  IF to_regclass('kithly_reco.signals') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO kithly_reco.signals
    (user_id, session_id, surface, action, subject_type, subject_id, slate_id, position, context)
  SELECT
    -- Never from the payload. The caller does not get to say who they are.
    v_user,
    NULLIF(s ->> 'session_id', '')::uuid,
    s ->> 'surface',
    s ->> 'action',
    s ->> 'subject_type',
    NULLIF(s ->> 'subject_id', '')::uuid,
    NULLIF(s ->> 'slate_id', '')::uuid,
    NULLIF(s ->> 'position', '')::integer,
    COALESCE(s -> 'context', '{}'::jsonb)
  FROM jsonb_array_elements(p_signals) AS s
  -- Rows the CHECK constraints would reject are dropped rather than failing
  -- the batch: one malformed signal from an older client must not cost the
  -- nineteen good ones beside it.
  WHERE s ->> 'action' IN ('impression','view','tap','save','add_to_cart','purchase','dismiss','search')
    AND s ->> 'subject_type' IN ('item','shop','post','list','collection','experience','query')
    AND COALESCE(btrim(s ->> 'surface'), '') <> ''
    AND (NULLIF(s ->> 'subject_id', '') IS NOT NULL OR s ->> 'subject_type' = 'query');
END;
$$;

COMMENT ON FUNCTION public.record_signals(jsonb) IS
  'Write-only entry point for kithly_reco.signals. The single permitted public -> kithly_reco reference, and soft if the schema is gone.';

REVOKE ALL ON FUNCTION public.record_signals(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_signals(jsonb) TO anon, authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'record_signals ready';
END $$;
