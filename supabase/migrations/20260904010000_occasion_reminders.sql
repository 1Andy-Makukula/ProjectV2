-- =============================================================================
-- Occasion reminders — telling someone before the day, not after it
--
-- WHY A JOB AND NOT A QUERY
-- -------------------------
-- The storefront rail already shows what is coming up, but only to somebody who
-- happens to open the app. The entire point of recording a date is to be told
-- when you were not thinking about it, so this runs whether or not anyone
-- visits.
--
-- IN-APP ONLY, DELIBERATELY
-- -------------------------
-- Writes rows into `notifications`, which the bell already reads. No WhatsApp
-- and no SMS: those cost money per message, need their own consent, and
-- send-notification is currently pointed at a Twilio sandbox that delivers to
-- nobody. When that is sorted, this function is where the second channel would
-- be added -- one place, already holding the list of who to tell.
--
-- TWO REMINDERS, AND HOW REPEATS ARE AVOIDED
-- ------------------------------------------
-- A week out, so there is time to actually do something, and again on the day.
-- `last_reminded_on` is stamped whenever a reminder is written and the query
-- skips anything already stamped today, so:
--
--   * running the job twice in a day sends nothing the second time, which
--     matters because a retry after a failure is the normal way this recovers;
--   * a monthly occasion can still be reminded about every month, because the
--     stamp only blocks the same day.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- No catching up. A job that did not run for three days does not then announce
-- three days of missed birthdays -- being told late that you missed something
-- is worse than not being told, and there is nothing to be done about it now.
-- =============================================================================

ALTER TABLE public.contact_occasions
  ADD COLUMN IF NOT EXISTS last_reminded_on date;

COMMENT ON COLUMN public.contact_occasions.last_reminded_on IS
  'The day a reminder was last written for this occasion. Guards against sending twice in one day.';

-- ---------------------------------------------------------------------------
-- When does this occasion next fall?
--
-- The same three rules the client uses, in SQL, so the job and the rail can
-- never disagree about what "next" means:
--
--   annual   -- this year's, or next year's once it has gone
--   monthly  -- this month's, or next month's once it has gone
--   once     -- its own date, and NULL after it has passed
--
-- A day that does not exist in its month rolls FORWARD (the 31st in a 30-day
-- month, the 29th of February in a common year). Never backward: announcing a
-- date early is how somebody ends up buying the present a day late.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.occasion_next_date(
  p_recurrence text,
  p_month      smallint,
  p_day        smallint,
  p_year       smallint,
  p_today      date DEFAULT current_date
)
RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_first_of  date;
  v_last_day  integer;
  v_candidate date;
BEGIN
  IF p_day IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_recurrence = 'once' THEN
    IF p_month IS NULL OR p_year IS NULL THEN
      RETURN NULL;
    END IF;
    v_first_of := make_date(p_year, p_month, 1);
    v_last_day := EXTRACT(DAY FROM (v_first_of + interval '1 month - 1 day'))::int;
    v_candidate := CASE
      WHEN p_day > v_last_day THEN v_first_of + interval '1 month'
      ELSE make_date(p_year, p_month, p_day)
    END;
    RETURN CASE WHEN v_candidate < p_today THEN NULL ELSE v_candidate END;
  END IF;

  IF p_recurrence = 'monthly' THEN
    v_first_of := date_trunc('month', p_today)::date;
    FOR i IN 0..1 LOOP
      v_last_day := EXTRACT(DAY FROM (v_first_of + interval '1 month - 1 day'))::int;
      v_candidate := CASE
        WHEN p_day > v_last_day THEN (v_first_of + interval '1 month')::date
        ELSE v_first_of + (p_day - 1)
      END;
      IF v_candidate >= p_today THEN
        RETURN v_candidate;
      END IF;
      v_first_of := (v_first_of + interval '1 month')::date;
    END LOOP;
    RETURN v_candidate;
  END IF;

  -- annual
  IF p_month IS NULL THEN
    RETURN NULL;
  END IF;

  FOR i IN 0..1 LOOP
    v_first_of := make_date(EXTRACT(YEAR FROM p_today)::int + i, p_month, 1);
    v_last_day := EXTRACT(DAY FROM (v_first_of + interval '1 month - 1 day'))::int;
    v_candidate := CASE
      WHEN p_day > v_last_day THEN (v_first_of + interval '1 month')::date
      ELSE v_first_of + (p_day - 1)
    END;
    IF v_candidate >= p_today THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.occasion_next_date(text, smallint, smallint, smallint, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.occasion_next_date(text, smallint, smallint, smallint, date)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The daily sweep
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_occasion_reminders(p_today date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row   RECORD;
  v_sent  integer := 0;
  v_when  text;
  v_title text;
BEGIN
  FOR v_row IN
    SELECT
      o.id,
      o.kind,
      o.label,
      o.notes,
      c.owner_user_id,
      c.name AS contact_name,
      public.occasion_next_date(o.recurrence, o.month, o.day, o.year, p_today) AS next_date
    FROM public.contact_occasions o
    JOIN public.contacts c ON c.id = o.contact_id
    WHERE o.last_reminded_on IS DISTINCT FROM p_today
  LOOP
    CONTINUE WHEN v_row.next_date IS NULL;
    -- A week out, and again on the day.
    CONTINUE WHEN (v_row.next_date - p_today) NOT IN (0, 7);

    v_title := COALESCE(NULLIF(btrim(COALESCE(v_row.label, '')), ''), CASE v_row.kind
      WHEN 'birthday'    THEN 'birthday'
      WHEN 'anniversary' THEN 'anniversary'
      WHEN 'wedding'     THEN 'wedding'
      WHEN 'graduation'  THEN 'graduation'
      WHEN 'new_baby'    THEN 'new baby'
      WHEN 'memorial'    THEN 'remembrance'
      WHEN 'holiday'     THEN 'holiday'
      WHEN 'groceries'   THEN 'grocery run'
      WHEN 'school_fees' THEN 'school fees'
      WHEN 'upkeep'      THEN 'upkeep'
      WHEN 'rent'        THEN 'rent'
      WHEN 'medical'     THEN 'medical appointment'
      ELSE 'occasion'
    END);

    v_when := CASE WHEN v_row.next_date = p_today THEN 'is today' ELSE 'is in a week' END;

    INSERT INTO public.notifications (user_id, message, type, reference_id)
    VALUES (
      v_row.owner_user_id,
      -- The note is the useful half: "she likes the yellow roses" is what turns
      -- a reminder into something you can act on without thinking.
      v_row.contact_name || '''s ' || v_title || ' ' || v_when || '.'
        || COALESCE(' ' || NULLIF(btrim(COALESCE(v_row.notes, '')), ''), ''),
      'occasion_reminder',
      v_row.id::text
    );

    UPDATE public.contact_occasions SET last_reminded_on = p_today WHERE id = v_row.id;
    v_sent := v_sent + 1;
  END LOOP;

  RAISE NOTICE 'occasion reminders written: %', v_sent;
  RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_occasion_reminders(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_occasion_reminders(date) TO service_role;

-- ---------------------------------------------------------------------------
-- Schedule it
--
-- 04:00 UTC is 06:00 in Lusaka -- before the day starts, not in the middle of
-- the night. Guarded like every other scheduled job here: if pg_cron is not
-- installed the migration still applies, and says so.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron is not installed; occasion reminders are not scheduled.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('occasion-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'occasion-reminders');

  PERFORM cron.schedule(
    'occasion-reminders',
    '0 4 * * *',
    $job$ SELECT public.dispatch_occasion_reminders(); $job$
  );

  RAISE NOTICE 'occasion reminders scheduled for 04:00 UTC daily';
END $$;
