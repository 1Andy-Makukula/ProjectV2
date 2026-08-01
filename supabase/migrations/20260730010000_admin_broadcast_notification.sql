-- =============================================================================
-- Admin-initiated broadcast notifications
--
-- Every existing write to public.notifications is triggered by a specific
-- system event tied to one user_id (payment confirmed, shop verified, order
-- fulfilled, etc — see 20260727050000_notification_coverage.sql). There is no
-- path for an admin to compose a message and send it to a set of users (for
-- announcements/promos). This adds exactly that, reusing the existing
-- notifications table/RLS/realtime delivery — no new table needed.
--
-- Modeled directly on review_merchant_verification() (kithly_schema.sql):
-- SECURITY DEFINER, role-checked internally, logs itself via
-- log_admin_action() (20260729050000_admin_action_log.sql).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(
  p_message  text,
  p_type     text DEFAULT 'announcement',
  p_audience text DEFAULT 'all'   -- 'all' | 'sender' | 'merchant'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may broadcast notifications';
  END IF;

  IF btrim(coalesce(p_message, '')) = '' THEN
    RAISE EXCEPTION 'Message is required';
  END IF;

  IF p_audience NOT IN ('all', 'sender', 'merchant') THEN
    RAISE EXCEPTION 'Invalid audience: %', p_audience;
  END IF;

  INSERT INTO public.notifications (user_id, message, type, reference_id)
  SELECT id, p_message, p_type, NULL
  FROM public.users
  WHERE p_audience = 'all' OR role = p_audience;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.log_admin_action(
    'notification.broadcast',
    'audience',
    NULL,
    jsonb_build_object(
      'audience', p_audience,
      'type', p_type,
      'recipient_count', v_count,
      'message', p_message
    )
  );

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_broadcast_notification(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_notification(text, text, text) TO authenticated;
