-- =============================================================================
-- Journeys — a list can be read as a storyboard, and each stop can be spoken to
--
-- WHY
-- ---
-- A list is already a sequence of things across several shops. What it has
-- never been able to say is WHY any of them are on it. "Everything for a braai"
-- is a shopping list; "start at the butcher, ask for the thick cut, then the
-- shop two doors down has the charcoal" is a journey somebody would actually
-- follow -- and would send to a friend.
--
-- The difference is one column of prose per entry, and one column on the list
-- saying how to render it.
--
-- WHY A TEMPLATE COLUMN RATHER THAN A NEW TABLE
-- ---------------------------------------------
-- A journey is not a different object from a list. It is the same rows, read
-- differently. Modelling it separately would mean two things to save to, two
-- things to share, two things to buy from, and a migration path between them
-- for anybody who changed their mind. A template is a view of the data, so
-- switching it is instant and loses nothing.
-- =============================================================================

ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT 'standard';

ALTER TABLE public.lists DROP CONSTRAINT IF EXISTS lists_template_check;
ALTER TABLE public.lists
  ADD CONSTRAINT lists_template_check CHECK (template IN ('standard', 'storyboard'));

COMMENT ON COLUMN public.lists.template IS
  'How the list is read: standard (pictures, prices, a running total) or storyboard (a paper journey, one stop at a time).';

-- The curator's own words about this stop. Deliberately on the entry rather
-- than in a separate table: a note has no life of its own, and it should go
-- when the entry does.
ALTER TABLE public.list_items
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN public.list_items.note IS
  'What the curator says about this stop. Rendered as the handwritten annotation in the storyboard template.';

DO $$
BEGIN
  RAISE NOTICE 'lists.template and list_items.note ready';
END $$;
