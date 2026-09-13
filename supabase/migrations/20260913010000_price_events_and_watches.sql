-- =============================================================================
-- Price events and watches — "tell me when it drops"
--
-- WHY A LOG AND NOT A FLAG
-- ------------------------
-- `items.is_discounted` and `items.original_price_zmw` already exist, so the
-- platform can answer "is this discounted". An alert needs a different
-- question: "did this *become* discounted", and nothing records the change.
--
-- So prices get an append-only event log, written by trigger. Three things come
-- out of one table:
--
--   1. watches -- alert somebody when an item, or anything in a shop, drops
--   2. evidence for the recommender later; a price cut is a demand signal
--   3. a defence against fake discounts, which is the part that matters most
--
-- THE DISHONEST-DISCOUNT PROBLEM, WHICH THIS CREATES AND THEN SOLVES
-- ------------------------------------------------------------------
-- The moment alerts exist, a merchant has a reason to invent a sale: set
-- original_price_zmw to a number that was never charged, flip is_discounted,
-- and every watcher gets pinged. Today nothing could tell, because nothing
-- remembered what the price used to be.
--
-- With the log it is answerable: a claimed "was K200" is evidenced only if the
-- item was actually listed at K200 at some point. `unevidenced_discounts`
-- below is that query. It is not enforcement -- a merchant listing at a high
-- price briefly still passes -- but it makes the pattern visible to an admin
-- instead of invisible to everyone.
--
-- WHY ONLY REAL CHANGES ARE LOGGED
-- --------------------------------
-- The trigger fires on any UPDATE to items, and most updates touch a
-- description or an image. Writing a price event for those would fill the
-- table with rows saying nothing changed, and would make every watcher's alert
-- query slower for no information. The guard is an explicit comparison, not
-- `OF price_zmw` in the trigger definition, because a discount flip with an
-- unchanged price is also a price event worth recording.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_price_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id         uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,

  /* Denormalised so a shop-wide watch does not have to join items to find out
     which shop an event belongs to. Items do not move between shops. */
  shop_id         uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,

  old_price_zmw   integer,
  new_price_zmw   integer NOT NULL,

  old_discounted  boolean NOT NULL,
  new_discounted  boolean NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  /* A drop is what a watcher is waiting for. Stored rather than derived so the
     alert query is an index scan and not arithmetic over every row. */
  is_drop         boolean NOT NULL
);

COMMENT ON TABLE public.item_price_events IS
  'Append-only record of price and discount changes. Feeds watches, the recommender, and fake-discount detection.';

CREATE INDEX IF NOT EXISTS item_price_events_item_idx
  ON public.item_price_events (item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS item_price_events_drop_idx
  ON public.item_price_events (created_at DESC)
  WHERE is_drop;

CREATE INDEX IF NOT EXISTS item_price_events_shop_idx
  ON public.item_price_events (shop_id, created_at DESC)
  WHERE is_drop;

-- Append-only, the same way the money ledgers are. A price history that can be
-- rewritten is exactly as useful as no price history when the question is
-- whether a discount was real.
DROP TRIGGER IF EXISTS enforce_immutable_item_price_events ON public.item_price_events;
CREATE TRIGGER enforce_immutable_item_price_events
BEFORE UPDATE OR DELETE ON public.item_price_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

ALTER TABLE public.item_price_events ENABLE ROW LEVEL SECURITY;

/* Public read: what a shop charged is a public fact, and a shopper being able
   to check a claimed discount themselves is the point. */
DROP POLICY IF EXISTS item_price_events_read ON public.item_price_events;
CREATE POLICY item_price_events_read ON public.item_price_events
  FOR SELECT TO anon, authenticated USING (true);

-- No write policy. Rows arrive only from the trigger below, which runs as
-- definer; nothing may insert a price event by hand.

-- ---------------------------------------------------------------------------
-- 2. The trigger that writes it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_item_price_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Nothing about the price moved; most item edits land here and stop.
  IF NEW.price_zmw IS NOT DISTINCT FROM OLD.price_zmw
     AND NEW.is_discounted IS NOT DISTINCT FROM OLD.is_discounted THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.item_price_events (
    item_id, shop_id,
    old_price_zmw, new_price_zmw,
    old_discounted, new_discounted,
    is_drop
  )
  VALUES (
    NEW.id, NEW.shop_id,
    OLD.price_zmw, NEW.price_zmw,
    /* items.is_discounted is nullable, and on most rows it has never been set
       at all. Null means "not discounted" here, so it is normalised on the way
       in rather than left for every reader to coalesce -- and, more to the
       point, so the first price edit on an ordinary item does not violate the
       NOT NULL below and take item editing down with it. */
    COALESCE(OLD.is_discounted, false), COALESCE(NEW.is_discounted, false),
    /* A drop is a real fall in what you pay. A discount flag turning on
       without the price moving is not a drop -- it is a label, and treating it
       as one is how watchers get alerted about nothing. */
    COALESCE(NEW.price_zmw < OLD.price_zmw, false)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_record_price_event ON public.items;
CREATE TRIGGER items_record_price_event
AFTER UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.record_item_price_event();

-- ---------------------------------------------------------------------------
-- 3. Watches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_watches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  /* One or the other, never both -- the same XOR idiom contact_occasions uses
     for contact_id/group_id. A shop watch is "tell me about anything here". */
  item_id        uuid REFERENCES public.items(id) ON DELETE CASCADE,
  shop_id        uuid REFERENCES public.shops(id) ON DELETE CASCADE,

  /* Optional ceiling. Without it, any drop alerts; with it, only a drop to at
     or below this figure does. In ngwee, like every other price here. */
  target_zmw     integer,

  /* Guards repeats the same way contact_occasions.last_reminded_on does: a
     shop running a three-day sale should ping a watcher once, not each night. */
  last_alerted_on date,

  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT price_watches_subject_check CHECK (num_nonnulls(item_id, shop_id) = 1),
  CONSTRAINT price_watches_target_check CHECK (target_zmw IS NULL OR target_zmw > 0),
  CONSTRAINT price_watches_item_unique UNIQUE (user_id, item_id),
  CONSTRAINT price_watches_shop_unique UNIQUE (user_id, shop_id)
);

COMMENT ON TABLE public.price_watches IS
  'What a shopper wants to be told about: one item, or a whole shop. Feeds dispatch_price_alerts.';

CREATE INDEX IF NOT EXISTS price_watches_item_idx ON public.price_watches (item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS price_watches_shop_idx ON public.price_watches (shop_id) WHERE shop_id IS NOT NULL;

ALTER TABLE public.price_watches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_watches_owner_all ON public.price_watches;
CREATE POLICY price_watches_owner_all ON public.price_watches
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. The dispatch job
--
-- Follows dispatch_occasion_reminders exactly: in-app notifications only,
-- guarded against sending twice in a day, and no catching up. A drop that
-- happened while the job was down is not announced late -- being told about a
-- sale that ended yesterday is worse than not being told.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_price_alerts(p_today date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sent integer := 0;
  v_row  record;
  v_body text;
BEGIN
  FOR v_row IN
    SELECT DISTINCT ON (w.id)
      w.id           AS watch_id,
      w.user_id,
      w.target_zmw,
      i.id           AS item_id,
      i.name         AS item_name,
      s.name         AS shop_name,
      e.old_price_zmw,
      e.new_price_zmw
    FROM public.price_watches w
    JOIN public.item_price_events e
      ON (w.item_id IS NOT NULL AND e.item_id = w.item_id)
      OR (w.shop_id IS NOT NULL AND e.shop_id = w.shop_id)
    JOIN public.items i ON i.id = e.item_id
    JOIN public.shops s ON s.id = e.shop_id
    WHERE e.is_drop
      AND i.is_available IS NOT FALSE
      AND w.last_alerted_on IS DISTINCT FROM p_today
      -- Only today's drops. See the header: no catching up.
      AND e.created_at >= p_today::timestamptz
      AND (w.target_zmw IS NULL OR e.new_price_zmw <= w.target_zmw)
    ORDER BY w.id, e.new_price_zmw ASC, e.created_at DESC
  LOOP
    v_body := v_row.item_name || ' at ' || v_row.shop_name || ' has dropped to '
      || to_char(v_row.new_price_zmw / 100.0, 'FM999999990.00')
      || ' from ' || to_char(v_row.old_price_zmw / 100.0, 'FM999999990.00') || '.';

    INSERT INTO public.notifications (user_id, message, type, reference_id, actions)
    VALUES (
      v_row.user_id,
      v_body,
      'price_drop',
      v_row.item_id::text,
      jsonb_build_array(
        jsonb_build_object('type', 'open_item', 'label', 'See it', 'item_id', v_row.item_id),
        jsonb_build_object('type', 'stop_watching', 'label', 'Stop watching', 'watch_id', v_row.watch_id)
      )
    );

    UPDATE public.price_watches SET last_alerted_on = p_today WHERE id = v_row.watch_id;
    v_sent := v_sent + 1;
  END LOOP;

  RAISE NOTICE 'price alerts written: %', v_sent;
  RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_price_alerts(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_price_alerts(date) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Fake-discount detection
--
-- An item claiming a former price it was never listed at. Read by an admin,
-- not enforced: a genuine brief listing at the higher price is indistinguishable
-- from a cynical one, and refusing the write would punish both. Visibility is
-- the right amount of pressure.
--
-- An item with no price events at all is excluded rather than accused -- it may
-- simply predate this log.
-- ---------------------------------------------------------------------------
-- The highest price this item was ever seen at.
--
-- BOTH SIDES OF EVERY EVENT, WHICH IS THE WHOLE SUBTLETY. An item's original
-- listing price never appears as a `new_price_zmw` -- it is only ever the
-- `old_price_zmw` of its first change. Reading new_price_zmw alone therefore
-- accuses every merchant whose price has only ever gone down of inventing the
-- price they actually started at. A trust feature that flags honest shops is
-- worse than no trust feature.
CREATE OR REPLACE FUNCTION public.item_highest_recorded_price(p_item_id uuid)
RETURNS integer
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT max(GREATEST(e.new_price_zmw, COALESCE(e.old_price_zmw, e.new_price_zmw)))
  FROM public.item_price_events e
  WHERE e.item_id = p_item_id;
$$;

COMMENT ON FUNCTION public.item_highest_recorded_price(uuid) IS
  'Highest price an item was ever recorded at, reading both sides of every event. Null when it has no price history.';

CREATE OR REPLACE VIEW public.unevidenced_discounts
WITH (security_invoker = true) AS
SELECT
  i.id                  AS item_id,
  i.shop_id,
  i.name                AS item_name,
  i.price_zmw,
  i.original_price_zmw  AS claimed_was_zmw,
  public.item_highest_recorded_price(i.id) AS highest_price_ever_recorded
FROM public.items i
WHERE i.is_discounted
  AND i.original_price_zmw IS NOT NULL
  AND public.item_highest_recorded_price(i.id) IS NOT NULL
  AND i.original_price_zmw > public.item_highest_recorded_price(i.id);

COMMENT ON VIEW public.unevidenced_discounts IS
  'Items claiming a former price higher than any this log ever saw them listed at. Advisory, for admin review.';

DO $$
BEGIN
  RAISE NOTICE 'price events and watches ready';
END $$;
