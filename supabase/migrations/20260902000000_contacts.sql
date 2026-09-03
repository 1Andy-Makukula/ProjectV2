-- =============================================================================
-- Contacts — the people you send things to
--
-- WHY
-- ---
-- Gifting is social, and the app has been asking people to type a phone number
-- from memory every single time. Worse, the occasions module on the storefront
-- is a labelled mock because there is nowhere to record that somebody's
-- birthday is in nine days.
--
-- WHAT THIS IS NOT
-- ----------------
-- This is not an address-book import. Nothing here reads a phone's contacts.
-- The first two ways a row gets created are:
--
--   * derived from the caller's own order history -- people they have already
--     typed a name and number for, offered back to them to save; and
--   * typed in by hand.
--
-- A native picker may come later, but it will still write one row per person
-- the user explicitly chose. There is deliberately no path that writes a whole
-- address book, because the row below holds personal data about somebody who
-- never signed up for anything.
--
-- CONSEQUENCES OF THAT
-- --------------------
-- Every row is private to its owner. RLS is owner-only for every command --
-- there is no shared read, no merchant read, and no admin policy. An admin
-- has no business reading who a customer's mother is, and service_role
-- bypasses RLS for the operational cases that genuinely need it.
--
-- Deleting the account deletes the contacts (ON DELETE CASCADE), which is the
-- data-protection obligation as much as it is tidiness.
--
-- BIRTHDAYS
-- ---------
-- Stored as month and day, with the year optional and separate. Plenty of
-- people will happily say "the 14th of March" and not want their age recorded,
-- and a date column would have forced a year to be invented. The pair of
-- constraints below is what keeps that honest: a day cannot exist without a
-- month, and a year cannot exist without both.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  name           text NOT NULL,
  -- Normalised to E.164 by the client before it arrives, matching the format
  -- shop_orders.recipient_phone already uses, so the two can be compared.
  phone          text NOT NULL,

  /* Free text on purpose. "Mum", "my landlord", "the guy who fixes the car" --
     a fixed list of relationships would be wrong for most people by the third
     entry, and this is a label the owner reads back to themselves. */
  relationship   text,

  birth_month    smallint,
  birth_day      smallint,
  birth_year     smallint,

  /* How the row came to exist, so the UI can tell a saved recipient from a
     typed one without guessing. */
  source         text NOT NULL DEFAULT 'manual',

  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contacts_name_check  CHECK (btrim(name) <> ''),
  CONSTRAINT contacts_phone_check CHECK (btrim(phone) <> ''),
  CONSTRAINT contacts_source_check CHECK (source IN ('manual', 'order', 'import')),

  CONSTRAINT contacts_month_check CHECK (birth_month IS NULL OR birth_month BETWEEN 1 AND 12),
  CONSTRAINT contacts_year_check  CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2200),

  -- A day needs a month, and a year needs both.
  CONSTRAINT contacts_birthday_pair_check CHECK ((birth_month IS NULL) = (birth_day IS NULL)),
  CONSTRAINT contacts_birth_year_check CHECK (birth_year IS NULL OR birth_month IS NOT NULL),

  /* The day has to exist in that month. Checked against a leap year so the
     29th of February is allowed -- somebody has that birthday, and refusing it
     is the kind of small insult software should not commit. */
  CONSTRAINT contacts_day_in_month_check CHECK (
    birth_day IS NULL
    OR birth_day BETWEEN 1 AND EXTRACT(
      DAY FROM (make_date(2000, birth_month, 1) + interval '1 month - 1 day')
    )::int
  )
);

COMMENT ON TABLE public.contacts IS
  'People a user sends gifts to. Private to the owner; never imported in bulk. Birthdays are month/day with an optional year.';

-- One row per person per owner. The same number saved twice is the same
-- person, and a duplicate would show up twice in every picker.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_owner_phone_idx
  ON public.contacts (owner_user_id, phone);

-- The occasions query: everyone with a birthday, for one owner.
CREATE INDEX IF NOT EXISTS contacts_birthday_idx
  ON public.contacts (owner_user_id, birth_month, birth_day)
  WHERE birth_month IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_contact_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_touch_updated_at ON public.contacts;
CREATE TRIGGER contacts_touch_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_contact_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security — owner only, in every direction
-- ---------------------------------------------------------------------------
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_owner_all ON public.contacts;
CREATE POLICY contacts_owner_all ON public.contacts
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
