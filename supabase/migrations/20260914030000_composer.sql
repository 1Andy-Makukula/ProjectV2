-- =============================================================================
-- The Composer — things that go together, at a price somebody has
--
-- RANKING AND COMPOSITION ARE DIFFERENT PROBLEMS
-- ----------------------------------------------
-- The Slate (Stage 6) answers "which twelve items are worth showing". That is a
-- sort. This answers "which four things go together and come to K380", which is
-- a constrained selection -- and no amount of sorting produces it, because the
-- value of an item here depends on what else is already in the set.
--
-- Λ: WHAT GOES WITH WHAT
-- ----------------------
-- A category-to-category matrix. Cake goes with candles; braai meat goes with
-- charcoal; a uniform goes with stationery. Hand-seeded, because at this
-- catalogue size co-purchase data is too thin to learn from and a wrong
-- suggestion is worse than none -- and because these particular pairings are
-- local knowledge that no general model has.
--
-- It is a table rather than code so it can be corrected without a deploy, the
-- same as occasion_lead_times and, later, the Slate's weights. `source` records
-- whether a row was seeded or learned, so the learned half can be recomputed
-- without destroying the hand-written half.
--
-- ONE SHOP PER BUNDLE, WHICH IS A KITHLY-SPECIFIC RULE
-- ----------------------------------------------------
-- Every other marketplace composes across its whole catalogue because delivery
-- makes the seller irrelevant. Here a bundle is COLLECTED: one shop is one
-- journey, one conversation, one claim code. A four-item bundle spanning four
-- shops is four trips across Lusaka, which is a worse gift however well chosen.
--
-- So composition is per shop and the caller picks the best shop, rather than
-- composing globally and hoping. This falls straight out of escrow and is not
-- available to anyone without it.
--
-- ROLES, SO A BUNDLE IS NOT THREE OF THE SAME THING
-- -------------------------------------------------
-- Greedy value-filling inside a budget produces three cakes. A bundle wants a
-- shape: something that is the point of it, something that gets used up, and
-- something small. Roles are assigned by price rank within the chosen set,
-- which is crude and works -- and is explainable, which matters more here than
-- being optimal.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Λ
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kithly_reco.complements (
  from_category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  to_category_id   uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,

  /* How strongly the second belongs with the first. Directional on purpose:
     candles belong with a cake far more than a cake belongs with candles. */
  strength         numeric NOT NULL,

  source           text NOT NULL DEFAULT 'seeded',
  updated_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (from_category_id, to_category_id),
  CONSTRAINT complements_strength_check CHECK (strength > 0 AND strength <= 1),
  CONSTRAINT complements_source_check CHECK (source IN ('seeded', 'learned')),
  CONSTRAINT complements_not_self CHECK (from_category_id <> to_category_id)
);

COMMENT ON TABLE kithly_reco.complements IS
  'Lambda: which categories belong together, directionally. Hand-seeded now, learnable later without losing the seeds.';

ALTER TABLE kithly_reco.complements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS complements_read ON kithly_reco.complements;
CREATE POLICY complements_read ON kithly_reco.complements
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS complements_admin_write ON kithly_reco.complements;
CREATE POLICY complements_admin_write ON kithly_reco.complements
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

/* Seeded by slug, not id: slugs are stable and readable, and a seed keyed on
   uuids would be unreviewable. Anything whose categories are not present is
   skipped rather than failing the migration -- the taxonomy is seeded
   separately and may legitimately differ. */
INSERT INTO kithly_reco.complements (from_category_id, to_category_id, strength)
SELECT f.id, t.id, v.strength
FROM (VALUES
  -- A celebration
  ('bakery-cakes',      'snacks-confectionery', 0.75),
  ('bakery-cakes',      'beverages',            0.65),
  ('bakery-cakes',      'home-decor',           0.40),
  -- A braai, which in Zambia is its own event
  ('meat-poultry',      'beverages',            0.80),
  ('meat-poultry',      'spices-condiments',    0.70),
  ('meat-poultry',      'fresh-produce',        0.60),
  ('meat-poultry',      'snacks-confectionery', 0.45),
  -- Back to school
  ('school-supplies',   'childrenswear',        0.70),
  ('school-supplies',   'shoes',                0.55),
  ('school-supplies',   'bags-luggage',         0.65),
  -- A new baby
  ('baby-clothing',     'nappies-wipes',        0.85),
  ('baby-clothing',     'toys-games',           0.55),
  ('nappies-wipes',     'baby-food',            0.60),
  -- Self care, and what is bought beside it
  ('hair-salon',        'hair-care-products',   0.70),
  ('spa-massage',       'skin-care',            0.65),
  ('cosmetics',         'fragrances',           0.55),
  -- Setting up a home
  ('furniture',         'bedding-linen',        0.65),
  ('furniture',         'home-decor',           0.60),
  ('kitchenware',       'cleaning-supplies',    0.50),
  ('bedding-linen',     'curtains-blinds',      0.55),
  -- A meal, catered
  ('catering',          'beverages',            0.75),
  ('catering',          'bakery-cakes',         0.50),
  -- Traditional attire and the work around it
  ('fabric-textiles',   'tailoring-alterations', 0.85),
  ('traditional-attire', 'fashion-accessories',  0.55),
  -- Staying powered
  ('mobile-phones',     'phone-accessories',    0.80),
  ('solar-power',       'tools-hardware',       0.45)
) AS v(from_slug, to_slug, strength)
JOIN public.categories f ON f.slug = v.from_slug
JOIN public.categories t ON t.slug = v.to_slug
ON CONFLICT (from_category_id, to_category_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Composition
--
-- Greedy, per shop, inside a budget, shaped by roles. Deliberately not an
-- optimiser: an exact knapsack over a few hundred items would be affordable and
-- would produce sets nobody can explain, and "why is this in my bundle" is a
-- question this has to be able to answer.
--
-- SECURITY INVOKER so items_public_read decides what is visible. A definer here
-- would compose bundles out of unavailable stock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kithly_reco.compose_bundle(
  p_shop_id       uuid,
  p_budget_zmw    integer,
  p_anchor_category uuid DEFAULT NULL,
  p_max_items     integer DEFAULT 4
)
RETURNS TABLE (
  item_id    uuid,
  item_name  text,
  price_zmw  integer,
  role       text,
  affinity   numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = kithly_reco, public
AS $$
DECLARE
  v_spent  integer := 0;
  v_count  integer := 0;
  v_row    record;
  v_picked uuid[] := '{}';
  v_cats   uuid[] := '{}';
BEGIN
  IF p_budget_zmw IS NULL OR p_budget_zmw <= 0 THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT
      i.id,
      i.name,
      i.price_zmw,
      i.category_id,
      /* How well this belongs beside the anchor. Items in the anchor's own
         category score 1 -- they are the thing itself -- and everything else
         is scored by Lambda. Unrelated items still appear, weakly, because a
         shop may simply not stock the complement. */
      COALESCE(
        CASE WHEN i.category_id = p_anchor_category THEN 1.0 ELSE NULL END,
        (SELECT c.strength FROM kithly_reco.complements c
          WHERE c.from_category_id = p_anchor_category
            AND c.to_category_id = i.category_id),
        0.15
      )::numeric AS affinity
    FROM public.items i
    WHERE i.shop_id = p_shop_id
      AND i.is_available IS NOT FALSE
      AND i.is_quote_only IS NOT TRUE
      AND i.price_zmw > 0
      AND i.price_zmw <= p_budget_zmw
    ORDER BY affinity DESC, i.price_zmw DESC
  LOOP
    EXIT WHEN v_count >= p_max_items;
    CONTINUE WHEN v_spent + v_row.price_zmw > p_budget_zmw;

    /* One item per category. Without this the greedy pass returns three cakes,
       which is the failure mode roles exist to prevent. A shop with only one
       category still yields a single sensible item rather than a heap. */
    CONTINUE WHEN v_row.category_id IS NOT NULL AND v_row.category_id = ANY (v_cats);

    v_picked := v_picked || v_row.id;
    IF v_row.category_id IS NOT NULL THEN
      v_cats := v_cats || v_row.category_id;
    END IF;
    v_spent := v_spent + v_row.price_zmw;
    v_count := v_count + 1;
  END LOOP;

  /* A bundle of one is not a bundle; it is an item, and the caller already had
     a way to show one of those. */
  IF v_count < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.name,
    i.price_zmw,
    /* Roles by price rank within the chosen set: the dearest is what the
       bundle is about, the cheapest is the small extra, the rest fill it out. */
    CASE
      WHEN row_number() OVER (ORDER BY i.price_zmw DESC) = 1 THEN 'centrepiece'
      WHEN row_number() OVER (ORDER BY i.price_zmw ASC) = 1 THEN 'extra'
      ELSE 'supporting'
    END,
    COALESCE(
      CASE WHEN i.category_id = p_anchor_category THEN 1.0 ELSE NULL END,
      (SELECT c.strength FROM kithly_reco.complements c
        WHERE c.from_category_id = p_anchor_category
          AND c.to_category_id = i.category_id),
      0.15
    )::numeric
  FROM public.items i
  WHERE i.id = ANY (v_picked)
  ORDER BY i.price_zmw DESC;
END;
$$;

COMMENT ON FUNCTION kithly_reco.compose_bundle(uuid, integer, uuid, integer) IS
  'A set of items from ONE shop inside a budget, shaped by Lambda and by role. One shop because a bundle is collected, not delivered.';

REVOKE ALL ON FUNCTION kithly_reco.compose_bundle(uuid, integer, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kithly_reco.compose_bundle(uuid, integer, uuid, integer)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Proposals
--
-- A suggestion with a life. The reason it is a row rather than a render is the
-- dismissal: explicit negative feedback is the rarest and most valuable signal
-- a recommender can have, and it only exists if there is something to record it
-- against.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kithly_reco.proposals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  kind         text NOT NULL,
  surface      text NOT NULL,

  /* What it is about: an occasion, a list, a shop. Loose because the subject
     differs per kind and nothing load-bearing reads it. */
  subject      jsonb NOT NULL DEFAULT '{}'::jsonb,

  item_ids     uuid[] NOT NULL,
  total_zmw    integer,

  /* The sentence shown. Stored rather than recomputed so the reason a person
     was given cannot change under them between seeing it and acting on it. */
  reason_code  text NOT NULL,
  reason_text  text NOT NULL,

  status       text NOT NULL DEFAULT 'proposed',

  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '14 days',

  CONSTRAINT proposals_kind_check CHECK (kind IN ('bundle', 'restock', 'occasion', 'complement')),
  CONSTRAINT proposals_status_check CHECK (status IN ('proposed', 'accepted', 'dismissed', 'expired')),
  CONSTRAINT proposals_items_check CHECK (array_length(item_ids, 1) >= 1),
  CONSTRAINT proposals_reason_check CHECK (btrim(reason_text) <> ''),
  /* A response has a time, and an unanswered proposal has none. */
  CONSTRAINT proposals_responded_check CHECK (
    (status IN ('proposed', 'expired') AND responded_at IS NULL)
    OR (status IN ('accepted', 'dismissed') AND responded_at IS NOT NULL)
  )
);

COMMENT ON TABLE kithly_reco.proposals IS
  'Suggestions with a lifecycle. Dismissals are the point: explicit negative feedback is the rarest signal a ranker can get.';

CREATE INDEX IF NOT EXISTS proposals_user_open_idx
  ON kithly_reco.proposals (user_id, created_at DESC)
  WHERE status = 'proposed';

ALTER TABLE kithly_reco.proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposals_owner_read ON kithly_reco.proposals;
CREATE POLICY proposals_owner_read ON kithly_reco.proposals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

/* A person may answer their own proposal and nothing else. They may not write
   one -- proposals come from the platform, and a client that could insert them
   could also fabricate the evidence the ranker learns from. */
DROP POLICY IF EXISTS proposals_owner_respond ON kithly_reco.proposals;
CREATE POLICY proposals_owner_respond ON kithly_reco.proposals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'proposed')
  WITH CHECK (user_id = auth.uid() AND status IN ('accepted', 'dismissed'));

-- ---------------------------------------------------------------------------
-- 4. Answering one
--
-- Through an RPC rather than a bare update, so the response time is stamped by
-- the database and a dismissal is recorded as a signal in the same transaction.
-- A dismissal that failed to leave a trace would be the one thing this feature
-- exists to capture, lost.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kithly_reco.respond_to_proposal(
  p_proposal_id uuid,
  p_accepted    boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kithly_reco, public
AS $$
DECLARE
  v_user uuid;
  v_items uuid[];
  v_status text;
BEGIN
  SELECT user_id, item_ids, status INTO v_user, v_items, v_status
  FROM kithly_reco.proposals WHERE id = p_proposal_id FOR UPDATE;

  IF v_user IS NULL THEN RAISE EXCEPTION 'no such proposal'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    RAISE EXCEPTION 'not your proposal';
  END IF;
  -- Answering twice is not an error worth raising on, but it must not
  -- overwrite the first answer or double-count the signal.
  IF v_status <> 'proposed' THEN RETURN; END IF;

  UPDATE kithly_reco.proposals
     SET status = CASE WHEN p_accepted THEN 'accepted' ELSE 'dismissed' END,
         responded_at = now()
   WHERE id = p_proposal_id;

  INSERT INTO kithly_reco.signals (user_id, surface, action, subject_type, subject_id, context)
  SELECT
    v_user,
    'proposal',
    CASE WHEN p_accepted THEN 'save' ELSE 'dismiss' END,
    'item',
    unnest(v_items),
    jsonb_build_object('proposal_id', p_proposal_id);
END;
$$;

REVOKE ALL ON FUNCTION kithly_reco.respond_to_proposal(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kithly_reco.respond_to_proposal(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Letting unanswered proposals lapse
--
-- Not deleted. An ignored proposal is evidence too -- weaker than a dismissal
-- and worth more than nothing -- and deleting it would make the ranker's
-- accepted-to-shown ratio a lie.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kithly_reco.expire_proposals()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kithly_reco, public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE kithly_reco.proposals
     SET status = 'expired'
   WHERE status = 'proposed' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION kithly_reco.expire_proposals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION kithly_reco.expire_proposals() TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'composer ready: % complement pairs seeded',
    (SELECT count(*) FROM kithly_reco.complements);
END $$;
