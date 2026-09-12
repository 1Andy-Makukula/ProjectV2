-- =============================================================================
-- kithly_reco.signals — the behaviour log, landed early on purpose
--
-- WHY NOW, WHEN NOTHING READS IT UNTIL V4
-- ---------------------------------------
-- The Slate (Stage 6) ranks partly on what people actually do. Training data
-- cannot be created retroactively: a recommender switched on the same week its
-- log is created opens against an empty table and is useless for months.
--
-- So the log lands in V3 and fills quietly while the visible work happens. By
-- the time anything reads it, it has history. This migration is the whole of
-- that decision -- there is deliberately no reader here.
--
-- ITS OWN SCHEMA, AND THE DEPENDENCY POINTS ONE WAY
-- -------------------------------------------------
-- `kithly_reco` is separate from `public` so the recommender can be dropped and
-- rebuilt wholesale without touching anything that matters. Ranking logic is
-- the most-churned code in a product like this; it must not live where a bad
-- week can damage escrow.
--
-- The rule that keeps that true: `public` never references `kithly_reco`.
-- The recommender may read the world; the world may not depend on the
-- recommender.
--
-- APPEND-ONLY, WHICH TAKES AN EXPLICIT REVOKE HERE
-- ------------------------------------------------
-- Everywhere else in this codebase, table privileges are left to Supabase's
-- defaults and RLS does the gating -- `claim_status_feed` is anon-readable with
-- no GRANT of its own. That default is `GRANT ALL`, which would make this table
-- editable, and an editable audit log is not an audit log.
--
-- So this is the deliberate exception: UPDATE and DELETE are revoked outright,
-- and there are no UPDATE or DELETE policies to fall back on. A signal can be
-- written and read. It cannot be rewritten.
--
-- ANONYMOUS SIGNALS ARE WORTH KEEPING
-- -----------------------------------
-- Most browsing happens before anybody signs in, and a recommender that only
-- learns from logged-in sessions learns from the minority. `user_id` is
-- nullable and `session_id` carries an opaque client-generated id, so an
-- anonymous run of the storefront is still a coherent sequence. Nothing in
-- either column identifies a person on its own.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS kithly_reco;

COMMENT ON SCHEMA kithly_reco IS
  'The recommender. Separate from public so it can be dropped and rebuilt wholesale; public never references it.';

GRANT USAGE ON SCHEMA kithly_reco TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS kithly_reco.signals (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  /* Null for a signed-out shopper. ON DELETE SET NULL rather than CASCADE:
     a deleted account should stop being identifiable, not erase the aggregate
     evidence that an item was popular. */
  user_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,

  /* Opaque, client-generated, per browsing session. Stitches an anonymous
     sequence together without naming anybody. */
  session_id    uuid,

  /* Where it happened: 'storefront', 'rail', 'shop', 'list', 'post', 'ussd'.
     Free text rather than a CHECK -- surfaces are added faster than migrations
     are written, and an unknown surface should be recorded, not rejected. */
  surface       text NOT NULL,

  /* What happened. Closed, because this IS the vocabulary the ranker counts,
     and a typo that silently becomes a new action type is a bug nobody sees
     until the model is wrong. */
  action        text NOT NULL,

  subject_type  text NOT NULL,
  subject_id    uuid,

  /* Which slate produced this impression, and where in it. Both null until
     Stage 6 exists; they are here now so the column does not have to be added
     to a large table later, and so interleaving has its join key from the
     first day the Slate runs. */
  slate_id      uuid,
  position      integer,

  /* Anything surface-specific. Deliberately unconstrained; deliberately not
     where anything load-bearing lives. */
  context       jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT signals_action_check CHECK (action IN (
    'impression',   -- it was rendered where someone could see it
    'view',         -- it was opened
    'tap',          -- it was clicked through
    'save',         -- added to a list or wishlist
    'add_to_cart',
    'purchase',
    'dismiss',      -- explicitly rejected. The rarest and most valuable signal.
    'search'
  )),

  CONSTRAINT signals_subject_type_check CHECK (subject_type IN (
    'item', 'shop', 'post', 'list', 'collection', 'experience', 'query'
  )),

  CONSTRAINT signals_surface_check CHECK (btrim(surface) <> ''),

  /* A subject is required for everything except a search, which is a query
     rather than a thing. */
  CONSTRAINT signals_subject_required CHECK (
    subject_id IS NOT NULL OR subject_type = 'query'
  ),

  CONSTRAINT signals_position_check CHECK (position IS NULL OR position >= 0)
);

COMMENT ON TABLE kithly_reco.signals IS
  'Append-only behaviour log. Written from V3 so the Slate opens against history rather than an empty table.';

COMMENT ON COLUMN kithly_reco.signals.action IS
  'impression | view | tap | save | add_to_cart | purchase | dismiss | search. dismiss is the rarest and most valuable.';

-- The two shapes anything will ever read this in: one user's recent behaviour,
-- and one subject's recent counts.
CREATE INDEX IF NOT EXISTS signals_user_time_idx
  ON kithly_reco.signals (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_subject_time_idx
  ON kithly_reco.signals (subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS signals_slate_idx
  ON kithly_reco.signals (slate_id)
  WHERE slate_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Append-only, enforced by privilege as well as by policy
--
-- The REVOKE is the part that matters. Supabase's default privileges grant ALL
-- on new tables in a schema, so without this an ordinary signed-in user could
-- UPDATE or DELETE rows in the log.
-- ---------------------------------------------------------------------------
REVOKE ALL ON kithly_reco.signals FROM anon, authenticated;
GRANT SELECT, INSERT ON kithly_reco.signals TO anon, authenticated;
GRANT SELECT, INSERT ON kithly_reco.signals TO service_role;

ALTER TABLE kithly_reco.signals ENABLE ROW LEVEL SECURITY;

/* Anyone may write a signal, but only about themselves: a signed-in user
   stamps their own id, a signed-out one stamps none. Writing somebody else's
   id is the one thing this must refuse, or the log can be poisoned. */
DROP POLICY IF EXISTS signals_insert_own ON kithly_reco.signals;
CREATE POLICY signals_insert_own ON kithly_reco.signals
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

/* Read your own. Not a product feature yet -- it is here so a person can be
   shown what was recorded about them without a privileged path existing. */
DROP POLICY IF EXISTS signals_select_own ON kithly_reco.signals;
CREATE POLICY signals_select_own ON kithly_reco.signals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE or DELETE policy exists, and none should. See the header.

-- ---------------------------------------------------------------------------
-- Retention
--
-- This table grows with every rendered tile and never shrinks on its own. Six
-- months is well past the point where an individual event still says anything
-- about what somebody wants, and the aggregates Stage 6 materialises are
-- derived long before then.
--
-- Defined but NOT scheduled here. Scheduling belongs with the stage that owns
-- the reading side, and a cron job trimming a table nothing yet writes to is
-- a job that can only be wrong.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kithly_reco.prune_signals(p_keep_days integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kithly_reco, public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_keep_days < 30 THEN
    RAISE EXCEPTION 'refusing to prune signals to % days; the ranker needs history', p_keep_days;
  END IF;

  DELETE FROM kithly_reco.signals
  WHERE created_at < now() - make_interval(days => p_keep_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'pruned % signals older than % days', v_deleted, p_keep_days;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION kithly_reco.prune_signals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION kithly_reco.prune_signals(integer) TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'kithly_reco.signals ready';
END $$;
