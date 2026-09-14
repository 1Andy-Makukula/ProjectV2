-- =============================================================================
-- The recommender's front door
--
-- A CORRECTION TO HOW I FRAMED THIS TWO MIGRATIONS AGO
-- ----------------------------------------------------
-- 20260914040000 added `public.record_signals` and called it "the one permitted
-- reference from public to kithly_reco". That framing was too narrow, and
-- keeping it would have meant either pretending the next three functions were
-- also one-offs, or building the client against things it cannot reach.
--
-- PostgREST exposes `public` and nothing else. So anything a browser must call
-- has to live in `public`, full stop -- not as an exception, as a fact about the
-- deployment. The rule Stage 1d actually wanted was never "no references"; it
-- was "the platform survives the recommender being deleted".
--
-- So the rule is restated properly:
--
--   * `public` holds the recommender's API: thin, documented, SOFT wrappers
--   * `kithly_reco` holds its data and its thinking
--   * no public TABLE or VIEW structurally depends on kithly_reco -- no foreign
--     key, no view, nothing that a DROP SCHEMA would break
--   * every wrapper degrades to an empty result if the schema is gone
--
-- Drop `kithly_reco` tomorrow and the storefront keeps serving: these functions
-- return nothing instead of raising, which is exactly what a surface with no
-- recommendations should show. That is the property that mattered; the
-- reference count never did.
--
-- WHY WRAPPERS RATHER THAN EXPOSING THE SCHEMA
-- --------------------------------------------
-- Adding `kithly_reco` to the project's exposed schemas would put every table
-- the recommender ever gains on the public API by default, including the signal
-- log -- which must stay write-only. Four named functions is a smaller and more
-- reviewable surface than a whole schema.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Open proposals, for the surface that shows them
--
-- Returns the item rows joined, because a client that had to fetch the ids and
-- then fetch the items would render an empty box and then fill it -- and this
-- is meant to fade in already true.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_proposals(p_surface text DEFAULT NULL)
RETURNS TABLE (
  id          uuid,
  kind        text,
  surface     text,
  reason_code text,
  reason_text text,
  total_zmw   integer,
  item_ids    uuid[],
  items       jsonb,
  created_at  timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Soft: no recommender, no suggestions, no error.
  IF to_regclass('kithly_reco.proposals') IS NULL OR auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.kind, p.surface, p.reason_code, p.reason_text, p.total_zmw, p.item_ids,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
                 'id', i.id, 'name', i.name,
                 'price_zmw', i.price_zmw, 'image_url', i.image_url,
                 'shop_id', i.shop_id
               ) ORDER BY i.price_zmw DESC)
        FROM public.items i
        WHERE i.id = ANY (p.item_ids)
          -- An item that has since sold out drops out of the proposal rather
          -- than rendering as a gap. A suggestion is only worth making if it
          -- can still be acted on.
          AND i.is_available IS NOT FALSE
      ),
      '[]'::jsonb
    ) AS items,
    p.created_at
  FROM kithly_reco.proposals p
  WHERE p.user_id = auth.uid()
    AND p.status = 'proposed'
    AND p.expires_at > now()
    AND (p_surface IS NULL OR p.surface = p_surface)
  ORDER BY p.created_at DESC
  LIMIT 5;
END;
$$;

COMMENT ON FUNCTION public.my_proposals(text) IS
  'Open suggestions for the signed-in user, with their items joined. Empty rather than raising if the recommender is gone.';

REVOKE ALL ON FUNCTION public.my_proposals(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_proposals(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Answering one
--
-- The important half. A dismissal is the rarest signal a ranker can have, and
-- it only exists if the person can give it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.answer_proposal(p_proposal_id uuid, p_accepted boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF to_regclass('kithly_reco.proposals') IS NULL THEN
    RETURN;
  END IF;
  -- Ownership, single-answer and the signal write all live in the inner
  -- function; this adds nothing but reachability.
  PERFORM kithly_reco.respond_to_proposal(p_proposal_id, p_accepted);
END;
$$;

COMMENT ON FUNCTION public.answer_proposal(uuid, boolean) IS
  'Accept or dismiss a suggestion. Ownership and signal recording happen in kithly_reco.respond_to_proposal.';

REVOKE ALL ON FUNCTION public.answer_proposal(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.answer_proposal(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The three intent lanes
--
-- The same question asked three times at three budgets, which is the whole
-- idea: somebody choosing a present is not looking for the best item, they are
-- deciding how much this person is worth to them this year. Showing one
-- "optimal" bundle answers a question nobody asked.
--
-- Lanes are returned even when one is empty, so the caller can render the gap
-- honestly rather than silently showing two and implying there are only two.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bundle_lanes(
  p_shop_id  uuid,
  p_budgets  integer[] DEFAULT ARRAY[20000, 45000, 90000],
  p_anchor   uuid DEFAULT NULL
)
RETURNS TABLE (
  lane       integer,
  budget_zmw integer,
  total_zmw  integer,
  items      jsonb
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_budget integer;
  v_lane   integer := 0;
BEGIN
  IF to_regclass('kithly_reco.complements') IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_budget IN ARRAY COALESCE(p_budgets, ARRAY[20000, 45000, 90000]) LOOP
    v_lane := v_lane + 1;

    RETURN QUERY
    SELECT
      v_lane,
      v_budget,
      COALESCE(sum(b.price_zmw)::integer, 0),
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'id', b.item_id, 'name', b.item_name,
          'price_zmw', b.price_zmw, 'role', b.role
        ) ORDER BY b.price_zmw DESC),
        '[]'::jsonb
      )
    FROM kithly_reco.compose_bundle(p_shop_id, v_budget, p_anchor, 4) b;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.bundle_lanes(uuid, integer[], uuid) IS
  'The same shop composed at three budgets. Somebody choosing a present is deciding how much, not which.';

REVOKE ALL ON FUNCTION public.bundle_lanes(uuid, integer[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bundle_lanes(uuid, integer[], uuid)
  TO anon, authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'reco api ready';
END $$;
