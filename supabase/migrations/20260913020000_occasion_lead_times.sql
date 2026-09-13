-- =============================================================================
-- Reminders arrive when you can still do something, and they arrive able to act
--
-- WHY NOT ONE SET OF WINDOWS
-- --------------------------
-- The job fires at seven days and on the day, for everything. Two tiers, one
-- rule, thirteen kinds of occasion -- and the rule is wrong for most of them.
--
-- A wedding needs about six weeks: there is an outfit, possibly travel, and a
-- present people expect to be considered. School fees need a month, because
-- people save for them rather than buy them. A monthly grocery run needs two
-- days; telling somebody a fortnight early that they will need groceries is
-- noise, and noise is how a reminder system becomes the reason an app gets
-- muted.
--
-- So lead times belong to the kind, in a table an admin can retune without a
-- deploy -- the same shape the recommender's weights will take later.
--
-- AND TO THE OCCASION, WHERE SOMEBODY DISAGREES
-- ---------------------------------------------
-- `contact_occasions.lead_days` overrides the kind's default for one occasion.
-- Somebody who wants two months' warning about their mother's birthday is not
-- wrong, and a closed rule that cannot express that is.
--
-- WHAT DOES NOT CHANGE
-- --------------------
-- No catching up. The original migration is explicit that a job which did not
-- run for three days must not then announce three days of missed birthdays,
-- because being told late is worse than not being told. Tiering makes that
-- easier to get wrong -- a missed fourteen-day window must not fire at twelve
-- and call itself a fortnight's warning -- so the match stays exact.
--
-- last_reminded_on still guards against sending twice in one day, which means
-- an occasion whose windows collide on one date is announced once. That is the
-- correct behaviour and not a rounding error: one day, one reminder.
--
-- REMINDERS THAT DO SOMETHING
-- ---------------------------
-- Now that notifications carry actions, a reminder stops being a sentence you
-- have to act on from memory. Every one offers the paths that make sense for
-- its subject: open the person, see what suits the occasion, and -- for a
-- group -- open the group instead.
-- =============================================================================

-- Shape guard for a lead-time array, used by both the kind defaults and the
-- per-occasion override so the two can never disagree about what is valid.
--
-- A function because a CHECK constraint may not contain a subquery, and
-- "every element is in range" needs one. Same reasoning as
-- notification_actions_valid() in 20260913000000.
--
-- A negative lead is a reminder after the fact, which this system deliberately
-- never sends. 180 days is past the point where anybody acts on a nudge.
CREATE OR REPLACE FUNCTION public.lead_days_valid(p_days integer[])
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT p_days IS NULL
      OR (
        array_length(p_days, 1) BETWEEN 1 AND 4
        AND array_position(p_days, NULL) IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM unnest(p_days) AS d WHERE d < 0 OR d > 180
        )
      );
$$;

COMMENT ON FUNCTION public.lead_days_valid(integer[]) IS
  'Shape guard for reminder lead times: 1-4 entries, no nulls, each between 0 and 180 days.';

CREATE TABLE IF NOT EXISTS public.occasion_lead_times (
  kind        text PRIMARY KEY,

  /* Days before the date to send, largest first by convention. Always ends in
     0: the day itself is the one window every occasion wants. */
  lead_days   integer[] NOT NULL,

  /* Why these numbers, for whoever retunes them later. */
  rationale   text,

  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT occasion_lead_times_kind_check CHECK (kind IN (
    'birthday', 'anniversary', 'wedding', 'graduation', 'new_baby',
    'memorial', 'holiday', 'groceries', 'school_fees', 'upkeep',
    'rent', 'medical', 'other'
  )),

  CONSTRAINT occasion_lead_times_shape_check
    CHECK (public.lead_days_valid(lead_days))
);

COMMENT ON TABLE public.occasion_lead_times IS
  'How far ahead each kind of occasion is worth mentioning. Retunable without a deploy.';

ALTER TABLE public.occasion_lead_times ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS occasion_lead_times_read ON public.occasion_lead_times;
CREATE POLICY occasion_lead_times_read ON public.occasion_lead_times
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS occasion_lead_times_admin_write ON public.occasion_lead_times;
CREATE POLICY occasion_lead_times_admin_write ON public.occasion_lead_times
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

INSERT INTO public.occasion_lead_times (kind, lead_days, rationale) VALUES
  ('birthday',    ARRAY[14, 3, 0], 'Two weeks to think, three days to order, and the day itself.'),
  ('anniversary', ARRAY[14, 3, 0], 'As a birthday. Often a booking rather than a parcel.'),
  ('wedding',     ARRAY[42, 14, 3], 'Six weeks: an outfit, possibly travel, and a present people expect to be considered.'),
  ('graduation',  ARRAY[21, 7, 0],  'Three weeks. Often coordinated between several people.'),
  ('new_baby',    ARRAY[14, 3, 0],  'The date moves, so an early nudge matters more than a precise one.'),
  ('memorial',    ARRAY[7, 0],      'Quiet and close. An early reminder of a death is not a kindness.'),
  ('holiday',     ARRAY[21, 7, 0],  'Shared dates: everybody is shopping at once, so early is the whole advantage.'),
  ('groceries',   ARRAY[2, 0],      'A fortnight of warning about groceries is noise.'),
  ('school_fees', ARRAY[30, 7, 0],  'A month, because fees are saved for rather than bought.'),
  ('upkeep',      ARRAY[7, 0],      'Routine. Enough time to arrange someone.'),
  ('rent',        ARRAY[7, 3, 0],   'Money that has to be found, not chosen.'),
  ('medical',     ARRAY[7, 1],      'A day before rather than the morning of, so it can be rearranged.'),
  ('other',       ARRAY[7, 0],      'The old default, kept for anything the taxonomy does not name.')
ON CONFLICT (kind) DO NOTHING;

-- Per-occasion override.
ALTER TABLE public.contact_occasions
  ADD COLUMN IF NOT EXISTS lead_days integer[];

COMMENT ON COLUMN public.contact_occasions.lead_days IS
  'Overrides the kind default from occasion_lead_times for this one occasion. Null means use the default.';

ALTER TABLE public.contact_occasions
  DROP CONSTRAINT IF EXISTS contact_occasions_lead_days_check;
ALTER TABLE public.contact_occasions
  ADD CONSTRAINT contact_occasions_lead_days_check
    CHECK (public.lead_days_valid(lead_days));

-- ---------------------------------------------------------------------------
-- The job
--
-- Third definition of this function. 20260904010000 wrote it; 20260912070000
-- taught it about groups by replacing the INNER JOIN that silently dropped
-- them. Both of those behaviours are preserved here -- the LEFT JOINs and the
-- COALESCEd owner and name are unchanged. What is new is the window lookup and
-- the actions.
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
  v_days  integer;
BEGIN
  FOR v_row IN
    SELECT
      o.id,
      o.kind,
      o.label,
      o.notes,
      o.contact_id,
      o.group_id,
      COALESCE(c.owner_user_id, g.owner_user_id) AS owner_user_id,
      COALESCE(c.name, g.name)                   AS subject_name,
      COALESCE(o.lead_days, lt.lead_days, ARRAY[7, 0]) AS windows,
      public.occasion_next_date(o.recurrence, o.month, o.day, o.year, p_today) AS next_date
    FROM public.contact_occasions o
    LEFT JOIN public.contacts             c  ON c.id = o.contact_id
    LEFT JOIN public.contact_groups       g  ON g.id = o.group_id
    LEFT JOIN public.occasion_lead_times  lt ON lt.kind = o.kind
    WHERE o.last_reminded_on IS DISTINCT FROM p_today
  LOOP
    CONTINUE WHEN v_row.next_date IS NULL;
    CONTINUE WHEN v_row.owner_user_id IS NULL;

    v_days := v_row.next_date - p_today;

    -- Exact match only. A missed fourteen-day window does not fire at twelve
    -- and call itself a fortnight's warning. See the header.
    CONTINUE WHEN NOT (v_days = ANY (v_row.windows));

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

    /* Said the way a person would say it, rather than "in 0 days". */
    v_when := CASE
      WHEN v_days = 0  THEN 'is today'
      WHEN v_days = 1  THEN 'is tomorrow'
      WHEN v_days < 14 THEN 'is in ' || v_days || ' days'
      WHEN v_days < 21 THEN 'is in a fortnight'
      ELSE 'is in ' || round(v_days / 7.0) || ' weeks'
    END;

    INSERT INTO public.notifications (user_id, message, type, reference_id, actions)
    VALUES (
      v_row.owner_user_id,
      -- The note is the useful half: "she likes the yellow roses" is what
      -- turns a reminder into something you can act on without thinking.
      v_row.subject_name || '''s ' || v_title || ' ' || v_when || '.'
        || COALESCE(' ' || NULLIF(btrim(COALESCE(v_row.notes, '')), ''), ''),
      'occasion_reminder',
      v_row.id::text,
      CASE
        WHEN v_row.contact_id IS NOT NULL THEN jsonb_build_array(
          jsonb_build_object('type', 'open_contact', 'label', 'Open ' || v_row.subject_name,
                             'contact_id', v_row.contact_id),
          jsonb_build_object('type', 'browse_for_occasion', 'label', 'Find something',
                             'occasion_kind', v_row.kind, 'contact_id', v_row.contact_id)
        )
        ELSE jsonb_build_array(
          jsonb_build_object('type', 'open_group', 'label', 'Open ' || v_row.subject_name,
                             'group_id', v_row.group_id),
          jsonb_build_object('type', 'browse_for_occasion', 'label', 'Find something',
                             'occasion_kind', v_row.kind, 'group_id', v_row.group_id)
        )
      END
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
  RAISE NOTICE 'occasion lead times ready';
END $$;
