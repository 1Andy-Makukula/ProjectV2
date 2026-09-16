-- =============================================================================
-- A buyer can open a thread with KithLy
--
-- WHY THIS EXISTS
-- ---------------
-- The concierge model -- somebody asks for a thing no shop on the platform
-- lists, KithLy sources it in town and quotes for it -- runs entirely on
-- machinery that already exists: `admin_buyer` conversations, `quotations`,
-- `quotation_line_items`, and the ThreadView / QuotationBuilder surfaces. All
-- of it is built. None of it is reachable from the buyer's side.
--
-- `start_conversation` raises 'A shop is required'; `admin_start_conversation`
-- checks current_user_role() = 'admin'. So the only way an admin_buyer thread
-- comes into existence today is an admin creating it, which is the wrong
-- direction for a customer asking a question.
--
-- This adds the missing direction and nothing else.
--
-- BLAST RADIUS: 🟡 Feature. A new function; no existing signature is altered
-- and no policy moves. `conversations_participants_check` already permits
-- kind = 'admin_buyer' with a null shop_id, and `conversations_select` already
-- returns any row whose buyer_id is the caller -- so the thread is readable by
-- the person who opened it from the moment it exists, with no policy change.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.start_kithly_conversation(p_subject text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_subject text := NULLIF(btrim(p_subject), '');
  v_admin   RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- One open desk per person.
  --
  -- start_conversation reuses per (buyer, shop, item), because a buyer may be
  -- talking to several shops about several things at once. Here there is only
  -- ever one counterparty, so the thread *is* the relationship and a second
  -- one would only split the history in half.
  SELECT id INTO v_id
  FROM public.conversations
  WHERE kind = 'admin_buyer'
    AND buyer_id = v_uid
    AND is_closed = false
  ORDER BY last_message_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (kind, buyer_id, subject)
  VALUES ('admin_buyer', v_uid, v_subject)
  RETURNING id INTO v_id;

  -- Somebody has to be told, or the request lands in a room with nobody in it.
  --
  -- notify_conversation_counterparties, which every message send calls, tells
  -- the buyer and the shop owner. An admin_buyer thread has no shop, so on
  -- that path the KithLy side is told nothing at all. That is survivable for a
  -- thread an admin opened deliberately and already knows about; it is not
  -- survivable for one a customer opened unprompted. So the notification is
  -- raised here, at creation -- the moment that actually has to reach someone.
  --
  -- Same fan-out shape as the dispute notice in 20260727050000.
  FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' LOOP
    PERFORM public.create_notification(
      v_admin.id,
      'New request: ' || COALESCE(v_subject, 'a customer opened a thread'),
      'message',
      v_id::text);
  END LOOP;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.start_kithly_conversation(text) IS
  'Lets a signed-in buyer open, or rejoin, their one thread with KithLy. The
   counterpart to admin_start_conversation, which only an admin may call.';

-- anon is revoked explicitly: Supabase grants EXECUTE on a new function to
-- anon by default, and REVOKE ... FROM PUBLIC does not take that away.
REVOKE ALL ON FUNCTION public.start_kithly_conversation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_kithly_conversation(text) TO authenticated, service_role;
