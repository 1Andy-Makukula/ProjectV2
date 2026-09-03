-- =============================================================================
-- Chat attachments move to a private bucket
--
-- WHY
-- ---
-- 20260808050000 established the rule and the mechanism: files whose ROWS are
-- protected by RLS must not be written to `storefront-assets`, which is a
-- PUBLIC bucket. It moved compliance documents to a private bucket, changed the
-- table to store a storage path rather than a URL, and had the client mint a
-- short-lived signed URL per view. Its own words: "Protecting the row while
-- publishing the file protects nothing: the row only holds the link."
--
-- upload-chat-image, written afterwards, reused the storefront helper anyway:
--
--   const BUCKET = "storefront-assets";
--   const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(path);
--
-- `messages` is RLS-protected by conversation participancy, and the attachments
-- are whatever buyers and merchants photograph at each other -- receipts,
-- quotations, delivery addresses, NRCs, proof of payment. Every one of them has
-- a permanent unauthenticated URL, guessable to anyone who obtains it once and
-- unrevocable thereafter. The bucket name and folder layout are public
-- knowledge; only the UUID stands in the way, and a UUID that has been pasted
-- into a chat, cached by a CDN, or logged is not a secret.
--
-- WHAT THIS DOES
-- --------------
-- A private `chat-attachments` bucket, with storage RLS delegating to
-- `conversation_role_for` -- the same participancy check `send_message` and
-- upload-chat-image already use, rather than a second rule that can drift from
-- it.
--
-- Objects are stored as `<conversation_id>/<uuid>.<ext>`, so the first folder
-- segment is the conversation, matching the `<shop_id>/...` convention the
-- shop-documents policies established. The old code wrote
-- `chat/<conversation_id>/<uuid>` -- a constant first segment that no
-- path-based policy can authorise on.
--
-- ON EXISTING ATTACHMENTS
-- -----------------------
-- Unlike shop_documents, `messages` is NOT empty, and its image rows are real
-- conversation history. They are deliberately left in place: deleting them
-- destroys user data, and moving the files would break every historical
-- message's link while doing nothing about URLs already handed out.
--
-- So messages.image_url now holds ONE OF two things -- a legacy absolute URL
-- (public, pre-existing) or a storage path in this bucket (private, everything
-- from now on). The client distinguishes them by the `http` prefix; see
-- resolveChatImageSrc in src/utils/uploadImage.ts.
--
-- Those already-public files remain public. Closing that off means sweeping
-- storefront-assets/chat/** and re-homing it, which is a data migration with
-- its own rollback story and is left as follow-up work rather than smuggled in
-- here. What this migration guarantees is that the leak stops growing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ---------------------------------------------------------------------------
-- Path-based access, delegating to the existing participancy rule.
--
-- Compared as text rather than cast to uuid, for the reason 20260808050000
-- gives: a malformed path must fail the check, not raise 22P02 and take the
-- whole query down with it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_chat_attachment_folder(p_folder text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conversation uuid;
BEGIN
  IF p_folder IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_conversation := p_folder::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  RETURN public.conversation_role_for(v_conversation, auth.uid()) IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_chat_attachment_folder(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_chat_attachment_folder(text) TO authenticated, service_role;

DROP POLICY IF EXISTS chat_attachments_objects_read ON storage.objects;
CREATE POLICY chat_attachments_objects_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND public.can_access_chat_attachment_folder((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS chat_attachments_objects_write ON storage.objects;
CREATE POLICY chat_attachments_objects_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND public.can_access_chat_attachment_folder((storage.foldername(name))[1])
  );

-- No DELETE policy, deliberately.
--
-- shop-documents grants one because a merchant replaces a superseded licence.
-- A chat attachment is a sent message: letting either party remove the file
-- behind a message the other has already received is a repudiation tool, not a
-- feature. 20260808060000 made the same call for documents -- archive, never
-- delete. service_role retains the ability for genuine takedown requests.

COMMENT ON FUNCTION public.can_access_chat_attachment_folder(text) IS
  'Storage-RLS gate for the private chat-attachments bucket. The first folder '
  'segment is the conversation id; access is exactly conversation participancy, '
  'delegated to conversation_role_for so the two cannot drift.';

-- ---------------------------------------------------------------------------
-- Verify, or fail the migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'chat-attachments' AND public = false
  ) THEN
    RAISE EXCEPTION 'chat-attachments bucket is missing or is public';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'chat_attachments_objects_read'
  ) THEN
    RAISE EXCEPTION 'chat_attachments_objects_read policy is missing';
  END IF;

  RAISE NOTICE 'chat attachments are private; access is conversation participancy';
END $$;
