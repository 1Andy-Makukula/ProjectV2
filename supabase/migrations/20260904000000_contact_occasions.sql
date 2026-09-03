-- =============================================================================
-- Occasions — the dates a contact is actually about
--
-- WHY
-- ---
-- 20260902000000 gave a contact a single birthday, held as three columns on the
-- contact itself. That was enough to prove the idea and wrong as a model the
-- moment anybody had a second reason to remember somebody:
--
--   * a person has a birthday AND a graduation AND a wedding anniversary
--   * a household has a monthly grocery run, which is not a yearly date at all
--   * school fees land every term, and rent every month
--
-- None of those fit in one nullable month/day pair, and the interesting half of
-- the feature -- knowing WHY a date matters -- had nowhere to live.
--
-- ONE SOURCE, NOT TWO
-- -------------------
-- The birthday columns are backfilled into this table and then dropped. Leaving
-- them would mean two places to write a birthday and two answers when they
-- disagree, which is the bug this migration exists to avoid rather than create.
--
-- KIND IS A CLOSED LIST, LABEL IS NOT
-- -----------------------------------
-- `kind` is constrained so the data can be counted -- how many people set a
-- school-fees reminder is a question worth being able to ask. `label` carries
-- whatever someone types when nothing in the list fits, so the taxonomy never
-- becomes a cage. An 'other' occasion must have a label; the rest may add one
-- to distinguish two of the same kind ("Mum's 60th").
--
-- RECURRENCE DECIDES WHICH DATE PARTS ARE MEANINGFUL
-- --------------------------------------------------
--   annual   -- month + day, year optional (a birthday, an anniversary)
--   monthly  -- day only (groceries, rent, upkeep)
--   once     -- month + day + year (a graduation, one wedding)
--
-- The CHECK constraints below enforce exactly that, so a monthly occasion can
-- never quietly carry a January that nothing reads.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contact_occasions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,

  kind        text NOT NULL,
  /* Free text. Required for 'other', optional elsewhere. */
  label       text,

  recurrence  text NOT NULL DEFAULT 'annual',

  month       smallint,
  day         smallint,
  year        smallint,

  /* What to actually do about it: "she likes the yellow roses", "K800 to the
     bursar, not the school account". */
  notes       text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_occasions_kind_check CHECK (kind IN (
    'birthday',
    'anniversary',
    'wedding',
    'graduation',
    'new_baby',
    'memorial',
    'holiday',
    'groceries',
    'school_fees',
    'upkeep',
    'rent',
    'medical',
    'other'
  )),

  CONSTRAINT contact_occasions_recurrence_check
    CHECK (recurrence IN ('annual', 'monthly', 'once')),

  -- Anything the taxonomy does not name has to name itself.
  CONSTRAINT contact_occasions_other_needs_label
    CHECK (kind <> 'other' OR btrim(coalesce(label, '')) <> ''),

  CONSTRAINT contact_occasions_month_check CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  CONSTRAINT contact_occasions_day_check   CHECK (day BETWEEN 1 AND 31),
  CONSTRAINT contact_occasions_year_check  CHECK (year IS NULL OR year BETWEEN 1900 AND 2200),

  -- The day is the one part every recurrence needs.
  CONSTRAINT contact_occasions_day_required CHECK (day IS NOT NULL),

  CONSTRAINT contact_occasions_shape_check CHECK (
    (recurrence = 'annual'  AND month IS NOT NULL)
    OR (recurrence = 'monthly' AND month IS NULL AND year IS NULL)
    OR (recurrence = 'once'    AND month IS NOT NULL AND year IS NOT NULL)
  ),

  /* The 31st of February is not a date. Checked against a leap year so the
     29th of February survives, as it must -- people are born on it. */
  CONSTRAINT contact_occasions_day_in_month_check CHECK (
    month IS NULL
    OR day <= EXTRACT(DAY FROM (make_date(2000, month, 1) + interval '1 month - 1 day'))::int
  )
);

COMMENT ON TABLE public.contact_occasions IS
  'Dated reasons to reach a contact: birthdays, graduations, the monthly grocery run. Private to the contact owner.';

CREATE INDEX IF NOT EXISTS contact_occasions_contact_idx
  ON public.contact_occasions (contact_id);

-- The rail's query: everything recurring, ordered by where it falls.
CREATE INDEX IF NOT EXISTS contact_occasions_when_idx
  ON public.contact_occasions (recurrence, month, day);

CREATE OR REPLACE FUNCTION public.touch_contact_occasion_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_occasions_touch_updated_at ON public.contact_occasions;
CREATE TRIGGER contact_occasions_touch_updated_at
  BEFORE UPDATE ON public.contact_occasions
  FOR EACH ROW EXECUTE FUNCTION public.touch_contact_occasion_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Ownership is asked of `contacts` rather than copied onto this row. A
-- duplicated owner_user_id would be one more thing that can disagree with
-- itself, and the contact is already the thing that is owned.
-- ---------------------------------------------------------------------------
ALTER TABLE public.contact_occasions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_occasions_owner_all ON public.contact_occasions;
CREATE POLICY contact_occasions_owner_all ON public.contact_occasions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_occasions.contact_id AND c.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_occasions.contact_id AND c.owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Carry the birthdays over, then take the old columns away
-- ---------------------------------------------------------------------------
INSERT INTO public.contact_occasions (contact_id, kind, recurrence, month, day, year)
SELECT id, 'birthday', 'annual', birth_month, birth_day, birth_year
FROM public.contacts
WHERE birth_month IS NOT NULL AND birth_day IS NOT NULL;

ALTER TABLE public.contacts DROP COLUMN IF EXISTS birth_month;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS birth_day;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS birth_year;

DO $$
DECLARE
  v_moved integer;
BEGIN
  SELECT count(*) INTO v_moved FROM public.contact_occasions WHERE kind = 'birthday';
  RAISE NOTICE 'contact_occasions ready; % birthday(s) carried over', v_moved;
END $$;
