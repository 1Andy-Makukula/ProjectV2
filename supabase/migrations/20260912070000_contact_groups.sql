-- =============================================================================
-- Contact groups — a household, a church group, a department
--
-- WHY
-- ---
-- A contact is one person. Plenty of what people actually send to is not one
-- person: the household you buy groceries for, the small group you organise a
-- send-off with, the family everyone chips in for at Christmas.
--
-- Today that has to be modelled by repeating the same occasion against several
-- contacts, which then reminds you several times about one event and gives no
-- way to say "this is one thing we are doing together".
--
-- AN OCCASION NOW BELONGS TO A CONTACT **OR** A GROUP
-- --------------------------------------------------
-- The alternative was a second occasions table for groups. That would mean two
-- places to write a date, two queries in the rail, two code paths in the
-- reminder job, and eventually two answers about when something falls -- the
-- same duplication 20260904000000 was written to remove when it collapsed the
-- birthday columns into this table.
--
-- So `contact_id` becomes nullable, `group_id` appears beside it, and a CHECK
-- guarantees exactly one is set. Every existing row has a contact_id and is
-- untouched.
--
-- TWO THINGS THIS HAD TO FIX RATHER THAN BREAK
-- --------------------------------------------
-- 1. `contact_occasions_owner_all` decides ownership by joining to `contacts`
--    through contact_id. Left alone, that EXISTS is false for every group
--    occasion -- RLS would deny the owner access to rows they just created.
--
-- 2. `dispatch_occasion_reminders` INNER JOINs contacts. Left alone, group
--    occasions are silently dropped from the loop and simply never remind.
--    A silent omission rather than an error is the worse of the two bugs.
--
-- Both are rewritten below to resolve the owner and the display name from
-- whichever side is set.
--
-- SAME-OWNER INTEGRITY, DECLARED NOT TRIGGERED
-- --------------------------------------------
-- A membership row must not put one person's contact into another person's
-- group. That is enforced with composite foreign keys rather than a trigger:
-- the membership carries owner_user_id and references (id, owner_user_id) on
-- both sides, so the database rejects a mismatch structurally. A trigger can be
-- disabled; a foreign key cannot.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Composite FK targets
--
-- Redundant as keys -- id is already unique -- but a foreign key can only
-- reference a uniquely-constrained column list, and the pair is what makes the
-- same-owner guarantee below expressible.
-- ---------------------------------------------------------------------------
-- Added conditionally rather than dropped-and-recreated. On a replay the drop
-- fails outright -- contact_group_members_contact_fkey below depends on this
-- constraint, and Postgres will not drop a key another object references.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_id_owner_key'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_id_owner_key UNIQUE (id, owner_user_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The group
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  name           text NOT NULL,

  /* Free text, like contacts.relationship. "The Banda household", "choir",
     "the office" -- a label the owner reads back to themselves. */
  kind           text,

  /* What the group is for, where the name does not say it. */
  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_groups_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT contact_groups_id_owner_key UNIQUE (id, owner_user_id)
);

COMMENT ON TABLE public.contact_groups IS
  'A set of contacts treated as one thing to send to and remember: a household, a church group, a department.';

CREATE INDEX IF NOT EXISTS contact_groups_owner_idx
  ON public.contact_groups (owner_user_id);

-- ---------------------------------------------------------------------------
-- 3. Membership
--
-- owner_user_id is carried here only so the composite foreign keys can assert
-- that the group and the contact belong to the same person. It is derivable,
-- and that is fine: the point is structural enforcement, not storage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_group_members (
  group_id       uuid NOT NULL,
  contact_id     uuid NOT NULL,
  owner_user_id  uuid NOT NULL,

  added_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (group_id, contact_id),

  CONSTRAINT contact_group_members_group_fkey
    FOREIGN KEY (group_id, owner_user_id)
    REFERENCES public.contact_groups (id, owner_user_id) ON DELETE CASCADE,

  CONSTRAINT contact_group_members_contact_fkey
    FOREIGN KEY (contact_id, owner_user_id)
    REFERENCES public.contacts (id, owner_user_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.contact_group_members IS
  'Which contacts are in which group. Composite FKs make a cross-owner membership structurally impossible.';

CREATE INDEX IF NOT EXISTS contact_group_members_contact_idx
  ON public.contact_group_members (contact_id);

-- ---------------------------------------------------------------------------
-- 4. An occasion can now belong to a group
-- ---------------------------------------------------------------------------
ALTER TABLE public.contact_occasions
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE public.contact_occasions
  ADD COLUMN IF NOT EXISTS group_id uuid
    REFERENCES public.contact_groups(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.contact_occasions.group_id IS
  'Set when the occasion belongs to a group rather than one contact. Exactly one of contact_id/group_id is non-null.';

/* Exactly one subject. Neither-set would be an orphan the rail cannot label;
   both-set would be two answers to "whose occasion is this". */
ALTER TABLE public.contact_occasions
  DROP CONSTRAINT IF EXISTS contact_occasions_subject_check;
ALTER TABLE public.contact_occasions
  ADD CONSTRAINT contact_occasions_subject_check
    CHECK (num_nonnulls(contact_id, group_id) = 1);

CREATE INDEX IF NOT EXISTS contact_occasions_group_idx
  ON public.contact_occasions (group_id)
  WHERE group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.contact_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_groups_owner_all ON public.contact_groups;
CREATE POLICY contact_groups_owner_all ON public.contact_groups
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS contact_group_members_owner_all ON public.contact_group_members;
CREATE POLICY contact_group_members_owner_all ON public.contact_group_members
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

/* Rewritten, not added to. The previous body resolved ownership only through
   contact_id, so it denied every group occasion -- including to the owner who
   had just written one. */
DROP POLICY IF EXISTS contact_occasions_owner_all ON public.contact_occasions;
CREATE POLICY contact_occasions_owner_all ON public.contact_occasions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_occasions.contact_id AND c.owner_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.contact_groups g
      WHERE g.id = contact_occasions.group_id AND g.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_occasions.contact_id AND c.owner_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.contact_groups g
      WHERE g.id = contact_occasions.group_id AND g.owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. touch trigger, matching the one on contact_occasions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_contact_group_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_groups_touch ON public.contact_groups;
CREATE TRIGGER contact_groups_touch
  BEFORE UPDATE ON public.contact_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_contact_group_updated_at();

-- ---------------------------------------------------------------------------
-- 7. The reminder job learns about groups
--
-- The only substantive change is the join. It was:
--
--     JOIN public.contacts c ON c.id = o.contact_id
--
-- an INNER join, which drops every group occasion without error -- the reminder
-- simply never arrives, and nothing anywhere says why. Now both sides are LEFT
-- joined and the owner and display name come from whichever is present.
--
-- Everything else -- the 0-and-7-day window, last_reminded_on guarding repeats,
-- no catching up on missed days -- is unchanged, so the behaviour documented in
-- 20260904010000 still holds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_occasion_reminders(p_today date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sent  integer := 0;
  v_row   record;
  v_when  text;
  v_title text;
BEGIN
  FOR v_row IN
    SELECT
      o.id,
      o.kind,
      o.label,
      o.notes,
      COALESCE(c.owner_user_id, g.owner_user_id) AS owner_user_id,
      COALESCE(c.name, g.name)                   AS subject_name,
      public.occasion_next_date(o.recurrence, o.month, o.day, o.year, p_today) AS next_date
    FROM public.contact_occasions o
    LEFT JOIN public.contacts       c ON c.id = o.contact_id
    LEFT JOIN public.contact_groups g ON g.id = o.group_id
    WHERE o.last_reminded_on IS DISTINCT FROM p_today
  LOOP
    CONTINUE WHEN v_row.next_date IS NULL;
    -- Belt and braces: the CHECK makes this unreachable, but a reminder with
    -- nobody to send it to should be skipped rather than raise.
    CONTINUE WHEN v_row.owner_user_id IS NULL;
    -- A week out, and again on the day.
    CONTINUE WHEN (v_row.next_date - p_today) NOT IN (0, 7);

    v_title := COALESCE(NULLIF(btrim(COALESCE(v_row.label, '')), ''), CASE v_row.kind
      WHEN 'birthday'    THEN 'birthday'
      WHEN 'anniversary' THEN 'anniversary'
      WHEN 'wedding'     THEN 'wedding'
      WHEN 'graduation'  THEN 'graduation'
      WHEN 'new_baby'    THEN 'new baby'
      WHEN 'memorial'    THEN 'remembrance'
      WHEN 'holiday'     THEN 'holiday'
      WHEN 'groceries'   THEN 'grocery run'
      WHEN 'school_fees' THEN 'school fees'
      WHEN 'upkeep'      THEN 'upkeep'
      WHEN 'rent'        THEN 'rent'
      WHEN 'medical'     THEN 'medical appointment'
      ELSE 'occasion'
    END);

    v_when := CASE WHEN v_row.next_date = p_today THEN 'is today' ELSE 'is in a week' END;

    INSERT INTO public.notifications (user_id, message, type, reference_id)
    VALUES (
      v_row.owner_user_id,
      v_row.subject_name || '''s ' || v_title || ' ' || v_when || '.'
        || COALESCE(' ' || NULLIF(btrim(COALESCE(v_row.notes, '')), ''), ''),
      'occasion_reminder',
      v_row.id::text
    );

    UPDATE public.contact_occasions SET last_reminded_on = p_today WHERE id = v_row.id;
    v_sent := v_sent + 1;
  END LOOP;

  RAISE NOTICE 'occasion reminders written: %', v_sent;
  RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_occasion_reminders(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_occasion_reminders(date) TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'contact groups ready';
END $$;
