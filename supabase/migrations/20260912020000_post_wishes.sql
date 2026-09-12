-- =============================================================================
-- P4 — Wishes, and the Secret Santa they make possible
--
-- Somebody marks a post as wanted. People close to them can see it, and buy it
-- for them — anonymously if they choose. This is the differentiator: posts with
-- buy buttons exist everywhere, but buying one FOR SOMEBODY ELSE, who collects
-- it with a claim code under escrow, does not.
--
-- ---------------------------------------------------------------------------
-- Who can see a wish, and why it is not "whoever has your number"
-- ---------------------------------------------------------------------------
-- `contacts` are one-directional and phone-keyed: anybody may add any number
-- without the other person agreeing, and freeze_user_phone_and_unique_msisdn
-- makes that number a stable join key. So "anyone with the contact can see it"
-- cannot be the whole rule — it would mean anybody who types your number into
-- their phone book can read what you have asked for.
--
-- Contact-possession is therefore necessary but not sufficient. The wish also
-- carries its own visibility, chosen by the person who made it:
--
--   all    — anybody who has them in their contacts
--   except — the same, minus the numbers listed on the wish
--   only   — nobody except the numbers listed on the wish
--
-- `all` means all of my contacts. It never means the public internet, and the
-- UI must not offer it as though it does.
--
-- ---------------------------------------------------------------------------
-- Anonymity is hidden from the RECIPIENT, not from the system
-- ---------------------------------------------------------------------------
-- `is_anonymous` on a purchase suppresses the buyer in what the recipient is
-- shown. It is display suppression and nothing more: shop_orders still carries
-- a real buyer, raise_order_dispute still works, and the payout trail is
-- untouched. An order nobody can trace is not a gift, it is a hole in the
-- ledger.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The wish
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_wishes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note       text,
  visibility text NOT NULL DEFAULT 'all',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_wishes_visibility_check CHECK (visibility IN ('all', 'except', 'only')),
  CONSTRAINT post_wishes_note_length_check CHECK (note IS NULL OR length(note) <= 500),
  -- One wish per person per post. Wishing twice is editing the first.
  CONSTRAINT post_wishes_unique UNIQUE (post_id, user_id)
);

COMMENT ON TABLE public.post_wishes IS
  'Someone marking a post as wanted. Visible to their contacts, subject to the wish''s own visibility. The only user-authored content in the posts feature.';

CREATE INDEX IF NOT EXISTS post_wishes_user_idx ON public.post_wishes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS post_wishes_post_idx ON public.post_wishes (post_id);

-- ---------------------------------------------------------------------------
-- 2. The allow / deny list
--
-- Phone numbers rather than user ids: the person choosing is picking from their
-- own contacts, which are phone rows and may not correspond to a KithLy account
-- at all. The phone is the join key everywhere else in this product too.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_wish_audience (
  wish_id    uuid NOT NULL REFERENCES public.post_wishes(id) ON DELETE CASCADE,
  phone      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wish_id, phone),

  CONSTRAINT post_wish_audience_phone_check CHECK (btrim(phone) <> '')
);

COMMENT ON TABLE public.post_wish_audience IS
  'The numbers a wish names. Read as a deny-list when visibility is ''except'', an allow-list when it is ''only'', and ignored when it is ''all''.';

-- ---------------------------------------------------------------------------
-- 3. Can this reader see this wish?
--
-- SECURITY DEFINER for two reasons, not one. The usual: so the policies on
-- post_wish_audience can ask without re-entering the wishes policy. The
-- specific: the check has to read the WISHER's phone out of `users`, and the
-- reader has no business selecting other people's user rows — the answer is
-- computed for them rather than the data being exposed so they can compute it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_wish(p_wish_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.post_wishes w
    WHERE w.id = p_wish_id
      AND (
        w.user_id = auth.uid()
        OR (
          -- The reader keeps the wisher in their contacts.
          EXISTS (
            SELECT 1
            FROM public.contacts c
            JOIN public.users u ON u.phone = c.phone
            WHERE c.owner_user_id = auth.uid()
              AND u.id = w.user_id
          )
          AND CASE w.visibility
            WHEN 'all' THEN true
            WHEN 'except' THEN NOT EXISTS (
              SELECT 1 FROM public.post_wish_audience a
              WHERE a.wish_id = w.id AND a.phone = public.current_user_phone()
            )
            WHEN 'only' THEN EXISTS (
              SELECT 1 FROM public.post_wish_audience a
              WHERE a.wish_id = w.id AND a.phone = public.current_user_phone()
            )
            ELSE false
          END
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_wish(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_wish(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The wishes a reader may see
--
-- A set-returning function rather than a policy the feed leans on. Evaluating
-- the visibility rule per row of a browse query would put a correlated subquery
-- on the hottest read path in the app; this is asked once, for a short list,
-- from the rail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wishes_from_my_contacts(p_limit integer DEFAULT 10)
RETURNS TABLE (
  wish_id       uuid,
  post_id       uuid,
  wisher_id     uuid,
  wisher_name   text,
  note          text,
  created_at    timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    w.id,
    w.post_id,
    w.user_id,
    -- The name the reader filed them under, not the name on their account:
    -- "Mum" is who they are to this reader.
    COALESCE(c.name, u.name),
    w.note,
    w.created_at
  FROM public.post_wishes w
  JOIN public.users u ON u.id = w.user_id
  JOIN public.contacts c
    ON c.owner_user_id = auth.uid()
   AND c.phone = u.phone
  WHERE w.user_id <> auth.uid()
    AND CASE w.visibility
      WHEN 'all' THEN true
      WHEN 'except' THEN NOT EXISTS (
        SELECT 1 FROM public.post_wish_audience a
        WHERE a.wish_id = w.id AND a.phone = public.current_user_phone()
      )
      WHEN 'only' THEN EXISTS (
        SELECT 1 FROM public.post_wish_audience a
        WHERE a.wish_id = w.id AND a.phone = public.current_user_phone()
      )
      ELSE false
    END
  ORDER BY w.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
$$;

REVOKE ALL ON FUNCTION public.wishes_from_my_contacts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wishes_from_my_contacts(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.post_wishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_wish_audience ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_wishes_read ON public.post_wishes;
CREATE POLICY post_wishes_read ON public.post_wishes
  FOR SELECT TO authenticated
  USING (public.can_view_wish(id));

-- Your own wish, on a post you can actually see.
DROP POLICY IF EXISTS post_wishes_write ON public.post_wishes;
CREATE POLICY post_wishes_write ON public.post_wishes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_view_post(post_id));

-- The audience of a wish is the wisher's business and nobody else's. A reader
-- never needs to see the list to be judged by it — can_view_wish does that for
-- them — and being able to read it would tell them who else was named.
DROP POLICY IF EXISTS post_wish_audience_owner ON public.post_wish_audience;
CREATE POLICY post_wish_audience_owner ON public.post_wish_audience
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.post_wishes w
      WHERE w.id = post_wish_audience.wish_id AND w.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.post_wishes w
      WHERE w.id = post_wish_audience.wish_id AND w.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Anonymity on the order
--
-- Added to shop_orders rather than to a wish, because the choice belongs to the
-- purchase: the same person may give one gift with their name on it and the
-- next without. Suppression is a display rule — every other column on the row
-- is unchanged, and support, disputes and payouts see exactly what they did
-- before.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.shop_orders.is_anonymous IS
  'Hide the buyer from the RECIPIENT only. Never hides them from support, disputes or the payout trail — the buyer on this row stays real.';

-- Which wish a purchase answers, when it answers one. Nullable and ON DELETE
-- SET NULL: the order outlives the wish, and deleting a wish must never cascade
-- into anybody's order history.
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS fulfils_wish_id uuid REFERENCES public.post_wishes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS shop_orders_fulfils_wish_idx
  ON public.shop_orders (fulfils_wish_id)
  WHERE fulfils_wish_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Timestamp maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_post_wish_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_wishes_touch_updated_at ON public.post_wishes;
CREATE TRIGGER post_wishes_touch_updated_at
  BEFORE UPDATE ON public.post_wishes
  FOR EACH ROW EXECUTE FUNCTION public.touch_post_wish_updated_at();
