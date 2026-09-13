-- =============================================================================
-- The calendar — countries, and the days a country stops for
--
-- WHY
-- ---
-- `contact_occasions` records the dates a person is about. Nothing records the
-- dates a *country* is about, and those matter for the same reason: Independence
-- Day, Christmas, the start of a school term and month-end payday all move
-- demand, and all of them arrive for everybody on the same morning.
--
-- Shared dates do something a personal date cannot. They synchronise. A rail
-- that says "Independence is on Friday" says it to every shopper at once, which
-- is the only way a small platform manufactures the feeling of a crowd.
--
-- ONE DATE ENGINE, AND WHY THIS MIGRATION ADDS NO FUNCTION
-- -------------------------------------------------------
-- `occasion_next_date(recurrence, month, day, year, today)` already answers
-- "when does this next fall". It was written for occasions but takes raw date
-- parts rather than an occasion row, so a holiday flows through it unchanged.
--
-- That is deliberate and load-bearing: holidays reuse the occasion vocabulary
-- EXACTLY -- the same three recurrences, the same roll-forward for a day that
-- does not exist in its month, the same leap-year handling. Two date engines
-- that disagree about when Christmas falls is the bug this avoids by not
-- creating the second engine.
--
-- The client half is already shared too: `daysUntil()` in types/contacts.ts
-- takes { recurrence, month, day, year }, so a holiday shaped like an occasion
-- needs no second implementation there either.
--
-- WHY A COUNTRY TABLE AND NOT A `country` TEXT COLUMN
-- --------------------------------------------------
-- Currency and timezone hang off a country, and both are already needed. FX
-- carries a supported-currency list; a country is how a shopper's default
-- currency should eventually be chosen rather than guessed. A text column would
-- scatter those facts across every row that repeats the country name.
--
-- REFERENCE DATA, NOT USER DATA
-- -----------------------------
-- Both tables are world facts. Everyone reads them, including signed-out
-- visitors -- the storefront shows what is coming up before anybody logs in.
-- Nobody but an admin writes them.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.countries (
  /* ISO 3166-1 alpha-2, which is the join key everything else already speaks. */
  code        text PRIMARY KEY,
  name        text NOT NULL,

  /* ISO 4217. Nullable because a country is worth listing before its currency
     is supported for payment -- the diaspora sends from places KithLy cannot
     yet charge in. */
  currency    text,

  /* IANA zone. Needed before any reminder can claim to fire "on the day":
     the day depends on where the reader is, not where the server is. */
  timezone    text,

  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT countries_code_check CHECK (code ~ '^[A-Z]{2}$'),
  CONSTRAINT countries_currency_check CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

COMMENT ON TABLE public.countries IS
  'Reference list of countries, their currency and timezone. World facts: public read, admin write.';

CREATE TABLE IF NOT EXISTS public.holidays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code  text NOT NULL REFERENCES public.countries(code) ON DELETE CASCADE,

  name          text NOT NULL,

  /* Closed list so it can be counted and filtered -- "show me school dates"
     is a question a parent's rail should be able to ask. */
  kind          text NOT NULL DEFAULT 'civic',

  /* The same three words `contact_occasions` uses, on purpose. See the header. */
  recurrence    text NOT NULL DEFAULT 'annual',

  month         smallint,
  day           smallint,
  year          smallint,

  /* What the day actually means for shopping, where that is not obvious from
     the name. Read by the rail, not by the date maths. */
  notes         text,

  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT holidays_kind_check CHECK (kind IN (
    'civic',       -- Independence, Youth Day
    'religious',   -- Christmas, Eid
    'school',      -- term starts, exam periods
    'commercial',  -- Black Friday, Valentines
    'financial'    -- payday, month-end
  )),

  CONSTRAINT holidays_recurrence_check
    CHECK (recurrence IN ('annual', 'monthly', 'once')),

  CONSTRAINT holidays_month_check CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  CONSTRAINT holidays_day_check   CHECK (day BETWEEN 1 AND 31),
  CONSTRAINT holidays_year_check  CHECK (year IS NULL OR year BETWEEN 1900 AND 2200),
  CONSTRAINT holidays_day_required CHECK (day IS NOT NULL),

  /* Identical in shape to contact_occasions_shape_check. If one is ever
     relaxed the other has to be, or the shared date engine starts receiving
     rows one of its callers guarantees are impossible. */
  CONSTRAINT holidays_shape_check CHECK (
    (recurrence = 'annual'  AND month IS NOT NULL)
    OR (recurrence = 'monthly' AND month IS NULL AND year IS NULL)
    OR (recurrence = 'once'    AND month IS NOT NULL AND year IS NOT NULL)
  ),

  /* The 31st of February is not a date. Checked against a leap year so the
     29th survives -- Zambia's calendar has no 29 February entry today, but a
     once-off date in a leap year is a legitimate thing to record. */
  CONSTRAINT holidays_day_in_month_check CHECK (
    month IS NULL
    OR day <= EXTRACT(DAY FROM (make_date(2000, month, 1) + interval '1 month - 1 day'))::int
  ),

  /* One entry per named day per country per year. Re-seeding tops up rather
     than duplicating, the same way the category seed does. NULLS NOT DISTINCT
     so two annual entries of the same name collide as intended -- without it,
     year IS NULL would make every re-run insert a fresh duplicate. */
  CONSTRAINT holidays_country_name_key UNIQUE NULLS NOT DISTINCT (country_code, name, year)
);

COMMENT ON TABLE public.holidays IS
  'Dates a country stops for. Shares the recurrence vocabulary and date engine with contact_occasions.';

COMMENT ON COLUMN public.holidays.recurrence IS
  'annual | monthly | once -- the same three rules occasion_next_date() applies to a personal occasion.';

-- The rail's query: what is coming up, for one country.
CREATE INDEX IF NOT EXISTS holidays_country_when_idx
  ON public.holidays (country_code, recurrence, month, day)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Read is open to anon as well as authenticated: the storefront shows what is
-- coming up before anybody has signed in, and these are world facts rather than
-- anybody's data. Writes are admin-only, matching how `categories` is governed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS countries_read ON public.countries;
CREATE POLICY countries_read ON public.countries
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS countries_admin_write ON public.countries;
CREATE POLICY countries_admin_write ON public.countries
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS holidays_read ON public.holidays;
CREATE POLICY holidays_read ON public.holidays
  FOR SELECT TO anon, authenticated USING (is_active);

DROP POLICY IF EXISTS holidays_admin_write ON public.holidays;
CREATE POLICY holidays_admin_write ON public.holidays
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Seed: Zambia first, plus the countries the diaspora sends from
--
-- Idempotent on the natural keys. A country an admin has since edited, or a
-- holiday they have renamed or deactivated, is left exactly as it is.
-- ---------------------------------------------------------------------------
INSERT INTO public.countries (code, name, currency, timezone) VALUES
  ('ZM', 'Zambia',         'ZMW', 'Africa/Lusaka'),
  ('ZA', 'South Africa',   'ZAR', 'Africa/Johannesburg'),
  ('GB', 'United Kingdom', 'GBP', 'Europe/London'),
  ('US', 'United States',  'USD', 'America/New_York'),
  ('AU', 'Australia',      'AUD', 'Australia/Sydney'),
  ('CA', 'Canada',         'CAD', 'America/Toronto')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.holidays (country_code, name, kind, recurrence, month, day, notes) VALUES
  ('ZM', 'New Year''s Day',            'civic',     'annual', 1,  1,  NULL),
  ('ZM', 'School term one begins',     'school',    'annual', 1,  8,  'Uniforms, stationery and fees land together. The heaviest school week of the year.'),
  ('ZM', 'International Women''s Day', 'civic',     'annual', 3,  8,  NULL),
  ('ZM', 'Youth Day',                  'civic',     'annual', 3,  12, NULL),
  ('ZM', 'Kenneth Kaunda Day',         'civic',     'annual', 4,  28, NULL),
  ('ZM', 'Labour Day',                 'civic',     'annual', 5,  1,  NULL),
  ('ZM', 'Africa Freedom Day',         'civic',     'annual', 5,  25, NULL),
  ('ZM', 'School term two begins',     'school',    'annual', 5,  6,  NULL),
  ('ZM', 'Heroes Day',                 'civic',     'annual', 7,  6,  'Falls with Unity Day. A long weekend, and the braai weekend of the winter.'),
  ('ZM', 'Unity Day',                  'civic',     'annual', 7,  7,  NULL),
  ('ZM', 'Farmers Day',                'civic',     'annual', 8,  5,  NULL),
  ('ZM', 'School term three begins',   'school',    'annual', 9,  9,  NULL),
  ('ZM', 'National Prayer Day',        'religious', 'annual', 10, 18, NULL),
  ('ZM', 'Independence Day',           'civic',     'annual', 10, 24, 'The biggest shared date in the calendar. Everything moves.'),
  ('ZM', 'Christmas Day',              'religious', 'annual', 12, 25, 'Gifting peaks about a week out, which is where the reminder window already sits.'),
  ('ZM', 'Month end',                  'financial', 'monthly', NULL, 25, 'Payday for most salaried workers. Restocking and school fees follow it.')
ON CONFLICT (country_code, name, year) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'countries and holidays ready: % countries, % holidays',
    (SELECT count(*) FROM public.countries),
    (SELECT count(*) FROM public.holidays);
END $$;
