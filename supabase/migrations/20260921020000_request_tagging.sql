-- =============================================================================
-- Tagging bespoke requests, so the catalogue knows what to stock next
--
-- WHY NOW, WHEN THE SCREEN IS DEFERRED
-- ------------------------------------
-- The plan is that an admin tags each request ('iphone-11', 'school-shoes'),
-- and once a tag recurs often enough KithLy either promotes it into a standard
-- bundle or goes and onboards the shop that supplies it. Requests become the
-- research pipeline for the catalogue rather than a support burden.
--
-- The admin interface for that is deliberately deferred to the end of the
-- build. THE DATA CAPTURE IS NOT, and that distinction is the entire point of
-- this migration. A counter shipped in three months against three months of
-- untagged history answers nothing; the threshold it is meant to detect will
-- already have been crossed invisibly. Capture from the first request,
-- analyse whenever the screen exists.
--
-- WHY A COLUMN AND NOT A TABLE
-- ----------------------------
-- A request has one subject. "iPhone 11" is not two tags, it is one, and the
-- moment a request needs two the honest answer is that it is two requests. A
-- join table would buy multi-tagging nobody asked for and cost a join on
-- every inbox query.
--
-- Normalised on write by the trigger below rather than trusted from the
-- client, because 'iPhone-11', 'iphone 11' and ' iPhone_11 ' are one tag and
-- three rows in any counter that compares them raw -- which is exactly the
-- failure that makes the threshold never fire.
--
-- BLAST RADIUS: Local. One nullable column on conversations, written only by
-- admins, read by nothing yet.
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS request_tag text;

COMMENT ON COLUMN public.conversations.request_tag IS
  'Admin-assigned subject of a bespoke request, slug form (iphone-11). When a
   tag recurs past the threshold, the request is promoted into a catalogue
   bundle or the supplying shop is onboarded. Normalised by
   normalise_request_tag. Null for ordinary shop threads.';

-- Slugged on write. Anything that is not a letter or a digit collapses to a
-- single hyphen, so the three spellings of one tag cannot become three rows.
CREATE OR REPLACE FUNCTION public.normalise_request_tag()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.request_tag IS NOT NULL THEN
    NEW.request_tag := nullif(
      btrim(regexp_replace(lower(NEW.request_tag), '[^a-z0-9]+', '-', 'g'), '-'),
      ''
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_normalise_request_tag ON public.conversations;
CREATE TRIGGER conversations_normalise_request_tag
  BEFORE INSERT OR UPDATE OF request_tag ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.normalise_request_tag();

-- The counter's index. Partial, because only tagged rows are ever counted and
-- the overwhelming majority of conversations are ordinary shop threads.
CREATE INDEX IF NOT EXISTS conversations_request_tag_idx
  ON public.conversations (request_tag)
  WHERE request_tag IS NOT NULL;
