-- =============================================================================
-- The sweep — noticing before you do
--
-- WHY OUTBOUND
-- ------------
-- Every recommendation so far is passive: it waits for somebody to open the app
-- and then answers well. That is the wrong shape for the things people actually
-- repeat. Nobody opens a shopping app to be reminded that the household runs out
-- of maize meal roughly every three weeks. They remember at the wrong moment,
-- in a queue, and buy it somewhere else.
--
-- So this runs whether or not anyone visits, finds what a person buys on a
-- rhythm, and says so shortly before the rhythm comes round.
--
-- PERIODICITY, NOT GUESSWORK
-- --------------------------
-- Two purchases of the same item is a coincidence; three is a habit. The gap is
-- the MEDIAN of the observed gaps rather than the mean, because one holiday or
-- one bulk buy skews a mean badly and there are never many data points here.
--
-- Nothing is proposed for an item bought once. That is the difference between
-- "you usually restock this about now" -- which is true, checkable, and the
-- reason somebody trusts the app -- and a shop guessing at you.
--
-- WHAT IT INHERITS FROM THE REMINDER JOB
-- --------------------------------------
-- 20260904010000 established the discipline and it is repeated here rather than
-- reinvented: no catching up, and one proposal per item at a time. A sweep that
-- missed a week does not then propose four things at once, and a person who has
-- already been asked about maize meal is not asked again while that proposal is
-- still open. Being nagged is how a useful feature becomes a muted one.
-- =============================================================================

CREATE OR REPLACE FUNCTION kithly_reco.sweep_restock_proposals(
  p_today date DEFAULT current_date,
  p_lead_days integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kithly_reco, public
AS $$
DECLARE
  v_made integer := 0;
  v_row  record;
BEGIN
  FOR v_row IN
    WITH purchases AS (
      -- Collected only. An order that was never picked up says something about
      -- the sender's week, not about what the household gets through.
      SELECT
        t.buyer_id            AS user_id,
        oi.item_id,
        so.fulfilled_at::date AS bought_on
      FROM public.order_items oi
      JOIN public.shop_orders so ON so.shop_order_id = oi.shop_order_id
      JOIN public.transactions t ON t.transaction_id = so.transaction_id
      WHERE so.fulfilled_at IS NOT NULL
        AND t.buyer_id IS NOT NULL
      GROUP BY t.buyer_id, oi.item_id, so.fulfilled_at::date
    ),
    gaps AS (
      SELECT
        user_id,
        item_id,
        bought_on,
        bought_on - lag(bought_on) OVER (
          PARTITION BY user_id, item_id ORDER BY bought_on
        ) AS gap_days
      FROM purchases
    ),
    rhythm AS (
      SELECT
        user_id,
        item_id,
        max(bought_on) AS last_bought,
        count(*) FILTER (WHERE gap_days IS NOT NULL) AS observed_gaps,
        /* Median, not mean. One bulk buy would drag a mean out of usefulness
           and there are only ever a handful of points. */
        percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_days)
          FILTER (WHERE gap_days IS NOT NULL) AS typical_gap
      FROM gaps
      GROUP BY user_id, item_id
    )
    SELECT
      r.user_id,
      r.item_id,
      i.name        AS item_name,
      i.price_zmw,
      round(r.typical_gap)::integer AS typical_gap,
      (r.last_bought + round(r.typical_gap)::integer) AS due_on
    FROM rhythm r
    JOIN public.items i ON i.id = r.item_id
    WHERE r.observed_gaps >= 2            -- three purchases: a habit, not a coincidence
      AND r.typical_gap BETWEEN 5 AND 120 -- daily bread and yearly things are both noise here
      AND i.is_available IS NOT FALSE
      AND i.is_quote_only IS NOT TRUE
      -- Exact, like the reminder windows. A sweep that did not run on the day
      -- does not then announce it late; see the header.
      AND (r.last_bought + round(r.typical_gap)::integer) = p_today + p_lead_days
      -- Not while they are still thinking about the last one.
      AND NOT EXISTS (
        SELECT 1 FROM kithly_reco.proposals p
        WHERE p.user_id = r.user_id
          AND p.status = 'proposed'
          AND r.item_id = ANY (p.item_ids)
      )
  LOOP
    INSERT INTO kithly_reco.proposals
      (user_id, kind, surface, subject, item_ids, total_zmw, reason_code, reason_text, expires_at)
    VALUES (
      v_row.user_id,
      'restock',
      'list',
      jsonb_build_object('item_id', v_row.item_id, 'typical_gap_days', v_row.typical_gap),
      ARRAY[v_row.item_id],
      v_row.price_zmw,
      'restock',
      -- Said the way somebody would say it, and checkable: the person can work
      -- out whether it is true, which is the point of earning the interruption.
      'You usually buy ' || v_row.item_name || ' about every '
        || v_row.typical_gap || ' days',
      now() + interval '7 days'
    );
    v_made := v_made + 1;
  END LOOP;

  RAISE NOTICE 'restock proposals made: %', v_made;
  RETURN v_made;
END;
$$;

COMMENT ON FUNCTION kithly_reco.sweep_restock_proposals(date, integer) IS
  'Finds what a person buys on a rhythm and proposes it shortly before it comes round. Three purchases minimum, median gap.';

REVOKE ALL ON FUNCTION kithly_reco.sweep_restock_proposals(date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION kithly_reco.sweep_restock_proposals(date, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Scheduling
--
-- Guarded, because pg_cron is not present in every environment this chain
-- replays in -- the CI database and the local test cluster both lack it, and a
-- migration that assumes it would fail there rather than in production where it
-- matters.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('kithly-restock-sweep')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kithly-restock-sweep');

    PERFORM cron.schedule(
      'kithly-restock-sweep',
      '30 5 * * *',  -- early, so a proposal is waiting rather than arriving mid-day
      $cron$SELECT kithly_reco.sweep_restock_proposals(); SELECT kithly_reco.expire_proposals();$cron$
    );
    RAISE NOTICE 'restock sweep scheduled for 05:30 daily';
  ELSE
    RAISE NOTICE 'pg_cron absent; restock sweep defined but not scheduled';
  END IF;
END $$;
