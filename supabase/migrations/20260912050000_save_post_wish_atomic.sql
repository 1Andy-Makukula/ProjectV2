-- =============================================================================
-- Saving a wish is one transaction, not three
--
-- The client wrote a wish by upserting post_wishes, deleting every
-- post_wish_audience row, then inserting the new set. Three round trips with
-- two windows between them, and the failure mode is the wrong one: if the
-- insert fails after the delete on a wish whose visibility is 'except', the
-- deny-list is now empty and the person who was excluded can see it.
--
-- A privacy control that fails open is worse than one that fails loudly. The
-- whole save happens here instead, in a single function body — one implicit
-- transaction, so the audience is either replaced or untouched.
--
-- SECURITY INVOKER on purpose. Authorisation stays in RLS where it already is:
-- post_wishes_write requires user_id = auth.uid() and a post the caller can
-- actually see, and post_wish_audience_owner requires the wish be theirs. A
-- definer function here would be a second, weaker copy of rules that already
-- work.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_post_wish(
  p_post_id    uuid,
  p_note       text,
  p_visibility text,
  p_phones     text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wish_id uuid;
BEGIN
  IF p_visibility NOT IN ('all', 'except', 'only') THEN
    RAISE EXCEPTION 'Unknown wish visibility: %', p_visibility
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.post_wishes (post_id, user_id, note, visibility)
  VALUES (p_post_id, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''), p_visibility)
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET note       = EXCLUDED.note,
        visibility = EXCLUDED.visibility
  RETURNING id INTO v_wish_id;

  -- RLS decides whether that row was the caller's to write. If it was not,
  -- nothing came back and there is nothing to hang an audience off.
  IF v_wish_id IS NULL THEN
    RAISE EXCEPTION 'Wish could not be saved' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.post_wish_audience WHERE wish_id = v_wish_id;

  -- 'all' reads no list, so storing one would leave a rule nothing applies
  -- waiting to surprise somebody the day they switch to 'only'.
  IF p_visibility <> 'all' AND array_length(p_phones, 1) > 0 THEN
    INSERT INTO public.post_wish_audience (wish_id, phone)
    SELECT v_wish_id, btrim(phone)
    FROM unnest(p_phones) AS phone
    WHERE btrim(phone) <> ''
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_wish_id;
END;
$$;

COMMENT ON FUNCTION public.save_post_wish(uuid, text, text, text[]) IS
  'Create or update a wish and replace its audience in one transaction. SECURITY INVOKER: authorisation is the RLS on post_wishes and post_wish_audience.';

REVOKE ALL ON FUNCTION public.save_post_wish(uuid, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_post_wish(uuid, text, text, text[]) TO authenticated;
