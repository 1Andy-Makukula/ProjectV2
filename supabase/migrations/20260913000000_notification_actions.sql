-- =============================================================================
-- Notifications learn to do something
--
-- WHY
-- ---
-- `notifications` is message text, a type, and `reference_id text`. Every alert
-- the platform sends is therefore the "empty text alert" this stage exists to
-- get rid of: it tells you Mercy's graduation is in nine days and leaves you to
-- go and find her wishlist yourself.
--
-- `reference_id` looked like the answer and is not. It is one opaque string
-- with no type beside it, so a reader has to infer from `type` what the id
-- refers to -- and a reminder wants to offer *several* paths at once: open her
-- wishlist, see what suits a graduation, build a day around her favourite
-- shops. One id cannot carry three.
--
-- WHY JSONB AND NOT A COLUMN PER PATH
-- -----------------------------------
-- The set of actions grows every time a surface is added, and each one wants
-- different parameters. Columns would mean a migration per action and a table
-- of mostly-nulls. The constraint below keeps the loose part honest: every
-- action must name its own type, so a reader never has to guess.
--
-- `reference_id` is left exactly as it is. It is read by the bell and by
-- existing notification consumers, and this migration is additive -- an older
-- client that ignores `actions` renders precisely what it renders today.
-- =============================================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actions jsonb;

COMMENT ON COLUMN public.notifications.actions IS
  'Ordered one-tap paths for this notification. Each element names its own type. Null means a plain message, which is still valid.';

/* An array, and every element has a type and a label. Deliberately not a
   closed list of types: a surface that ships before this constraint is next
   edited should be able to send its action rather than be rejected. What must
   never happen is an action the client cannot dispatch because nothing says
   what it is, or cannot render because nothing says what to call it.

   This lives in a function because a CHECK constraint may not contain a
   subquery, and "every element of the array satisfies X" needs one. The
   trade-off to know about: Postgres does not re-validate existing rows if this
   function is later replaced, so loosening it is safe and tightening it is not
   -- a tightening needs its own migration that revalidates the constraint. */
CREATE OR REPLACE FUNCTION public.notification_actions_valid(p_actions jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT p_actions IS NULL
      OR (
        jsonb_typeof(p_actions) = 'array'
        AND jsonb_array_length(p_actions) BETWEEN 1 AND 3
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_actions) AS a
          WHERE jsonb_typeof(a) <> 'object'
             OR COALESCE(btrim(a ->> 'type'), '') = ''
             OR COALESCE(btrim(a ->> 'label'), '') = ''
        )
      );
$$;

COMMENT ON FUNCTION public.notification_actions_valid(jsonb) IS
  'Shape guard for notifications.actions: an array of 1-3 objects, each naming a type and a label.';

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_actions_shape_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_actions_shape_check
    CHECK (public.notification_actions_valid(actions));

-- The 1-3 cap lives inside notification_actions_valid() above, because this is
-- rendered in a bell and a notification offering nine things is one nobody
-- acts on. Kept in the same function so there is one place to look.

DO $$
BEGIN
  RAISE NOTICE 'notification actions ready';
END $$;
