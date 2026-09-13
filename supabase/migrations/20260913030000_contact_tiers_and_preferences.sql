-- =============================================================================
-- Who someone is to you, and what they actually like
--
-- TWO WAYS OF SAYING "RELATIONSHIP", BOTH NEEDED
-- ----------------------------------------------
-- `contacts.relationship` is free text, deliberately: 20260902000000 says a
-- fixed list "would be wrong for most people by the third entry", and it is
-- right. "Mum", "my landlord", "the guy who fixes the car" are what a person
-- reads back to themselves, and no taxonomy survives contact with them.
--
-- But ranking needs something countable. An algorithm deciding how hard to
-- push a birthday cannot do anything with "the guy who fixes the car"; it needs
-- to know that a mother outranks a supplier.
--
-- So both, which is already this codebase's idiom -- occasions carry `kind`
-- plus a free `label`, holidays carry `kind` plus `name`. `relationship_tier`
-- is the closed, countable half. `relationship` stays exactly as it is and
-- remains what the UI shows.
--
-- PREFERENCES ROT, SO HALF OF THEM ARE OBSERVED
-- ---------------------------------------------
-- A declared preference is accurate the day it is typed and decays from there.
-- Sizes change, tastes change, and nobody goes back to edit a profile they
-- filled in once.
--
-- So a preference records where it came from. `declared` is what someone said.
-- `observed` is what the platform noticed -- which shops this person has
-- actually received from. The observed half costs the user nothing and is
-- never stale, and the distinction is visible so a suggestion can say "you have
-- sent from here twice" rather than claiming to know their taste.
--
-- Observed rows are derived and disposable: refresh_observed_preferences()
-- deletes and rewrites them. Declared rows are never touched by it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The countable half of a relationship
-- ---------------------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS relationship_tier text;

COMMENT ON COLUMN public.contacts.relationship_tier IS
  'Closed, countable companion to the free-text relationship. Null means unstated, which is not the same as distant.';

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_relationship_tier_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_relationship_tier_check CHECK (
    relationship_tier IS NULL OR relationship_tier IN (
      'partner',
      'immediate_family',   -- parents, children, siblings
      'family',             -- everyone else related
      'close_friend',
      'friend',
      'colleague',
      'service',            -- the landlord, the mechanic, the school
      'other'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Preferences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_preferences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid NOT NULL,

  /* Carried so RLS needs no join and so the composite key below can assert the
     contact belongs to the owner -- the same device 20260912070000 used for
     group membership. contacts_id_owner_key was added there. */
  owner_user_id  uuid NOT NULL,

  kind           text NOT NULL,

  /* What it says. For a shop preference this is the shop's name at the time,
     kept so the row still reads sensibly if the shop is later renamed or
     removed; shop_id is the live reference. */
  value          text NOT NULL,

  shop_id        uuid REFERENCES public.shops(id) ON DELETE SET NULL,

  /* declared -- somebody typed it. observed -- the platform noticed it.
     See the header for why the difference is recorded rather than flattened. */
  source         text NOT NULL DEFAULT 'declared',

  /* How many times the platform saw it. Meaningless for declared rows, which
     are true because they were stated, not because they were frequent. */
  evidence_count integer NOT NULL DEFAULT 0,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_preferences_kind_check CHECK (kind IN (
    'dietary',        -- "no pork", "diabetic"
    'size',           -- "UK 10", "size 8 shoe"
    'favourite_shop',
    'likes',
    'dislikes',
    'allergy',
    'note'
  )),

  CONSTRAINT contact_preferences_source_check CHECK (source IN ('declared', 'observed')),
  CONSTRAINT contact_preferences_value_check CHECK (btrim(value) <> ''),

  /* A shop preference must point at a shop; nothing else may. */
  CONSTRAINT contact_preferences_shop_check CHECK (
    (kind = 'favourite_shop' AND shop_id IS NOT NULL)
    OR (kind <> 'favourite_shop' AND shop_id IS NULL)
  ),

  /* Only the platform observes. A person typing something is declaring it,
     however sure they are. */
  CONSTRAINT contact_preferences_evidence_check CHECK (
    source = 'observed' OR evidence_count = 0
  ),

  /* One observed row per shop per contact, so a refresh updates rather than
     accumulates. Declared rows are not constrained this way -- somebody may
     genuinely want two notes. */
  CONSTRAINT contact_preferences_observed_shop_key
    UNIQUE (contact_id, kind, shop_id, source),

  CONSTRAINT contact_preferences_contact_fkey
    FOREIGN KEY (contact_id, owner_user_id)
    REFERENCES public.contacts (id, owner_user_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.contact_preferences IS
  'What a contact likes, needs or avoids. Declared rows are stated; observed rows are derived from real orders and refreshed.';

CREATE INDEX IF NOT EXISTS contact_preferences_contact_idx
  ON public.contact_preferences (contact_id, kind);

ALTER TABLE public.contact_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_preferences_owner_all ON public.contact_preferences;
CREATE POLICY contact_preferences_owner_all ON public.contact_preferences
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.touch_contact_preference_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_preferences_touch ON public.contact_preferences;
CREATE TRIGGER contact_preferences_touch
  BEFORE UPDATE ON public.contact_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_contact_preference_updated_at();

-- ---------------------------------------------------------------------------
-- 3. The observed half
--
-- Which shops this person has actually received from, counted from collected
-- orders. Matching is on phone number, which is how contacts and recipients
-- already line up: contacts.phone and shop_orders.recipient_phone are both
-- E.164 by the time they are stored.
--
-- Only REDEEMED orders count. An order that was placed and never collected
-- says something about the sender, not about what the recipient likes.
--
-- SECURITY DEFINER because it reads shop_orders across the platform to answer
-- a question about one owner's contact, but it is scoped to contacts that
-- owner holds and writes nothing outside them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_observed_preferences(p_contact_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_phone text;
  v_count integer := 0;
BEGIN
  SELECT owner_user_id, phone INTO v_owner, v_phone
  FROM public.contacts WHERE id = p_contact_id;

  IF v_owner IS NULL THEN
    RETURN 0;
  END IF;

  -- Only the caller's own contacts, even though this runs as definer.
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_owner THEN
    RAISE EXCEPTION 'not your contact';
  END IF;

  -- Derived rows are disposable. Declared rows are never touched.
  DELETE FROM public.contact_preferences
  WHERE contact_id = p_contact_id AND source = 'observed';

  INSERT INTO public.contact_preferences
    (contact_id, owner_user_id, kind, value, shop_id, source, evidence_count)
  SELECT
    p_contact_id,
    v_owner,
    'favourite_shop',
    s.name,
    s.id,
    'observed',
    count(*)::integer
  FROM public.shop_orders so
  JOIN public.shops s ON s.id = so.shop_id
  WHERE so.recipient_phone = v_phone
    AND so.claim_status = 'REDEEMED'
  GROUP BY s.id, s.name
  HAVING count(*) >= 1;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_observed_preferences(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_observed_preferences(uuid) TO authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'contact tiers and preferences ready';
END $$;
