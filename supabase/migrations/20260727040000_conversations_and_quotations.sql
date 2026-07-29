-- =============================================================================
-- Phase 4a — Conversations, quotations, and a shared notification helper
--
-- Three things a marketplace selling services needs and this one did not have:
--
--   1. A buyer and a merchant can talk before money moves. A birthday setup or
--      a catering job cannot be priced from a catalogue row.
--
--   2. A merchant can send an itemised quotation, and the buyer can accept and
--      pay it. The accepted quote goes through the existing checkout, escrow,
--      fulfilment and settlement path rather than a parallel money path.
--
--   3. KithLy can talk to either side. Admin messages are attributed to the
--      platform, never to the individual admin who typed them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Notification helper
--
-- The notifications table had exactly two writers before this migration, and
-- most of what happens to a person on this platform told them nothing. This is
-- the single entry point everything else now calls.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id      uuid,
  p_message      text,
  p_type         text,
  p_reference_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR btrim(coalesce(p_message, '')) = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (user_id, message, type, is_read, reference_id)
  VALUES (p_user_id, p_message, p_type, false, p_reference_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Quote-only catalogue items
--
-- An accepted quotation becomes a real `items` row owned by the quoting shop.
-- That is what lets it reuse checkout, escrow, fulfilment, settlement and the
-- expiry sweep without any of them learning about quotations. The flag keeps
-- it out of the browsable catalogue.
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_quote_only boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.items.is_quote_only IS
  'Created from an accepted quotation. Purchasable, but never listed in the catalogue.';

CREATE INDEX IF NOT EXISTS items_catalogue_idx
  ON public.items (shop_id)
  WHERE is_quote_only = false;

-- ---------------------------------------------------------------------------
-- 3. Conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,
  buyer_id        uuid REFERENCES public.users(id) ON DELETE CASCADE,
  shop_id         uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES public.items(id) ON DELETE SET NULL,
  shop_order_id   uuid REFERENCES public.shop_orders(shop_order_id) ON DELETE SET NULL,
  subject         text,
  is_closed       boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conversations_kind_check
    CHECK (kind IN ('buyer_merchant', 'admin_buyer', 'admin_shop')),

  -- Each kind needs its own participants present.
  CONSTRAINT conversations_participants_check CHECK (
    (kind = 'buyer_merchant' AND buyer_id IS NOT NULL AND shop_id IS NOT NULL)
    OR (kind = 'admin_buyer' AND buyer_id IS NOT NULL)
    OR (kind = 'admin_shop'  AND shop_id  IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS conversations_buyer_idx ON public.conversations (buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_shop_idx  ON public.conversations (shop_id, last_message_at DESC);

-- One open thread per buyer, shop and item, so a buyer tapping "ask about this"
-- twice continues the conversation instead of starting a second one.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_open_item_thread
  ON public.conversations (buyer_id, shop_id, COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE kind = 'buyer_merchant' AND is_closed = false;

-- ---------------------------------------------------------------------------
-- 4. Quotations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quotations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  shop_id               uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  buyer_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'pending',
  total_amount          integer NOT NULL,
  notes                 text,
  valid_until           timestamptz,
  target_execution_date timestamptz,
  fulfillment_item_id   uuid REFERENCES public.items(id) ON DELETE SET NULL,
  created_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  decline_reason        text,

  CONSTRAINT quotations_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  CONSTRAINT quotations_total_check CHECK (total_amount > 0)
);

CREATE INDEX IF NOT EXISTS quotations_conversation_idx ON public.quotations (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.quotation_line_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id   uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  description    text NOT NULL,
  quantity       integer NOT NULL DEFAULT 1,
  unit_price_zmw integer NOT NULL,
  sort_order     integer NOT NULL DEFAULT 0,

  CONSTRAINT quotation_line_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT quotation_line_items_price_check CHECK (unit_price_zmw >= 0)
);

CREATE INDEX IF NOT EXISTS quotation_line_items_quotation_idx
  ON public.quotation_line_items (quotation_id, sort_order);

-- ---------------------------------------------------------------------------
-- 5. Messages
--
-- sender_role is stored rather than derived, because the buyer must keep seeing
-- a message as coming from "KithLy" even if the admin who sent it later loses
-- the admin role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sender_role     text NOT NULL,
  message_type    text NOT NULL DEFAULT 'text',
  body            text,
  image_url       text,
  quotation_id    uuid REFERENCES public.quotations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT messages_sender_role_check
    CHECK (sender_role IN ('buyer', 'merchant', 'admin', 'system')),
  CONSTRAINT messages_type_check
    CHECK (message_type IN ('text', 'image', 'quotation', 'system')),
  -- Every message must actually carry something.
  CONSTRAINT messages_content_check CHECK (
    (message_type = 'text'      AND btrim(coalesce(body, '')) <> '')
    OR (message_type = 'image'  AND image_url IS NOT NULL)
    OR (message_type = 'quotation' AND quotation_id IS NOT NULL)
    OR (message_type = 'system' AND btrim(coalesce(body, '')) <> '')
  )
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON public.messages (conversation_id, created_at DESC);

-- Per-participant read position. A per-message read flag cannot express
-- "the merchant has read this but the admin watching has not".
CREATE TABLE IF NOT EXISTS public.conversation_reads (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 6. Access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (
        c.buyer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.merchant_shops ms
          WHERE ms.shop_id = c.shop_id AND ms.user_id = auth.uid()
        )
        OR public.current_user_role() = 'admin'
      )
  )
$$;

ALTER TABLE public.conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reads  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.merchant_shops ms
      WHERE ms.shop_id = conversations.shop_id AND ms.user_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(conversation_id));

DROP POLICY IF EXISTS quotations_select ON public.quotations;
CREATE POLICY quotations_select ON public.quotations
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(conversation_id));

DROP POLICY IF EXISTS quotation_line_items_select ON public.quotation_line_items;
CREATE POLICY quotation_line_items_select ON public.quotation_line_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quotation_line_items.quotation_id
        AND public.can_access_conversation(q.conversation_id)
    )
  );

DROP POLICY IF EXISTS conversation_reads_own ON public.conversation_reads;
CREATE POLICY conversation_reads_own ON public.conversation_reads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Writes go through the RPCs below, never straight from the client.

-- ---------------------------------------------------------------------------
-- 7. Who the caller is in a given conversation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversation_role_for(p_conversation_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
BEGIN
  SELECT buyer_id, shop_id INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Merchant standing is checked first: an admin who also owns a shop is acting
  -- as that shop inside its own threads.
  IF v_conv.shop_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.merchant_shops ms
    WHERE ms.shop_id = v_conv.shop_id AND ms.user_id = p_user_id
  ) THEN
    RETURN 'merchant';
  END IF;

  IF v_conv.buyer_id = p_user_id THEN
    RETURN 'buyer';
  END IF;

  IF public.current_user_role() = 'admin' THEN
    RETURN 'admin';
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Notifying the other side of a conversation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_conversation_counterparties(
  p_conversation_id uuid,
  p_sender_id       uuid,
  p_sender_role     text,
  p_preview         text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
  v_owner_id uuid;
  v_shop_name text;
  v_from text;
  v_body text;
BEGIN
  SELECT c.buyer_id, c.shop_id, s.owner_id, s.name
  INTO v_conv
  FROM public.conversations c
  LEFT JOIN public.shops s ON s.id = c.shop_id
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_owner_id := v_conv.owner_id;
  v_shop_name := v_conv.name;

  -- An admin is always "KithLy" to whoever receives the message.
  v_from := CASE p_sender_role
              WHEN 'admin'    THEN 'KithLy'
              WHEN 'merchant' THEN COALESCE(v_shop_name, 'The shop')
              ELSE 'The customer'
            END;

  v_body := v_from || ': ' || left(coalesce(p_preview, 'sent you a message'), 140);

  -- The buyer hears about anything they did not send.
  IF v_conv.buyer_id IS NOT NULL AND v_conv.buyer_id <> p_sender_id THEN
    PERFORM public.create_notification(
      v_conv.buyer_id, v_body, 'message', p_conversation_id::text);
  END IF;

  -- So does the shop owner.
  IF v_owner_id IS NOT NULL AND v_owner_id <> p_sender_id THEN
    PERFORM public.create_notification(
      v_owner_id, v_body, 'message', p_conversation_id::text);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. start_conversation — buyer opens a thread with a shop
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_conversation(
  p_shop_id uuid,
  p_item_id uuid DEFAULT NULL,
  p_subject text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_shop_id IS NULL THEN
    RAISE EXCEPTION 'A shop is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id) THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  -- Reuse the open thread for this buyer, shop and item if one exists.
  SELECT id INTO v_id
  FROM public.conversations
  WHERE kind = 'buyer_merchant'
    AND buyer_id = v_uid
    AND shop_id = p_shop_id
    AND COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND is_closed = false;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (kind, buyer_id, shop_id, item_id, subject)
  VALUES ('buyer_merchant', v_uid, p_shop_id, p_item_id, p_subject)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. admin_start_conversation — KithLy reaches out
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_start_conversation(
  p_buyer_id uuid DEFAULT NULL,
  p_shop_id  uuid DEFAULT NULL,
  p_subject  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_kind text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may open a KithLy conversation';
  END IF;

  IF (p_buyer_id IS NULL) = (p_shop_id IS NULL) THEN
    RAISE EXCEPTION 'Provide exactly one of buyer or shop';
  END IF;

  v_kind := CASE WHEN p_buyer_id IS NOT NULL THEN 'admin_buyer' ELSE 'admin_shop' END;

  SELECT id INTO v_id
  FROM public.conversations
  WHERE kind = v_kind
    AND buyer_id IS NOT DISTINCT FROM p_buyer_id
    AND shop_id IS NOT DISTINCT FROM p_shop_id
    AND is_closed = false
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (kind, buyer_id, shop_id, subject)
  VALUES (v_kind, p_buyer_id, p_shop_id, p_subject)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. send_message
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id uuid,
  p_body            text DEFAULT NULL,
  p_message_type    text DEFAULT 'text',
  p_image_url       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_id uuid;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_message_type NOT IN ('text', 'image') THEN
    RAISE EXCEPTION 'Only text and image messages can be sent directly';
  END IF;

  IF p_message_type = 'text' AND v_body IS NULL THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF p_message_type = 'image' AND p_image_url IS NULL THEN
    RAISE EXCEPTION 'An image is required';
  END IF;

  v_role := public.conversation_role_for(p_conversation_id, v_uid);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.conversations WHERE id = p_conversation_id AND is_closed) THEN
    RAISE EXCEPTION 'This conversation is closed';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, sender_role, message_type, body, image_url)
  VALUES (p_conversation_id, v_uid, v_role, p_message_type, v_body, p_image_url)
  RETURNING id INTO v_id;

  UPDATE public.conversations SET last_message_at = now() WHERE id = p_conversation_id;

  -- The sender has by definition read their own message.
  INSERT INTO public.conversation_reads (conversation_id, user_id, last_read_at)
  VALUES (p_conversation_id, v_uid, now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = now();

  PERFORM public.notify_conversation_counterparties(
    p_conversation_id, v_uid, v_role,
    COALESCE(v_body, 'sent a photo'));

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. create_quotation — merchant prices the work
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_quotation(
  p_conversation_id       uuid,
  p_line_items            jsonb,
  p_notes                 text DEFAULT NULL,
  p_valid_until           timestamptz DEFAULT NULL,
  p_target_execution_date timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_conv RECORD;
  v_line jsonb;
  v_total integer := 0;
  v_qty integer;
  v_unit integer;
  v_desc text;
  v_quotation_id uuid;
  i integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_role := public.conversation_role_for(p_conversation_id, v_uid);
  IF v_role NOT IN ('merchant', 'admin') THEN
    RAISE EXCEPTION 'Only the shop may send a quotation';
  END IF;

  SELECT buyer_id, shop_id INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
  IF v_conv.buyer_id IS NULL OR v_conv.shop_id IS NULL THEN
    RAISE EXCEPTION 'Quotations need both a buyer and a shop';
  END IF;

  IF p_line_items IS NULL OR jsonb_array_length(p_line_items) = 0 THEN
    RAISE EXCEPTION 'A quotation needs at least one line';
  END IF;

  IF p_valid_until IS NOT NULL AND p_valid_until <= now() THEN
    RAISE EXCEPTION 'The expiry date must be in the future';
  END IF;

  INSERT INTO public.quotations
    (conversation_id, shop_id, buyer_id, total_amount, notes, valid_until,
     target_execution_date, created_by)
  VALUES
    (p_conversation_id, v_conv.shop_id, v_conv.buyer_id, 1, p_notes, p_valid_until,
     p_target_execution_date, v_uid)
  RETURNING id INTO v_quotation_id;

  FOR i IN 0..jsonb_array_length(p_line_items) - 1 LOOP
    v_line := p_line_items->i;
    v_desc := nullif(btrim(coalesce(v_line->>'description', '')), '');
    v_qty  := COALESCE((v_line->>'quantity')::integer, 1);
    v_unit := COALESCE((v_line->>'unit_price_zmw')::integer, -1);

    IF v_desc IS NULL THEN
      RAISE EXCEPTION 'Every line needs a description';
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be at least 1';
    END IF;
    IF v_unit < 0 THEN
      RAISE EXCEPTION 'Every line needs a price';
    END IF;

    INSERT INTO public.quotation_line_items
      (quotation_id, description, quantity, unit_price_zmw, sort_order)
    VALUES (v_quotation_id, v_desc, v_qty, v_unit, i);

    v_total := v_total + (v_qty * v_unit);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'A quotation must come to more than zero';
  END IF;

  UPDATE public.quotations SET total_amount = v_total WHERE id = v_quotation_id;

  INSERT INTO public.messages
    (conversation_id, sender_id, sender_role, message_type, quotation_id)
  VALUES (p_conversation_id, v_uid, v_role, 'quotation', v_quotation_id);

  UPDATE public.conversations SET last_message_at = now() WHERE id = p_conversation_id;

  PERFORM public.notify_conversation_counterparties(
    p_conversation_id, v_uid, v_role, 'sent you a quotation');

  RETURN v_quotation_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. accept_quotation
--
-- Mints a quote-only catalogue item at the agreed total, owned by the quoting
-- shop. From here the purchase is an ordinary one: the same checkout, the same
-- escrow, the same fulfilment scan, the same settlement and the same expiry
-- clock, none of which need to know a quotation was involved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_quotation(p_quotation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q RECORD;
  v_item_id uuid;
  v_summary text;
  v_shop_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  IF v_q.buyer_id <> v_uid THEN
    RAISE EXCEPTION 'Only the buyer may accept this quotation';
  END IF;

  IF v_q.status <> 'pending' THEN
    RAISE EXCEPTION 'This quotation is already %', v_q.status;
  END IF;

  IF v_q.valid_until IS NOT NULL AND v_q.valid_until <= now() THEN
    UPDATE public.quotations SET status = 'expired', decided_at = now() WHERE id = p_quotation_id;
    RAISE EXCEPTION 'This quotation has expired';
  END IF;

  SELECT string_agg(description, ', ' ORDER BY sort_order)
  INTO v_summary
  FROM public.quotation_line_items WHERE quotation_id = p_quotation_id;

  SELECT name INTO v_shop_name FROM public.shops WHERE id = v_q.shop_id;

  INSERT INTO public.items (
    shop_id, name, description, price_zmw, is_available, is_quote_only,
    item_type, requires_scheduling, has_expiry, category_id
  )
  VALUES (
    v_q.shop_id,
    'Custom quote ' || upper(left(p_quotation_id::text, 8)),
    v_summary,
    v_q.total_amount,
    true,
    true,
    'service',
    v_q.target_execution_date IS NOT NULL,
    true,
    NULL
  )
  RETURNING id INTO v_item_id;

  UPDATE public.quotations
  SET status = 'accepted', decided_at = now(), fulfillment_item_id = v_item_id
  WHERE id = p_quotation_id;

  INSERT INTO public.messages (conversation_id, sender_id, sender_role, message_type, body)
  VALUES (v_q.conversation_id, v_uid, 'system', 'system',
          'Quotation accepted. Awaiting payment.');

  UPDATE public.conversations SET last_message_at = now() WHERE id = v_q.conversation_id;

  PERFORM public.create_notification(
    (SELECT owner_id FROM public.shops WHERE id = v_q.shop_id),
    'Your quotation was accepted. The customer is completing payment now.',
    'success',
    v_q.conversation_id::text);

  RETURN jsonb_build_object(
    'success', true,
    'quotation_id', p_quotation_id,
    'item_id', v_item_id,
    'shop_id', v_q.shop_id,
    'shop_name', v_shop_name,
    'total_amount', v_q.total_amount,
    'target_execution_date', v_q.target_execution_date
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 14. decline_quotation / withdraw
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_quotation(p_quotation_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q RECORD;
  v_role text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  IF v_q.status <> 'pending' THEN
    RAISE EXCEPTION 'This quotation is already %', v_q.status;
  END IF;

  v_role := public.conversation_role_for(v_q.conversation_id, v_uid);

  -- The buyer declines it; the shop withdraws it. Same row, different word.
  IF v_uid = v_q.buyer_id THEN
    v_status := 'declined';
  ELSIF v_role IN ('merchant', 'admin') THEN
    v_status := 'withdrawn';
  ELSE
    RAISE EXCEPTION 'You cannot change this quotation';
  END IF;

  UPDATE public.quotations
  SET status = v_status, decided_at = now(),
      decline_reason = nullif(btrim(coalesce(p_reason, '')), '')
  WHERE id = p_quotation_id;

  INSERT INTO public.messages (conversation_id, sender_id, sender_role, message_type, body)
  VALUES (v_q.conversation_id, v_uid, 'system', 'system',
          CASE WHEN v_status = 'declined'
               THEN 'Quotation declined.'
               ELSE 'Quotation withdrawn by the shop.' END);

  UPDATE public.conversations SET last_message_at = now() WHERE id = v_q.conversation_id;

  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$$;

-- ---------------------------------------------------------------------------
-- 15. mark_conversation_read
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.conversation_role_for(p_conversation_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'You are not part of this conversation';
  END IF;

  INSERT INTO public.conversation_reads (conversation_id, user_id, last_read_at)
  VALUES (p_conversation_id, v_uid, now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = now();
END;
$$;

-- ---------------------------------------------------------------------------
-- 16. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.can_access_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_role_for(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_conversation_counterparties(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_conversation(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_start_conversation(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_message(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_quotation(uuid, jsonb, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_quotation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_quotation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_access_conversation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_role_for(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_conversation(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_start_conversation(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_quotation(uuid, jsonb, text, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_quotation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_quotation(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 17. Realtime
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;
