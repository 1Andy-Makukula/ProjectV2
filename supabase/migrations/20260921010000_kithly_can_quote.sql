-- =============================================================================
-- KithLy could not send a quotation on its own thread
--
-- WHAT WAS WRONG
-- --------------
-- `create_quotation` already permits an admin to quote:
--
--     IF v_role NOT IN ('merchant', 'admin') THEN ... END IF;
--
-- but two lines later it insists on a shop:
--
--     IF v_conv.buyer_id IS NULL OR v_conv.shop_id IS NULL THEN
--       RAISE EXCEPTION 'Quotations need both a buyer and a shop';
--
-- An `admin_buyer` conversation has NO SHOP -- that is the whole point of the
-- kind, and `conversations_participants_check` explicitly allows
-- shop_id IS NULL for it. So the concierge flow was impossible: a buyer could
-- open a thread with KithLy, KithLy could reply in words, and the moment it
-- tried to put a price on anything the function raised.
--
-- Nobody had hit it because `start_kithly_conversation` had no caller until
-- now.
--
-- THE FIX
-- -------
-- When the thread has no shop, resolve to the KithLy house shop
-- (20260921000000). Everything downstream then works untouched, because
-- `accept_quotation` mints its quote-only item "owned by the quoting shop" --
-- and KithLy now is one. The order that follows is an ordinary single-vendor
-- order with its own claim code, redemption, payout and expiry.
--
-- The fallback is deliberately narrow: only for kind = 'admin_buyer', and it
-- raises loudly if the house shop is absent rather than quietly writing NULL
-- into a NOT NULL column and surfacing as a constraint error nobody can read.
--
-- NOTHING ELSE IN THE FUNCTION CHANGES. The body below is the 20260727040000
-- definition with the shop resolution swapped in; the line validation, the
-- total, the message, the notification and the return are unchanged.
--
-- BLAST RADIUS: Feature. A path that previously always raised now succeeds.
-- No existing successful call behaves differently: a buyer_merchant thread
-- has a shop_id, so it never reaches the fallback.
-- =============================================================================

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
  v_shop_id uuid;
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

  SELECT buyer_id, shop_id, kind INTO v_conv
  FROM public.conversations WHERE id = p_conversation_id;

  IF v_conv.buyer_id IS NULL THEN
    RAISE EXCEPTION 'A quotation needs a buyer';
  END IF;

  -- The only change. A shop thread quotes as the shop; a KithLy thread quotes
  -- as the house shop, which is what gives the resulting order a seller.
  v_shop_id := v_conv.shop_id;
  IF v_shop_id IS NULL THEN
    IF v_conv.kind <> 'admin_buyer' THEN
      RAISE EXCEPTION 'Quotations need both a buyer and a shop';
    END IF;

    SELECT id INTO v_shop_id FROM public.shops WHERE name = 'KithLy';
    IF v_shop_id IS NULL THEN
      RAISE EXCEPTION 'The KithLy house shop is missing; see migration 20260921000000';
    END IF;
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
    (p_conversation_id, v_shop_id, v_conv.buyer_id, 1, p_notes, p_valid_until,
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
